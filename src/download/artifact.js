import fs from 'node:fs/promises';
import path from 'node:path';
import { describeFile, makeSafeFileName } from '../utils/files.js';
import { getMediaInfo } from '../utils/ffmpeg.js';
import { userError } from '../utils/errors.js';
import { formatBytes } from '../utils/format.js';

const SIDECAR_EXTENSIONS = new Set([
  '.json', '.part', '.ytdl', '.tmp', '.vtt', '.srt', '.ass', '.lrc', '.description', '.txt',
]);

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile() && !SIDECAR_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

export async function findArtifactCandidates(attemptDir) {
  const candidates = [];
  for (const filePath of await listFiles(attemptDir)) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.size > 0) candidates.push({ filePath, sizeBytes: stat.size });
  }
  return candidates.sort((left, right) => right.sizeBytes - left.sizeBytes);
}

export async function validateArtifact(candidate, options = {}) {
  const filePath = typeof candidate === 'string' ? candidate : candidate.filePath;
  const file = await describeFile(filePath, options.preferredName || path.basename(filePath), options.outputType || 'media');
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  if (file.sizeBytes <= 0) throw new Error('The downloaded artifact is empty.');
  if (file.sizeBytes > maxBytes) {
    throw userError(
      `The source file is ${formatBytes(file.sizeBytes)}. The maximum allowed download is ${formatBytes(maxBytes)}.`,
      'FILE_TOO_LARGE',
      { stopFallback: true },
    );
  }

  let mediaInfo = null;
  if (file.mediaKind === 'video' || file.mediaKind === 'audio') {
    mediaInfo = await getMediaInfo(filePath, { signal: options.signal });
    if (!mediaInfo.hasVideo && !mediaInfo.hasAudio) throw new Error('FFprobe found no playable media streams.');
    if (options.outputType === 'video' && !mediaInfo.hasVideo) throw new Error('The artifact has no video stream.');
    if (options.outputType === 'audio' && !mediaInfo.hasAudio) throw new Error('The artifact has no audio stream.');
  }

  const mediaKind = mediaInfo?.hasVideo ? 'video' : mediaInfo?.hasAudio ? 'audio' : file.mediaKind;
  if (['image', 'thumbnail'].includes(options.outputType) && mediaKind !== 'image') {
    throw new Error('The artifact is not an image.');
  }
  if (mediaKind === 'unknown') throw new Error('The artifact is not a recognized media file.');

  return {
    ...file,
    mediaKind,
    isAudioOnly: Boolean(mediaInfo?.hasAudio && !mediaInfo?.hasVideo),
    mediaInfo,
  };
}

export async function recoverArtifact(attemptDir, options = {}) {
  for (const candidate of await findArtifactCandidates(attemptDir)) {
    try {
      return await validateArtifact(candidate, options);
    } catch (error) {
      if (error?.stopFallback) throw error;
    }
  }
  return null;
}

export async function commitArtifact(artifact, jobDir) {
  const completedDir = path.join(jobDir, 'completed');
  await fs.mkdir(completedDir, { recursive: true });
  const safeName = makeSafeFileName(artifact.fileName, 'media', artifact.extension);
  let destination = path.join(completedDir, safeName);
  if (path.resolve(destination) !== path.resolve(artifact.filePath)) {
    try {
      await fs.rename(artifact.filePath, destination);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      await fs.copyFile(artifact.filePath, destination);
      await fs.rm(artifact.filePath, { force: true });
    }
  } else {
    destination = artifact.filePath;
  }
  return { ...artifact, filePath: destination, fileName: path.basename(destination), committed: true };
}
