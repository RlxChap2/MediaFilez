import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { downloadDirectHttp } from "../download/engines/directHttp.js";
import { userError } from "../utils/errors.js";

const PHASES = new Set(["queued", "resolving", "downloading", "processing", "uploading"]);

export function mediaApiEnabled() {
    return Boolean(config.mediaApiUrl && config.mediaApiKey);
}

function endpoint(pathname) {
    if (!config.mediaApiUrl) throw new Error("MEDIA_API_URL is not configured.");
    return `${config.mediaApiUrl}/api/v1${pathname}`;
}

function remoteError(response, body) {
    const message = body?.error?.message || body?.message || `Media API returned HTTP ${response.status}.`;
    return userError(message, body?.error?.code || "MEDIA_API_ERROR", { cause: body });
}

function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryableNetworkError(error) {
    return (
        error?.name === "AbortError" ||
        error?.name === "TimeoutError" ||
        ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code)
    );
}

async function waitForRetry(attempt, signal) {
    await sleep(config.mediaApiRetryDelayMs * 2 ** attempt, undefined, signal ? { signal } : undefined);
}

async function request(pathname, options = {}) {
    if (!config.mediaApiKey) throw userError("The Media API key is not configured.", "MEDIA_API_NOT_CONFIGURED");
    let lastNetworkError;
    for (let attempt = 0; attempt <= config.mediaApiRetries; attempt += 1) {
        const timeout = AbortSignal.timeout(config.mediaApiRequestTimeoutMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        let response;
        try {
            response = await fetch(endpoint(pathname), {
                ...options,
                signal,
                headers: {
                    accept: "application/json",
                    authorization: `ApiKey ${config.mediaApiKey}`,
                    ...(options.body ? { "content-type": "application/json" } : {}),
                    ...options.headers,
                },
            });
        } catch (error) {
            if (options.signal?.aborted) throw options.signal.reason ?? error;
            lastNetworkError = error;
            if (!retryableNetworkError(error) || attempt >= config.mediaApiRetries) {
                throw userError("The Media API could not be reached. Try again shortly.", "MEDIA_API_UNAVAILABLE", {
                    cause: error,
                });
            }
            await waitForRetry(attempt, options.signal);
            continue;
        }
        const body = await response.json().catch(() => null);
        if (response.ok) return body;
        if (!retryableStatus(response.status) || attempt >= config.mediaApiRetries) throw remoteError(response, body);
        await waitForRetry(attempt, options.signal);
    }
    throw userError("The Media API could not be reached. Try again shortly.", "MEDIA_API_UNAVAILABLE", {
        cause: lastNetworkError,
    });
}

function phaseForJob(job) {
    if (job.status === "queued") return "queued";
    if (job.status === "failed") return "failed";
    if (job.status === "completed") return "completed";
    return PHASES.has(job.phase) ? job.phase : "processing";
}

export async function downloadWithMediaApi(url, tempDir, options = {}) {
    const created = await request("/media/download", {
        method: "POST",
        signal: options.signal,
        headers: { "idempotency-key": options.idempotencyKey || `media-${randomUUID()}` },
        body: JSON.stringify({
            url,
            output: { type: options.outputType || "auto", format: "original", quality: "best" },
            processing: { fitToLimit: Boolean(options.targetBytes && options.allowCompression !== false) },
            limits: options.targetBytes
                ? { maxBytes: options.targetBytes, maxDownloadBytes: config.mediaApiMaxDownloadBytes }
                : undefined,
        }),
    });
    let job = created?.job;
    if (!job?.id) throw userError("The Media API did not return a job.", "MEDIA_API_INVALID_RESPONSE");
    const deadline = Date.now() + (options.timeoutMs ?? config.jobTimeoutMs);
    while (!job || !["completed", "failed", "cancelled", "expired"].includes(job.status)) {
        options.onStatus?.({ phase: phaseForJob(job), progress: { percent: job.progress ?? 0 } });
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw userError("The Media API job timed out before the Worker finished.", "JOB_TIMEOUT");
        await sleep(Math.min(config.mediaApiPollIntervalMs, remaining), undefined, { signal: options.signal });
        job = (await request(`/jobs/${encodeURIComponent(job.id)}`, { signal: options.signal }))?.job;
        if (!job) throw userError("The Media API returned an empty job status.", "MEDIA_API_INVALID_RESPONSE");
    }
    if (job.status !== "completed") {
        throw userError(
            job.error?.message || "The Worker could not complete the media job.",
            job.error?.code || "WORKER_FAILED",
        );
    }
    options.onStatus?.({ phase: "uploading", progress: { percent: 100 } });
    const fileId = job.result?.fileId;
    if (typeof fileId !== "string")
        throw userError("The completed job did not include a downloadable file.", "MEDIA_API_INVALID_RESPONSE");
    const file = (await request(`/files/${encodeURIComponent(fileId)}`, { signal: options.signal }))?.file;
    if (!file?.url || !file.fileName)
        throw userError("The Media API did not return a valid file URL.", "MEDIA_API_INVALID_RESPONSE");
    const signedUrl = new URL(file.url);
    const artifact = await downloadDirectHttp(file.url, tempDir, {
        signal: options.signal,
        preferredName: file.fileName,
        maxBytes: options.targetBytes || config.maxDownloadBytes,
        trustedHosts: [signedUrl.hostname],
        methodLabel: "media-api-worker",
    });
    const remoteProcessingMs =
        job.startedAt && job.completedAt
            ? Math.max(0, new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime())
            : 0;
    return {
        ...artifact,
        method: "media-api-worker",
        remoteProcessingMs,
        metadata: { ...(artifact.metadata || {}), fileId },
    };
}

export async function publishDiscordPresence(client) {
    if (!mediaApiEnabled()) return;
    const guildIds = [...client.guilds.cache.keys()];
    await request("/internal/discord/presence", {
        method: "POST",
        body: JSON.stringify({
            applicationId: client.application?.id || config.clientId,
            botUserId: client.user.id,
            guildIds,
            observedAt: new Date().toISOString(),
        }),
    });
}
