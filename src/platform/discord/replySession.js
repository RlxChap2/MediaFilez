import { config } from "../../config.js";
import { DeliveryUnknownError, messageForError, userError } from "../../utils/errors.js";
import { formatBytes, formatElapsed } from "../../utils/format.js";
import { log } from "../../utils/logger.js";
import { uploadDiscordReply } from "./discordUpload.js";

const PHASE_COPY = {
    queued: "Queued",
    resolving: "Resolving the source",
    downloading: "Downloading",
    processing: "Processing media",
    uploading: "Uploading to Discord",
};

function progressText(progress) {
    if (!progress) return "";
    if (Number.isFinite(progress.percent)) {
        const bytes =
            progress.downloadedBytes && progress.totalBytes
                ? ` | ${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : "";
        return ` | ${Math.min(progress.percent, 100).toFixed(1)}%${bytes}`;
    }
    if (progress.downloadedBytes) {
        const total = progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : "";
        return ` | ${formatBytes(progress.downloadedBytes)}${total}`;
    }
    return "";
}

function statusCopy(status) {
    const base = status.detail || PHASE_COPY[status.phase] || "Working";
    const engine = status.engine ? ` with ${status.engine}` : "";
    return `${base}${engine}${progressText(status.progress)}...`;
}

function deliveredCopy(output, details) {
    const lines = [
        `Ready: **${output.fileName}** (${formatBytes(output.sizeBytes)})`,
        `-# engine: ${details.method} | download: ${formatElapsed(details.downloadMs)} | process: ${formatElapsed(details.processMs)}`,
        `-# Upload target here: ${formatBytes(details.uploadTargetBytes)}`,
    ];
    const title = details.metadata?.title?.trim();
    const creator = details.metadata?.creator?.trim();
    if (title && title !== output.fileName) {
        lines.splice(1, 0, `-# ${title.slice(0, 160)}${creator ? ` | ${creator.slice(0, 80)}` : ""}`);
    }
    if (output.note) lines.push(`-# ${output.note}`);
    if (details.recovered) lines.push("-# Recovered a complete file after the downloader exited with an error.");
    return lines.join("\n");
}

function hasExpectedAttachment(message, expected) {
    const attachments = message?.attachments;
    if (!attachments) return false;
    const values = typeof attachments.values === "function" ? [...attachments.values()] : attachments;
    return [...values].some((attachment) => {
        const sizeMatches = !expected.sizeBytes || !attachment.size || attachment.size === expected.sizeBytes;
        return attachment.name === expected.fileName && sizeMatches;
    });
}

function errorChain(error) {
    const errors = [];
    let current = error;
    while (current && !errors.includes(current)) {
        errors.push(current);
        current = current.cause;
    }
    return errors;
}

