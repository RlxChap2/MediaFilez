import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../config.js";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10/";
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class DiscordUploadError extends Error {
    constructor(message, options = {}) {
        super(message, { cause: options.cause });
        this.name = "DiscordUploadError";
        this.status = options.status;
        this.code = options.code;
        this.retryAfterMs = options.retryAfterMs;
    }
}

function normalizeApiBaseUrl(value) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new TypeError("The Discord API base URL is invalid.");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url;
}

function safeHeaderFileName(value) {
    const baseName = path.basename(String(value || "attachment.bin"));
    const ascii = baseName.replace(/[^\x20-\x7e]|["\\]/g, "_").slice(0, 180);
    return ascii || "attachment.bin";
}

function encodedFileName(value) {
    return encodeURIComponent(path.basename(String(value || "attachment.bin"))).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function multipartParts(boundary, payload, fileName) {
    const payloadJson = JSON.stringify({
        content: payload.content,
        allowed_mentions: { parse: [] },
        attachments: [{ id: 0, filename: fileName }],
    });
    const prefix = Buffer.from(
        `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="payload_json"\r\n' +
            "Content-Type: application/json\r\n\r\n" +
            `${payloadJson}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="files[0]"; filename="${safeHeaderFileName(fileName)}"; filename*=UTF-8''${encodedFileName(fileName)}\r\n` +
            "Content-Type: application/octet-stream\r\n\r\n",
        "utf8",
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    return { prefix, suffix };
}

async function readResponse(response) {
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
            response.destroy();
            throw new DiscordUploadError("Discord returned an unexpectedly large upload response.", {
                status: response.statusCode,
                code: "DISCORD_RESPONSE_TOO_LARGE",
            });
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

function parseResponseBody(body) {
    if (!body) return null;
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function errorFromResponse(response, body) {
    const data = parseResponseBody(body);
    const status = response.statusCode ?? 0;
    const detail = String(data?.message || response.statusMessage || "upload rejected").slice(0, 500);
    const retryAfterSeconds = Number(data?.retry_after ?? response.headers["retry-after"]);
    return new DiscordUploadError(`Discord rejected the upload (${status}): ${detail}`, {
        status,
        code: data?.code,
        retryAfterMs: Number.isFinite(retryAfterSeconds) ? Math.max(0, retryAfterSeconds * 1000) : undefined,
    });
}

function responsePromiseFor(request) {
    return new Promise((resolve, reject) => {
        request.once("response", async (response) => {
            try {
                const body = await readResponse(response);
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(parseResponseBody(body));
                    return;
                }
                reject(errorFromResponse(response, body));
            } catch (error) {
                reject(error);
            }
        });
        request.once("error", reject);
    });
}

function settle(promise) {
    return promise.then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
    );
}

export function createDiscordUploader(options = {}) {
    const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? DISCORD_API_BASE_URL);
    const timeoutMs = options.timeoutMs ?? config.discordRestTimeoutMs;
    const transport = apiBaseUrl.protocol === "https:" ? https : http;

    return async function uploadDiscordReply(interaction, payload, requestOptions = {}) {
        const applicationId = String(interaction.applicationId || interaction.client?.application?.id || "");
        const interactionToken = String(interaction.token || "");
        if (!/^\d+$/.test(applicationId) || !interactionToken) {
            throw new TypeError("The Discord interaction does not contain a valid application ID and token.");
        }

        const stat = await fsPromises.stat(payload.filePath);
        if (!stat.isFile() || (Number.isFinite(payload.sizeBytes) && stat.size !== payload.sizeBytes)) {
            throw new DiscordUploadError("The prepared attachment changed before it could be uploaded.", {
                code: "ATTACHMENT_CHANGED",
            });
        }

        const boundary = `MediaFilez-${crypto.randomBytes(18).toString("hex")}`;
        const { prefix, suffix } = multipartParts(boundary, payload, payload.fileName);
        const contentLength = prefix.length + stat.size + suffix.length;
        const endpoint = new URL(
            `webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
            apiBaseUrl,
        );
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeoutSignal]) : timeoutSignal;
        const request = transport.request(endpoint, {
            method: "PATCH",
            signal,
            headers: {
                Accept: "application/json",
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(contentLength),
                "User-Agent": config.userAgent,
            },
        });
        async function* body() {
            yield prefix;
            yield* fs.createReadStream(payload.filePath);
            yield suffix;
        }

        const bodyStream = Readable.from(body());
        const responseOutcomePromise = settle(responsePromiseFor(request));
        const uploadOutcomePromise = settle(pipeline(bodyStream, request, { signal }));
        const first = await Promise.race([
            uploadOutcomePromise.then((outcome) => ({ source: "upload", outcome })),
            responseOutcomePromise.then((outcome) => ({ source: "response", outcome })),
        ]);

        if (first.source === "response" && !request.writableFinished) {
            bodyStream.destroy();
            request.destroy();
            await uploadOutcomePromise;
        }

        const uploadOutcome = first.source === "upload" ? first.outcome : await uploadOutcomePromise;
        const responseOutcome = first.source === "response" ? first.outcome : await responseOutcomePromise;
        if (responseOutcome.status === "fulfilled") return responseOutcome.value;
        if (responseOutcome.reason instanceof DiscordUploadError) throw responseOutcome.reason;
        if (uploadOutcome.status === "rejected") throw uploadOutcome.reason;
        throw responseOutcome.reason;
    };
}

export const uploadDiscordReply = createDiscordUploader();
