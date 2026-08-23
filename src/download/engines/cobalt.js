import { config } from "../../config.js";
import { DownloadMethodError } from "../../utils/errors.js";
import { assertPublicHttpUrl } from "../../utils/security.js";
import { downloadDirectHttp } from "./directHttp.js";

let directoryCache = { expiresAt: 0, endpoints: [] };
const endpointCooldowns = new Map();
let endpointCursor = 0;

function uniqueEndpoints(values) {
    const result = new Set();
    for (const value of values) {
        try {
            result.add(new URL(value).href.replace(/\/$/, ""));
        } catch {
            /* Invalid setting. */
        }
    }
    return [...result];
}

async function directoryEndpoints(signal) {
    if (!config.cobaltDirectoryEnabled) return [];
    if (directoryCache.expiresAt > Date.now()) return directoryCache.endpoints;

    try {
        const response = await fetch(config.cobaltDirectoryUrl, {
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
            headers: { accept: "application/json", "user-agent": config.userAgent },
        });

        if (!response.ok) return [];
        const data = await response.json();
        const endpoints = Object.values(data?.data ?? {})
            .flat()
            .filter((value) => typeof value === "string");
        directoryCache = { expiresAt: Date.now() + 30 * 60_000, endpoints: uniqueEndpoints(endpoints) };

        return directoryCache.endpoints;
    } catch {
        return [];
    }
}

function payload(rawUrl, outputType) {
    return {
        url: rawUrl,
        videoQuality: "max",
        youtubeVideoCodec: "h264",
        youtubeVideoContainer: "mp4",
        audioFormat: outputType === "audio" ? "mp3" : "best",
        downloadMode: outputType === "audio" ? "audio" : "auto",
        filenameStyle: "basic",
        disableMetadata: false,
        localProcessing: "disabled",
    };
}

function headers() {
    const result = { accept: "application/json", "content-type": "application/json", "user-agent": config.userAgent };
    if (config.cobaltApiKey) result.authorization = `${config.cobaltAuthScheme} ${config.cobaltApiKey}`;
    return result;
}

function mediaFromResponse(data, outputType) {
    if (typeof data?.url === "string") return { url: data.url, fileName: data.filename };
    if (outputType === "audio" && typeof data?.audio === "string") {
        return { url: data.audio, fileName: data.audioFilename || data.filename };
    }
    const picker = Array.isArray(data?.picker) ? data.picker : [];

    const preferred =
        picker.find((item) => {
            if (!item?.url) return false;
            if (["image", "thumbnail"].includes(outputType)) return ["photo", "image"].includes(item.type);
            if (outputType === "audio") return item.type === "audio";
            return ["video", "gif"].includes(item.type) || !item.type;
        }) || picker.find((item) => item?.url);

    return preferred ? { url: preferred.url, fileName: preferred.filename || data.filename } : null;
}

function availableEndpoints(endpoints) {
    const now = Date.now();
    const offset = endpointCursor % endpoints.length;
    endpointCursor += 1;
    const rotated = [...endpoints.slice(offset), ...endpoints.slice(0, offset)];
    const available = rotated.filter((endpoint) => (endpointCooldowns.get(endpoint) ?? 0) <= now);
    if (available.length > 0) return available;
    return rotated.sort(
        (left, right) => (endpointCooldowns.get(left) ?? 0) - (endpointCooldowns.get(right) ?? 0),
    );
}

export function resetCobaltEndpointHealth() {
    endpointCooldowns.clear();
    endpointCursor = 0;
}

function cobaltMessage(data, status) {
    return data?.error?.context?.service || data?.error?.code || data?.text || `Cobalt returned HTTP ${status}.`;
}

async function callEndpoint(endpoint, rawUrl, attemptDir, options) {
    const endpointUrl = await assertPublicHttpUrl(endpoint, { trustedHosts: [new URL(endpoint).hostname] });
    const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(config.cobaltEndpointTimeoutMs)])
        : AbortSignal.timeout(config.cobaltEndpointTimeoutMs);
    const response = await fetch(endpointUrl, {
        method: "POST",
        signal,
        headers: headers(),
        body: JSON.stringify(payload(rawUrl, options.outputType)),
    });

    const text = await response.text();
    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new DownloadMethodError("cobalt", `Cobalt returned non-JSON HTTP ${response.status}.`);
    }

    if (!response.ok || data?.status === "error")
        throw new DownloadMethodError("cobalt", cobaltMessage(data, response.status));

    if (data?.status === "local-processing")
        throw new DownloadMethodError("cobalt", "This Cobalt response requires local processing, which was disabled.");

    const media = mediaFromResponse(data, options.outputType);
    if (!media)
        throw new DownloadMethodError(
            "cobalt",
            `Cobalt returned ${data?.status || "an unknown status"} without downloadable media.`,
        );

    const file = await downloadDirectHttp(media.url, attemptDir, {
        ...options,
        preferredName: media.fileName,
        methodLabel: `cobalt:${endpointUrl.hostname}`,
        trustedHosts: [endpointUrl.hostname],
    });

    return {
        ...file,
        metadata: data.metadata
            ? {
                  title: data.metadata.title,
                  creator: data.metadata.artist || data.metadata.author,
                  durationSeconds: data.metadata.duration,
                  sourceUrl: rawUrl,
                  extractor: "Cobalt",
              }
            : { sourceUrl: rawUrl, extractor: "Cobalt" },
    };
}

export async function downloadWithCobalt(rawUrl, attemptDir, options = {}) {
    const endpoints = uniqueEndpoints([
        ...config.cobaltApiEndpoints,
        ...(await directoryEndpoints(options.signal)),
    ]).slice(0, config.cobaltMaxEndpoints);
    if (endpoints.length === 0) throw new DownloadMethodError("cobalt", "No Cobalt instance is configured.");

    const failures = [];
    for (const endpoint of availableEndpoints(endpoints)) {
        try {
            const result = await callEndpoint(endpoint, rawUrl, attemptDir, options);
            endpointCooldowns.delete(endpoint);
            return result;
        } catch (error) {
            if (error?.name === "AbortError" || error?.stopFallback) throw error;
            endpointCooldowns.set(endpoint, Date.now() + config.cobaltFailureCooldownMs);
            failures.push(`${new URL(endpoint).hostname}: ${error.publicMessage || error.message}`);
        }
    }
    throw new DownloadMethodError("cobalt", failures.slice(0, 3).join(" | "));
}
