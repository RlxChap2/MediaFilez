import fs from "node:fs/promises";
import path from "node:path";
import { Innertube } from "youtubei.js";
import { config } from "../../config.js";
import { DownloadMethodError, userError } from "../../utils/errors.js";
import { describeFile, makeSafeFileName } from "../../utils/files.js";
import { formatBytes } from "../../utils/format.js";
import { downloadDirectHttp } from "./directHttp.js";
import { preferredVideoHeight } from "../videoQuality.js";

let clientPromise;

function getClient() {
    clientPromise ??= Innertube.create({ retrieve_player: true });
    return clientPromise;
}

function youtubeId(rawUrl) {
    const url = new URL(rawUrl);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0];
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/);
    return match?.[1] ?? null;
}

function metadataFromInfo(info) {
    const basic = info.basic_info || {};
    return {
        title: basic.title,
        creator: basic.author,
        durationSeconds: basic.duration,
        thumbnailUrl: basic.thumbnail?.at(-1)?.url,
        sourceUrl: basic.url,
        sourceId: basic.id,
        extractor: "YouTube.js",
    };
}

async function saveStream(stream, filePath, maxBytes, options) {
    const handle = await fs.open(filePath, "wx");
    let bytes = 0;

    try {
        for await (const chunk of stream) {
            if (options.signal?.aborted)
                throw Object.assign(new Error("The download was cancelled."), { name: "AbortError" });
            bytes += chunk.byteLength;
            if (bytes > maxBytes) {
                throw userError(`The source exceeded ${formatBytes(maxBytes)}.`, "FILE_TOO_LARGE", {
                    stopFallback: true,
                });
            }
            await handle.write(chunk);
            options.onProgress?.({ downloadedBytes: bytes, totalBytes: null });
        }
    } finally {
        await handle.close();
    }
}

export async function downloadWithYouTubeJs(rawUrl, attemptDir, options = {}) {
    const id = youtubeId(rawUrl);
    if (!id) throw new DownloadMethodError("youtube-js", "The URL does not contain a YouTube video ID.");

    try {
        const info = await (await getClient()).getInfo(id);
        const metadata = metadataFromInfo(info);
        if (["image", "thumbnail"].includes(options.outputType)) {
            const thumbnailUrl = metadata.thumbnailUrl;
            if (!thumbnailUrl) throw new DownloadMethodError("youtube-js", "YouTube returned no thumbnail URL.");
            return {
                ...(await downloadDirectHttp(thumbnailUrl, attemptDir, {
                    ...options,
                    methodLabel: "youtube-js",
                    preferredName: `${makeSafeFileName(metadata.title, id)}.jpg`,
                })),
                metadata,
            };
        }

        const isAudio = options.outputType === "audio";
        const extension = isAudio ? "m4a" : "mp4";
        const fileName = makeSafeFileName(metadata.title, id, extension);
        const filePath = path.join(attemptDir, fileName);
        const preferredHeight = preferredVideoHeight(options.targetBytes);
        const stream = await info.download({
            type: isAudio ? "audio" : "video+audio",
            quality: isAudio || !preferredHeight ? "best" : `${preferredHeight}p`,
            format: isAudio ? "any" : "mp4",
        });
        await saveStream(stream, filePath, options.maxBytes ?? config.maxDownloadBytes, options);

        return {
            ...(await describeFile(filePath, fileName, id)),
            method: "youtube-js",
            sourceUrl: rawUrl,
            metadata,
            isAudioOnly: isAudio,
        };
    } catch (error) {
        if (error?.name === "AbortError" || error?.stopFallback || error instanceof DownloadMethodError) throw error;
        throw new DownloadMethodError("youtube-js", error.message || "YouTube.js failed.", { cause: error });
    }
}
