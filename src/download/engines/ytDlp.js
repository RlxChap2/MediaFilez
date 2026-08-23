import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config.js";
import { DownloadMethodError, userError } from "../../utils/errors.js";
import { ProcessExecutionError, runProcess } from "../../utils/process.js";
import { recoverArtifact } from "../artifact.js";
import { formatBytes } from "../../utils/format.js";
import { resolveFFmpegPaths } from "../../utils/ffmpeg.js";

export function resolveYtDlpPath() {
    if (config.ytdlpPath) return config.ytdlpPath;
    const entry = fileURLToPath(import.meta.resolve("youtube-dl-exec"));
    const packageRoot = path.resolve(path.dirname(entry), "..");
    return path.join(packageRoot, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

function formatSelector(outputType) {
    if (outputType === "audio") return "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio";
    return "bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b";
}

function cleanError(error) {
    const lines = `${error.stderr || ""}\n${error.stdout || ""}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.findLast((line) => line.startsWith("ERROR:")) || lines.at(-1) || error.message;
}

async function readMetadata(attemptDir) {
    const files = await fs.readdir(attemptDir).catch(() => []);
    const name = files.find((file) => file.endsWith(".info.json"));
    if (!name) return null;

    const raw = await fs.readFile(path.join(attemptDir, name), "utf8").catch(() => null);
    if (!raw) return null;

    try {
        const data = JSON.parse(raw);
        return {
            title: data.title,
            creator: data.uploader || data.channel,
            durationSeconds: data.duration,
            width: data.width,
            height: data.height,
            thumbnailUrl: data.thumbnail,
            sourceUrl: data.webpage_url,
            sourceId: data.id,
            extractor: data.extractor_key || data.extractor,
        };
    } catch {
        return null;
    }
}

function progressHandler(options) {
    return (line) => {
        if (!line.startsWith("download:")) return;
        const [, downloaded, total, percent] = line.split("|");
        options.onProgress?.({
            downloadedBytes: Number.parseInt(downloaded, 10) || 0,
            totalBytes: Number.parseInt(total, 10) || null,
            percent: Number.parseFloat(percent) || null,
        });
    };
}

export async function downloadWithYtDlp(rawUrl, attemptDir, options = {}) {
    const maxBytes = options.maxBytes ?? config.maxDownloadBytes;
    const outputType = options.outputType ?? "video";
    const args = [
        "--no-config",
        "--no-playlist",
        "--no-warnings",
        "--windows-filenames",
        "--trim-filenames",
        "150",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "--extractor-retries",
        "3",
        "--socket-timeout",
        "30",
        "--concurrent-fragments",
        String(config.ytdlpConcurrentFragments),
        "--max-filesize",
        String(maxBytes),
        "--js-runtimes",
        `node:${process.execPath}`,
        "--ffmpeg-location",
        resolveFFmpegPaths().ffmpeg,
        "--write-info-json",
        "--no-clean-info-json",
        "--progress-template",
        "download:%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress._percent_str)s",
        "--print",
        "after_move:filepath",
        "--output",
        path.join(attemptDir, "%(title).120B_%(id).40B.%(ext)s"),
    ];
    if (config.ytdlpImpersonate) args.push("--impersonate", config.ytdlpImpersonate);
    if (config.mediaCookiesFile) args.push("--cookies", config.mediaCookiesFile);
    else if (config.ytdlpCookiesFromBrowser) args.push("--cookies-from-browser", config.ytdlpCookiesFromBrowser);

    if (outputType === "thumbnail" || outputType === "image") {
        args.push("--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg");
    } else {
        args.push("--format", formatSelector(outputType));
        if (outputType !== "audio") args.push("--merge-output-format", "mp4");
    }
    args.push("--", rawUrl);

    let processError = null;
    try {
        await runProcess(resolveYtDlpPath(), args, {
            timeoutMs: config.ytdlpTimeoutMs,
            signal: options.signal,
            onStdoutLine: progressHandler(options),
        });
    } catch (error) {
        if (error instanceof ProcessExecutionError && error.aborted)
            throw Object.assign(new Error("The download was cancelled."), { name: "AbortError" });
        processError = error;
    }

    const artifact = await recoverArtifact(attemptDir, { outputType, maxBytes, signal: options.signal });
    if (artifact) {
        return {
            ...artifact,
            method: "yt-dlp",
            sourceUrl: rawUrl,
            metadata: await readMetadata(attemptDir),
            recoveredFromProcessError: Boolean(processError),
        };
    }
    if (!processError) throw new DownloadMethodError("yt-dlp", "yt-dlp finished without a playable file.");
    const message = cleanError(processError);
    if (/larger than max-filesize|exceeds.*filesize/i.test(message)) {
        throw userError(`The source is larger than ${formatBytes(maxBytes)}.`, "FILE_TOO_LARGE", {
            stopFallback: true,
        });
    }
    throw new DownloadMethodError("yt-dlp", message, { cause: processError });
}
