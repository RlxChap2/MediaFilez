import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { formatBytes } from "./format.js";
import { userError } from "./errors.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);
let ffmpegAvailability = null;

function missingFfmpegError(binary) {
    return userError(
        `${binary} is not installed on this host. Install FFmpeg so audio conversion, video thumbnails, image extraction, and video fitting can work.`,
        "FFMPEG_MISSING",
    );
}

async function runBinary(binary, args, options = {}) {
    const timeout = options.timeoutMs ?? config.ffmpegTimeoutMs;
    try {
        const { stdout, stderr } = await execFileAsync(binary, args, {
            timeout,
            signal: options.signal,
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
        });
        return { stdout, stderr };
    } catch (error) {
        if (error.name === "AbortError" || error.code === "ABORT_ERR") throw error;
        if (error.killed || error.signal === "SIGTERM") {
            throw userError(`${binary} timed out while processing this file.`, "PROCESS_TIMEOUT");
        }
        if (error.code === "ENOENT") {
            throw missingFfmpegError(binary);
        }
        throw new Error(`${binary} failed: ${error.stderr || error.message}`);
    }
}

export async function runFFmpeg(args, options = {}) {
    return await runBinary("ffmpeg", ["-hide_banner", ...args], options);
}

async function runFFprobe(args, options = {}) {
    const { stdout } = await runBinary("ffprobe", ["-v", "quiet", ...args], { ...options, timeoutMs: 30_000 });
    return stdout;
}

export async function getMediaInfo(inputPath, options = {}) {
    const raw = await runFFprobe(["-print_format", "json", "-show_format", "-show_streams", inputPath], options);

    const data = JSON.parse(raw);
    const format = data.format || {};
    const streams = data.streams || [];
    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const audioStream = streams.find((stream) => stream.codec_type === "audio");

    return {
        duration: Number.parseFloat(format.duration || "0"),
        sizeBytes: Number.parseInt(format.size || "0", 10),
        bitrate: Number.parseInt(format.bit_rate || "0", 10),
        hasVideo: Boolean(videoStream),
        hasAudio: Boolean(audioStream),
        width: Number.parseInt(videoStream?.width || "0", 10),
        height: Number.parseInt(videoStream?.height || "0", 10),
        videoBitrate: Number.parseInt(videoStream?.bit_rate || "0", 10),
        audioBitrate: Number.parseInt(audioStream?.bit_rate || "0", 10),
        formatName: format.format_name || "unknown",
    };
}

