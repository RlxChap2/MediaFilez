import fs from 'node:fs/promises';
import path from 'node:path';
import { describeFile, makeSafeFileName } from '../utils/files.js';
import { formatBytes } from '../utils/format.js';
import { userError } from '../utils/errors.js';
import { compressVideo, extractAudio, extractThumbnail, getMediaInfo, requireFFmpeg } from '../utils/ffmpeg.js';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav', 'webm']);

async function copyImage(input, tempDir, outputName) {
  const outputPath = path.join(tempDir, outputName);
  if (path.resolve(input.filePath) !== path.resolve(outputPath)) await fs.copyFile(input.filePath, outputPath);
  return outputPath;
}

function ensureFits(file, maxAttachmentBytes, outputType) {
  if (file.sizeBytes <= maxAttachmentBytes) return;
  throw userError(
    `The ${outputType} is ${formatBytes(file.sizeBytes)}, above the configured upload target of ${formatBytes(maxAttachmentBytes)}.`,
    'FILE_TOO_LARGE',
  );
}

export async function prepareMediaForDiscord(download, options) {
  const { outputType, tempDir, maxAttachmentBytes, allowCompression, onStatus, signal } = options;
  let outputPath = download.filePath;
  let outputName = download.fileName;
  let note = null;

  if (outputType === 'video') {
    if (download.mediaKind === 'image') throw userError('The source is an image. Choose image output.', 'WRONG_MEDIA_TYPE');
    if (download.sizeBytes > maxAttachmentBytes) {
      if (!allowCompression) {
        throw userError(`The video is ${formatBytes(download.sizeBytes)}, above the ${formatBytes(maxAttachmentBytes)} upload target.`, 'FILE_TOO_LARGE');
      }
      await requireFFmpeg('video fitting');
      const fittingDetail = 'Fitting the video to a reliable Discord upload size';
      await onStatus?.({ phase: 'processing', detail: fittingDetail });
      outputPath = await compressVideo(download.filePath, tempDir, Math.floor(maxAttachmentBytes * 0.98), {
        signal,
        onStage: (detail) => onStatus?.({ phase: 'processing', detail }),
        onProgress: (progress) => onStatus?.({ phase: 'processing', detail: 'Compressing video to fit Discord', progress }),
      });
      outputName = makeSafeFileName(`fit-${download.fileName}`, 'video', 'mp4');
      note = 'transcoded to fit Discord';
    }
  }

  if (outputType === 'audio') {
    const extension = (download.extension || path.extname(download.fileName).slice(1)).toLowerCase();
    const canSendOriginal = download.isAudioOnly || download.mediaKind === 'audio' || AUDIO_EXTENSIONS.has(extension);
    if (canSendOriginal) {
      outputName = makeSafeFileName(download.fileName, 'audio', extension || 'm4a');
      note = 'downloaded as audio';
    } else {
      await requireFFmpeg('audio extraction');
      await onStatus?.({ phase: 'processing', detail: 'Extracting audio' });
      outputPath = await extractAudio(download.filePath, tempDir, Math.floor(maxAttachmentBytes * 0.98), { signal });
      outputName = 'audio.mp3';
      note = 'extracted as MP3';
    }
  }

  if (outputType === 'thumbnail' || outputType === 'image') {
    if (download.mediaKind === 'image') {
      const extension = path.extname(download.fileName) || '.jpg';
      outputName = outputType === 'thumbnail' ? `thumbnail${extension}` : download.fileName;
      outputPath = await copyImage(download, tempDir, outputName);
    } else {
      await requireFFmpeg(`${outputType} extraction`);
      await onStatus?.({ phase: 'processing', detail: `Extracting ${outputType}` });
      outputName = outputType === 'thumbnail' ? 'thumbnail.jpg' : 'image.jpg';
      outputPath = await extractThumbnail(download.filePath, tempDir, outputName, { signal });
      note = 'extracted from the video';
    }
  }

  const file = await describeFile(outputPath, outputName, outputType);
  ensureFits(file, maxAttachmentBytes, outputType);
  return { ...file, note };
}

export async function getSafeMediaInfo(filePath, options = {}) {
  try { return await getMediaInfo(filePath, options); } catch { return null; }
}
