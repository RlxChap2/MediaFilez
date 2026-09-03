import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { DownloadMethodError, UserFacingError, userError } from "../utils/errors.js";
import { assertPublicHttpUrl } from "../utils/security.js";
import { log } from "../utils/logger.js";
import { planEngines } from "./planner.js";
import { commitArtifact, recoverArtifact, validateArtifact } from "./artifact.js";
import { downloadDirectHttp } from "./engines/directHttp.js";
import { downloadWithYtDlp } from "./engines/ytDlp.js";
import { downloadWithCobalt } from "./engines/cobalt.js";
import { downloadWithYouTubeJs } from "./engines/youtubeJs.js";
import { downloadWithGalleryDl } from "./engines/galleryDl.js";
import { downloadFromPageMetadata } from "./engines/pageMetadata.js";
import { downloadWithInstagramProxy } from "./engines/instagramProxy.js";
import { downloadFromRedditEmbed } from "./engines/redditEmbed.js";
import { downloadWithRedditProxy } from "./engines/redditProxy.js";

const DEFAULT_ENGINES = new Map([
    ["direct-http", downloadDirectHttp],
    ["yt-dlp", downloadWithYtDlp],
    ["cobalt", downloadWithCobalt],
    ["youtube-js", downloadWithYouTubeJs],
    ["gallery-dl", downloadWithGalleryDl],
    ["page-metadata", downloadFromPageMetadata],
    ["instagram-proxy", downloadWithInstagramProxy],
    ["reddit-embed", downloadFromRedditEmbed],
    ["reddit-proxy", downloadWithRedditProxy],
]);

function compactEngineError(message) {
    const detail = String(message || "Unknown engine failure")
        .replace(/\s+/g, " ")
        .trim();
    if (/you(?:'|’)ve been blocked by network security/i.test(detail)) {
        return "The source blocked this server's network address.";
    }
    return detail.length > 800 ? `${detail.slice(0, 797)}...` : detail;
}

function abortError() {
    return userError(
        "The job timed out before the download finished. Try a smaller file or a faster source.",
        "JOB_TIMEOUT",
        { stopFallback: true },
    );
}

function publicFailure(attempts, outputType) {
    const messages = attempts.map((attempt) => attempt.error).join(" ");
    const engines = [...new Set(attempts.map((attempt) => attempt.engine))].join(", ");
    if (attempts.length === 0) {
        return "No download engine is enabled for this URL. Check DISABLED_ENGINES and engine configuration.";
    }
    if (/FFmpeg|FFprobe/i.test(messages) && /not installed|unavailable|ENOENT/i.test(messages)) {
        return "FFmpeg or FFprobe is unavailable. Reinstall dependencies or configure FFMPEG_PATH and FFPROBE_PATH.";
    }
    if (/gallery-dl is unavailable/i.test(messages) && attempts.length === 1) {
        return "gallery-dl is unavailable. Run pnpm run tools:install, set GALLERY_DL_PATH, or use Docker.";
    }
    if (outputType !== "auto" && /contains image media, not video|returned image media/i.test(messages)) {
        return "The source is an image. Choose image output and try again.";
    }
    if (/account authentication|cookies|login required|empty media response/i.test(messages)) {
        return "This post needs an authenticated session. Export fresh browser cookies to MEDIA_COOKIES_FILE, then try again.";
    }
    if (/HTTP (?:Error )?403|forbidden|blocked this server's network address/i.test(messages)) {
        return "This source blocked automated access (HTTP 403), and no enabled engine could extract its media. Try a direct media URL or another source.";
    }
    if (/unsupported url|no suitable extractor/i.test(messages)) {
        return "This site or URL is not supported by the enabled download engines.";
    }
    if (/rate.?limit|too many requests|HTTP 429/i.test(messages)) {
        return "The source or a configured download service is rate-limiting requests. Try again later.";
    }
    const outputLabel = outputType === "auto" ? "media" : outputType;
    return `No playable ${outputLabel} came back after trying: ${engines}. The post may be unavailable, expired, or unsupported.`;
}

export async function downloadMedia(rawUrl, jobDir, options = {}) {
    await assertPublicHttpUrl(rawUrl);
    const outputType = options.outputType ?? "video";
    const maxBytes = options.maxBytes ?? config.maxDownloadBytes;
    const engineRegistry = options.engines ?? DEFAULT_ENGINES;
    const plan = options.plan ?? planEngines(rawUrl, outputType);
    const attempts = [];

    for (const [index, engineName] of plan.entries()) {
        if (options.signal?.aborted) throw abortError();
        const engine = engineRegistry.get(engineName);
        if (!engine) continue;
        const attemptDir = path.join(jobDir, `attempt-${String(index + 1).padStart(2, "0")}-${engineName}`);
        await fs.mkdir(attemptDir, { recursive: true });
        const startedAt = performance.now();
        await options.onStatus?.({
            phase: "resolving",
            engine: engineName,
            attempt: index + 1,
            totalAttempts: plan.length,
        });

        try {
            const candidate = await engine(rawUrl, attemptDir, {
                ...options,
                maxBytes,
                outputType,
                onProgress: (progress) => options.onStatus?.({ phase: "downloading", engine: engineName, progress }),
            });
            const validated = await validateArtifact(candidate, {
                outputType,
                maxBytes,
                preferredName: candidate.fileName,
                signal: options.signal,
            });
            const committed = await commitArtifact({ ...candidate, ...validated }, jobDir);
            return {
                ...committed,
                method: candidate.method || engineName,
                metadata: candidate.metadata ?? null,
                attempts,
                recovered: Boolean(candidate.recoveredFromProcessError),
            };
        } catch (error) {
            if (error instanceof UserFacingError && error.stopFallback) throw error;
            if (error?.name === "AbortError" || options.signal?.aborted) throw abortError();

            const recovered = await recoverArtifact(attemptDir, { outputType, maxBytes, signal: options.signal });
            if (recovered) {
                log.warn(
                    `${engineName} failed after producing a valid artifact; committing the artifact and stopping fallback.`,
                );
                return {
                    ...(await commitArtifact(recovered, jobDir)),
                    method: engineName,
                    metadata: null,
                    attempts,
                    recovered: true,
                };
            }

            const detail = compactEngineError(
                error instanceof DownloadMethodError ? error.publicMessage : error.message,
            );
            attempts.push({ engine: engineName, error: detail, elapsedMs: performance.now() - startedAt });
            log.warn(`${engineName} failed: ${detail}`);
            await fs.rm(attemptDir, { recursive: true, force: true });
        }
    }

    const error = userError(publicFailure(attempts, outputType), "DOWNLOAD_FAILED");
    error.attempts = attempts;
    throw error;
}

export { DEFAULT_ENGINES };