function isRetryableUploadError(error) {
    const retryableCodes = new Set(["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
    return errorChain(error).some(
        (item) =>
            item?.name === "AbortError" ||
            item?.name === "SocketError" ||
            retryableCodes.has(item?.code) ||
            Number(item?.status) === 429 ||
            Number(item?.status) >= 500 ||
            /other side closed|socket closed|connection reset|timed out/i.test(item?.message || ""),
    );
}

function uploadErrorSummary(error) {
    const item = errorChain(error).find((candidate) => candidate?.code || candidate?.message) ?? error;
    const code = item?.code ? `${item.code}: ` : "";
    return `${code}${item?.message || "unknown upload error"}`;
}

function uploadFailure(error, attempts) {
    const codes = errorChain(error).map((item) => item?.code);
    if (codes.includes(40005) || error?.status === 413) {
        return userError(
            "Discord rejected the attachment as too large even though it was below the advertised limit. Try a smaller upload limit.",
            "DISCORD_UPLOAD_TOO_LARGE",
            { cause: error },
        );
    }
    if (codes.includes(10015) || codes.includes(10062)) {
        return userError(
            "The Discord interaction expired before the upload finished. Try the command again.",
            "INTERACTION_EXPIRED",
            { cause: error },
        );
    }
    return userError(
        `Discord closed the upload connection before accepting the file after ${attempts} attempt${attempts === 1 ? "" : "s"}. Try the command again.`,
        "DISCORD_UPLOAD_FAILED",
        { cause: error },
    );
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ReplySession {
    constructor(interaction, options = {}) {
        this.interaction = interaction;
        this.state = "open";
        this.lastPhase = null;
        this.lastUpdateAt = 0;
        this.intervalMs = options.intervalMs ?? config.statusUpdateIntervalMs;
        this.uploadAttempts = options.uploadAttempts ?? config.discordUploadAttempts;
        this.uploadRetryDelayMs = options.uploadRetryDelayMs ?? config.discordUploadRetryDelayMs;
        this.upload = options.upload ?? uploadDiscordReply;
        this.wait = options.wait ?? wait;
        this.pendingUpdate = Promise.resolve();
    }

    update(status, options = {}) {
        if (this.state !== "open") return this.pendingUpdate;
        const now = Date.now();
        const phaseChanged = status.phase !== this.lastPhase;
        if (!options.force && !phaseChanged && now - this.lastUpdateAt < this.intervalMs) return this.pendingUpdate;
        this.lastPhase = status.phase;
        this.lastUpdateAt = now;
        this.pendingUpdate = this.pendingUpdate
            .then(() => (this.state === "open" ? this.interaction.editReply({ content: statusCopy(status) }) : null))
            .catch((error) => log.warn(`Could not update job status: ${error.message}`));
        return this.pendingUpdate;
    }

    async commit(output, details, options = {}) {
        if (this.state !== "open") throw new Error(`Cannot commit a reply in state ${this.state}.`);
        await this.pendingUpdate;
        this.state = "committing";

        for (let attempt = 1; attempt <= this.uploadAttempts; attempt += 1) {
            const payload = {
                content: deliveredCopy(output, details),
                filePath: output.filePath,
                fileName: output.fileName,
                sizeBytes: output.sizeBytes,
            };
            log.info(
                `Discord upload attempt ${attempt}/${this.uploadAttempts}: ${output.fileName} (${formatBytes(output.sizeBytes)}).`,
            );

            try {
                await this.upload(this.interaction, payload, { signal: options.signal });
                this.state = "committed";
                return;
            } catch (uploadError) {
                let verificationError;
                for (let verification = 1; verification <= 3; verification += 1) {
                    try {
                        const message = await this.interaction.fetchReply();
                        if (hasExpectedAttachment(message, output)) {
                            this.state = "committed";
                            log.warn(
                                "Discord upload call failed, but the attachment is present on the original response.",
                            );
                            return;
                        }
                        verificationError = null;
                        break;
                    } catch (error) {
                        verificationError = error;
                        if (verification < 3 && isRetryableUploadError(error)) {
                            await this.wait(this.uploadRetryDelayMs * verification);
                            continue;
                        }
                        break;
                    }
                }

                if (verificationError) {
                    this.state = "unknown";
                    throw new DeliveryUnknownError(
                        "Discord did not confirm whether the upload finished. Check the original response before trying again.",
                        { cause: uploadError },
                    );
                }

                if (options.signal?.aborted) {
                    this.state = "open";
                    throw userError(
                        "The job timed out before Discord accepted the upload. Try again with a smaller file.",
                        "JOB_TIMEOUT",
                        { cause: uploadError },
                    );
                }

                if (!isRetryableUploadError(uploadError) || attempt === this.uploadAttempts) {
                    this.state = "open";
                    throw uploadFailure(uploadError, attempt);
                }

                log.warn(
                    `Discord did not accept upload attempt ${attempt}/${this.uploadAttempts} (${uploadErrorSummary(uploadError)}); retrying after verification.`,
                );
                await this.wait(Math.max(this.uploadRetryDelayMs * attempt, uploadError.retryAfterMs || 0));
            }
        }
    }

    async fail(error) {
        if (["committed", "committing", "unknown", "failed"].includes(this.state) || error?.responseLocked) return;
        await this.pendingUpdate;
        if (this.state !== "open") return;
        try {
            await this.interaction.editReply({
                content: `Could not finish: ${messageForError(error)}`,
                files: [],
            });
            this.state = "failed";
        } catch (replyError) {
            log.error(`Could not send the terminal error response: ${replyError.message}`);
        }
    }
}

export { hasExpectedAttachment };