export async function extractThumbnail(inputPath, outputDir, outputName = "thumbnail.jpg", options = {}) {
    const outputPath = path.join(outputDir, outputName);

    await runFFmpeg(["-ss", "00:00:01", "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath], options);

    await fs.access(outputPath);
    return outputPath;
}

function audioBitrateForTarget(duration, targetSizeBytes) {
    if (!duration || !targetSizeBytes) return 192;

    const availableBitsPerSecond = Math.floor((targetSizeBytes * 8 * 0.9) / duration);
    const kbps = Math.floor(availableBitsPerSecond / 1000);
    return Math.min(192, Math.max(48, kbps));
}

export async function extractAudio(inputPath, outputDir, targetSizeBytes, options = {}) {
    const info = await getMediaInfo(inputPath, options);
    if (!info.hasAudio) {
        throw userError("The downloaded media does not contain an audio stream.", "NO_AUDIO");
    }

    const kbps = audioBitrateForTarget(info.duration, targetSizeBytes);
    if (targetSizeBytes && kbps <= 48 && info.duration && (48_000 * info.duration) / 8 > targetSizeBytes) {
        throw userError(
            `The audio is too long to fit inside ${formatBytes(targetSizeBytes)} at usable quality.`,
            "FILE_TOO_LARGE",
        );
    }

    const outputPath = path.join(outputDir, "audio.mp3");

    await runFFmpeg(
        ["-i", inputPath, "-vn", "-c:a", "libmp3lame", "-b:a", `${kbps}k`, "-ar", "44100", "-y", outputPath],
        options,
    );

    await fs.access(outputPath);
    return outputPath;
}

function videoBitratesForTarget(info, targetSizeBytes, scale = 0.9) {
    const availableBitrate = Math.floor((targetSizeBytes * 8 * scale) / info.duration);
    let audioBitrate = 0;
    if (info.hasAudio) {
        audioBitrate = Math.min(96_000, Math.max(24_000, Math.floor(availableBitrate * 0.16)));
    }
    const videoBitrate = availableBitrate - audioBitrate;

    if (videoBitrate < 24_000) {
        throw userError(
            `This video is too long to fit inside ${formatBytes(targetSizeBytes)} as a playable video. Audio or thumbnail output will fit more reliably.`,
            "FILE_TOO_LARGE",
        );
    }

    return { videoKbps: Math.floor(videoBitrate / 1000), audioKbps: Math.floor(audioBitrate / 1000) };
}

function maxWidthForBitrate(videoKbps) {
    if (videoKbps < 80) return 320;
    if (videoKbps < 160) return 480;
    if (videoKbps < 350) return 640;
    if (videoKbps < 700) return 854;
    return 1280;
}

async function tryFastFit(label, args, outputPath, targetSizeBytes, options) {
    await fs.rm(outputPath, { force: true });
    try {
        await runFFmpeg([...args, "-y", outputPath], options);
        const stat = await fs.stat(outputPath);
        if (stat.size <= targetSizeBytes) {
            log.info(`${label} fit the video at ${formatBytes(stat.size)}.`);
            return outputPath;
        }
        log.info(`${label} produced ${formatBytes(stat.size)}; a smaller result is still needed.`);
    } catch (error) {
        if (error.name === "AbortError" || error.code === "ABORT_ERR") throw error;
        log.warn(`${label} was not usable: ${error.message}`);
    }
    await fs.rm(outputPath, { force: true });
    return null;
}

async function tryRemux(inputPath, outputDir, baseName, targetSizeBytes, options) {
    const outputPath = path.join(outputDir, `fit-remux-${baseName}.mp4`);
    return await tryFastFit(
        "Lossless remux",
        [
            "-i",
            inputPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c",
            "copy",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
        ],
        outputPath,
        targetSizeBytes,
        options,
    );
}

async function tryAudioFit(inputPath, outputDir, baseName, info, targetSizeBytes, options) {
    if (!info.hasAudio) return null;
    const totalTargetBitrate = Math.floor((targetSizeBytes * 8 * 0.96) / info.duration);
    const estimatedVideoBitrate = info.videoBitrate || Math.max(0, info.bitrate - (info.audioBitrate || 0));
    const audioKbps = Math.min(96, Math.max(24, Math.floor((totalTargetBitrate - estimatedVideoBitrate) / 1000)));
    const outputPath = path.join(outputDir, `fit-audio-${baseName}.mp4`);
    const candidates = [audioKbps, 16];

    for (const candidateKbps of candidates) {
        const args = [
            "-i",
            inputPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            `${candidateKbps}k`,
            "-ac",
            candidateKbps < 56 ? "1" : "2",
            "-ar",
            candidateKbps <= 24 ? "32000" : "44100",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
        ];
        const result = await tryFastFit(
            `Video-copy/audio fit at ${candidateKbps}k`,
            args,
            outputPath,
            targetSizeBytes,
            options,
        );
        if (result) return result;
    }

    return null;
}

async function compressAttempt(inputPath, outputPath, info, targetSizeBytes, scale, options) {
    const { videoKbps, audioKbps } = videoBitratesForTarget(info, targetSizeBytes, scale);
    const maxWidth = maxWidthForBitrate(videoKbps);
    const args = [
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${Math.floor(videoKbps * 1.2)}k`,
        "-bufsize",
        `${Math.floor(videoKbps * 2)}k`,
        "-vf",
        `scale=min(iw\\,${maxWidth}):-2`,
        "-pix_fmt",
        "yuv420p",
    ];

    if (info.hasAudio) {
        args.push("-c:a", "aac", "-b:a", `${audioKbps}k`, "-ac", audioKbps < 56 ? "1" : "2");
    } else {
        args.push("-an");
    }

    args.push("-movflags", "+faststart", "-y", outputPath);

    log.info(`Compressing video to ${videoKbps}k video bitrate.`);
    await runFFmpeg(args, options);
    return await fs.stat(outputPath);
}

export async function compressVideo(inputPath, outputDir, targetSizeBytes, options = {}) {
    const info = await getMediaInfo(inputPath, options);

    if (!info.hasVideo) {
        throw userError("The downloaded media does not contain a video stream.", "NO_VIDEO");
    }

    if (!info.duration || info.duration < 0.5) {
        throw userError(
            "The video duration could not be detected, so it cannot be compressed safely.",
            "PROCESS_FAILED",
        );
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const remuxed = await tryRemux(inputPath, outputDir, baseName, targetSizeBytes, options);
    if (remuxed) return remuxed;

    const audioFit = await tryAudioFit(inputPath, outputDir, baseName, info, targetSizeBytes, options);
    if (audioFit) return audioFit;

    const outputPath = path.join(outputDir, `fit-${baseName}.mp4`);
    let stat = await compressAttempt(inputPath, outputPath, info, targetSizeBytes, 0.92, options);

    if (stat.size > targetSizeBytes) {
        stat = await compressAttempt(inputPath, outputPath, info, targetSizeBytes, 0.8, options);
    }

    if (stat.size > targetSizeBytes) {
        throw userError(
            `The compressed video is still ${formatBytes(stat.size)}, above the upload target of ${formatBytes(targetSizeBytes)}.`,
            "FILE_TOO_LARGE",
        );
    }

    return outputPath;
}

export async function checkFFmpeg() {
    if (ffmpegAvailability !== null) return ffmpegAvailability;

    try {
        await Promise.all([
            execFileAsync("ffmpeg", ["-version"], { timeout: 5000, windowsHide: true }),
            execFileAsync("ffprobe", ["-version"], { timeout: 5000, windowsHide: true }),
        ]);
        ffmpegAvailability = true;
        return ffmpegAvailability;
    } catch {
        ffmpegAvailability = false;
        return ffmpegAvailability;
    }
}

export async function requireFFmpeg(featureName) {
    if (await checkFFmpeg()) return;
    throw userError(
        `FFmpeg is not installed on this host, so ${featureName} cannot run. On Ubuntu/Debian: apt update && apt install -y ffmpeg`,
        "FFMPEG_MISSING",
    );
}
