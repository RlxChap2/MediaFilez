import fs from "node:fs/promises";
import path from "node:path";
import { describeFile, makeSafeFileName } from "../utils/files.js";
import { formatBytes } from "../utils/format.js";
import { userError } from "../utils/errors.js";
import {
    compressImage,
    compressVideo,
    extractAudio,
    extractThumbnail,
    getMediaInfo,
    requireFFmpeg,
} from "../utils/ffmpeg.js";

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "ogg", "opus", "flac", "wav", "webm"]);

async function copyImage(input, tempDir, outputName) {
    const outputPath = path.join(tempDir, outputName);
    if (path.resolve(input.filePath) !== path.resolve(outputPath)) await fs.copyFile(input.filePath, outputPath);
    return outputPath;
}

function ensureFits(file, maxAttachmentBytes, outputType) {
    if (file.sizeBytes <= maxAttachmentBytes) return;
    throw userError(
        `The ${outputType} is ${formatBytes(file.sizeBytes)}, above the configured upload target of ${formatBytes(maxAttachmentBytes)}.`,
        "FILE_TOO_LARGE",
    );
}

export async function prepareMediaForDiscord(download, options) {
    const {
        outputType: requestedOutputType,
        tempDir,
        maxAttachmentBytes,
        allowCompression,
        onStatus,
        signal,
    } = options;
    const outputType = requestedOutputType === "auto" ? download.mediaKind : requestedOutputType;
    if (!["video", "audio", "image", "thumbnail"].includes(outputType)) {
        throw userError(
            "The downloaded file type could not be detected as video, audio, or image.",
            "UNSUPPORTED_MEDIA",
        );
    }
    let outputPath = download.filePath;
    let outputName = download.fileName;
    let note = null;

    if (outputType === "video") {
        if (download.mediaKind === "image")
            throw userError("The source is an image. Choose image output.", "WRONG_MEDIA_TYPE");
        if (download.sizeBytes > maxAttachmentBytes) {
            if (!allowCompression) {
                throw userError(
                    `The video is ${formatBytes(download.sizeBytes)}, above the ${formatBytes(maxAttachmentBytes)} upload target.`,
                    "FILE_TOO_LARGE",
                );
            }
            await requireFFmpeg("video fitting");
            const fittingDetail = "Fitting the video to a reliable Discord upload size";
            await onStatus?.({ phase: "processing", detail: fittingDetail });
            outputPath = await compressVideo(download.filePath, tempDir, Math.floor(maxAttachmentBytes * 0.98), {
                signal,
                onStage: (detail) => onStatus?.({ phase: "processing", detail }),
                onProgress: (progress) =>
                    onStatus?.({ phase: "processing", detail: "Compressing video to fit Discord", progress }),
            });
            outputName = makeSafeFileName(`fit-${download.fileName}`, "video", "mp4");
            note = "transcoded to fit Discord";
        }
    }

    if (outputType === "audio") {
        const extension = (download.extension || path.extname(download.fileName).slice(1)).toLowerCase();
        const canSendOriginal =
            download.isAudioOnly || download.mediaKind === "audio" || AUDIO_EXTENSIONS.has(extension);
        if (canSendOriginal && download.sizeBytes <= maxAttachmentBytes) {
            outputName = makeSafeFileName(download.fileName, "audio", extension || "m4a");
            note = "downloaded as audio";
        } else {
            if (canSendOriginal && !allowCompression) {
                throw userError(
                    `The audio is ${formatBytes(download.sizeBytes)}, above the ${formatBytes(maxAttachmentBytes)} upload target.`,
                    "FILE_TOO_LARGE",
                );
            }
            await requireFFmpeg(canSendOriginal ? "audio fitting" : "audio extraction");
            await onStatus?.({
                phase: "processing",
                detail: canSendOriginal ? "Fitting audio to Discord" : "Extracting audio",
            });
            outputPath = await extractAudio(download.filePath, tempDir, Math.floor(maxAttachmentBytes * 0.98), {
                signal,
                outputFileName: canSendOriginal ? "fit-audio.mp3" : "audio.mp3",
            });
            outputName = canSendOriginal ? "fit-audio.mp3" : "audio.mp3";
            note = canSendOriginal ? "transcoded to fit Discord" : "extracted as MP3";
        }
    }

    if (outputType === "thumbnail" || outputType === "image") {
        if (download.mediaKind === "image") {
            const extension = path.extname(download.fileName) || ".jpg";
            outputName = outputType === "thumbnail" ? `thumbnail${extension}` : download.fileName;
            outputPath = await copyImage(download, tempDir, outputName);
        } else {
            await requireFFmpeg(`${outputType} extraction`);
            await onStatus?.({ phase: "processing", detail: `Extracting ${outputType}` });
            outputName = outputType === "thumbnail" ? "thumbnail.jpg" : "image.jpg";
            outputPath = await extractThumbnail(download.filePath, tempDir, outputName, { signal });
            note = "extracted from the video";
        }

        const imageSize = (await fs.stat(outputPath)).size;
        if (imageSize > maxAttachmentBytes) {
            if (!allowCompression) {
                throw userError(
                    `The image is ${formatBytes(imageSize)}, above the ${formatBytes(maxAttachmentBytes)} upload target.`,
                    "FILE_TOO_LARGE",
                );
            }
            await requireFFmpeg("image fitting");
            await onStatus?.({ phase: "processing", detail: "Fitting image to Discord" });
            outputPath = await compressImage(outputPath, tempDir, Math.floor(maxAttachmentBytes * 0.98), {
                signal,
                onStage: (detail) => onStatus?.({ phase: "processing", detail }),
            });
            outputName = outputType === "thumbnail" ? "thumbnail.jpg" : "fit-image.jpg";
            note = note ? `${note}; compressed to fit Discord` : "compressed to fit Discord";
        }
    }

    const file = await describeFile(outputPath, outputName, outputType);
    ensureFits(file, maxAttachmentBytes, outputType);
    return { ...file, note };
}

export async function getSafeMediaInfo(filePath, options = {}) {
    try {
        return await getMediaInfo(filePath, options);
    } catch {
        return null;
    }
}
