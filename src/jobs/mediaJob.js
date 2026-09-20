import PQueue from "p-queue";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { config, DISCORD_HARD_MAX_BYTES } from "../config.js";
import { FILE_LIMITS, OUTPUT_TYPES } from "../utils/constants.js";
import { createRequestTempDir, cleanupTempDir, tempOwnershipSignal } from "../utils/temp.js";
import { formatBytes, formatElapsed } from "../utils/format.js";
import { isUserFacingError, userError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { downloadMedia } from "../download/orchestrator.js";
import { prepareMediaForDiscord } from "../media/processor.js";
import { ReplySession } from "../platform/discord/replySession.js";

const queue = new PQueue({ concurrency: config.maxConcurrentJobs });
const activeByUser = new Map();

const PUBLIC_DELIVERY_PERMISSIONS = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.AttachFiles, "Attach Files"],
];

function missingGuildDeliveryPermissions(interaction, publicRepliesInGuilds = config.publicRepliesInGuilds) {
    if (!publicRepliesInGuilds || !interaction.inGuild()) return [];
    if (!interaction.authorizingIntegrationOwners?.guildId) return [];

    const required = [...PUBLIC_DELIVERY_PERMISSIONS];
    if (interaction.channel?.isThread()) {
        required.push([PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"]);
    }

    return required.filter(([permission]) => !interaction.appPermissions.has(permission)).map(([, label]) => label);
}

function requireGuildDeliveryPermissions(interaction) {
    const missing = missingGuildDeliveryPermissions(interaction);
    if (missing.length === 0) return;
    throw userError(
        `MediaFilez is missing Discord permissions in this channel: ${missing.join(", ")}. Ask a server administrator to update the bot role or use the command in a DM.`,
        "MISSING_DISCORD_PERMISSIONS",
    );
}

function privateReplyForInteraction(interaction, publicRepliesInGuilds = config.publicRepliesInGuilds) {
    const requestedPrivate = interaction.options.getBoolean("private") ?? false;
    if (requestedPrivate) return true;
    return interaction.inGuild() && !publicRepliesInGuilds;
}

function uploadTargetBytesForInteraction(interaction, configuredTargetBytes = config.discordUploadTargetBytes) {
    return Math.min(
        interaction.attachmentSizeLimit || FILE_LIMITS.DEFAULT_UPLOAD,
        configuredTargetBytes,
        DISCORD_HARD_MAX_BYTES,
    );
}

function acquireUserSlot(userId) {
    const active = activeByUser.get(userId) ?? 0;
    if (active >= config.maxConcurrentJobsPerUser) {
        throw userError(
            `You already have ${active} media job${active === 1 ? "" : "s"} running or queued. Wait for one to finish.`,
            "USER_BUSY",
        );
    }
    activeByUser.set(userId, active + 1);
}

function releaseUserSlot(userId) {
    const active = activeByUser.get(userId) ?? 0;
    if (active <= 1) activeByUser.delete(userId);
    else activeByUser.set(userId, active - 1);
}

function jobTimeoutError(cause) {
    return userError(
        "The job timed out before the download finished. Try a smaller file or a faster source.",
        "JOB_TIMEOUT",
        { cause },
    );
}

/**
 * Executes a media download, prepares the result for Discord, and commits it to the reply.
 * @param {Object} interaction - The Discord interaction associated with the media job.
 * @param {Object} reply - The reply session used to report progress and deliver the result.
 * @param {Object} request - The media request, including its URL, output type, and compression preference.
 */
async function runMediaJob(interaction, reply, request, options = {}) {
    const deadlineController = options.signal ? null : new AbortController();
    const deadlineSignal = options.signal ?? deadlineController.signal;
    const deadlineTimeout = deadlineController
        ? setTimeout(
              () => deadlineController.abort(new DOMException("The media job timed out.", "TimeoutError")),
              config.jobTimeoutMs,
          )
        : null;
    const signal = AbortSignal.any([deadlineSignal, tempOwnershipSignal]);
    const executeDownload = options.downloadMedia ?? downloadMedia;
    const uploadTargetBytes = uploadTargetBytesForInteraction(interaction);
    let tempDir;

    try {
        tempDir = await createRequestTempDir();
        const downloadStarted = performance.now();
        const download = await executeDownload(request.url, tempDir, {
            outputType: request.outputType,
            maxBytes: config.maxDownloadBytes,
            targetBytes: uploadTargetBytes,
            signal,
            onStatus: (status) => reply.update(status),
        });
        const downloadMs = performance.now() - downloadStarted;

        const processStarted = performance.now();
        const output = await prepareMediaForDiscord(download, {
            outputType: request.outputType,
            tempDir,
            maxAttachmentBytes: uploadTargetBytes,
            allowCompression: request.fitToLimit,
            signal,
            onStatus: (status) => reply.update(status),
        });
        const processMs = performance.now() - processStarted;
        log.info(
            `Prepared ${output.fileName} (${formatBytes(output.sizeBytes)}; ${output.sizeBytes} bytes) in ${formatElapsed(processMs)}. Upload target: ${uploadTargetBytes} bytes.`,
        );

        await reply.update(
            { phase: "uploading", detail: `Uploading ${formatBytes(output.sizeBytes)} to Discord` },
            { force: true },
        );
        await reply.commit(
            output,
            {
                method: download.method,
                downloadMs,
                processMs,
                uploadTargetBytes,
                recovered: download.recovered,
                metadata: download.metadata,
            },
            { signal },
        );

        log.info(`Completed media job for ${interaction.user.tag}: ${output.fileName} via ${download.method}`);
    } catch (caught) {
        const error = tempOwnershipSignal.aborted
            ? tempOwnershipSignal.reason
            : deadlineSignal.aborted && !isUserFacingError(caught)
              ? jobTimeoutError(caught)
              : caught;
        if (isUserFacingError(error)) {
            log.warn(`Media job ended for ${interaction.user.tag} (${error.code}): ${error.message}`);
        } else {
            log.error(`Media job failed for ${interaction.user.tag}:`, error.stack || error.message);
        }
        await reply.fail(error);
    } finally {
        if (deadlineTimeout) clearTimeout(deadlineTimeout);
        await cleanupTempDir(tempDir);
    }
}

export async function enqueue(interaction, reply, request, options = {}) {
    const jobQueue = options.queue ?? queue;
    if (jobQueue.size >= config.maxQueueSize)
        throw userError("The download queue is full. Try again in a minute.", "QUEUE_FULL");

    acquireUserSlot(interaction.user.id);
    const timeoutMs = options.timeoutMs ?? config.jobTimeoutMs;
    const deadlineAt = Date.now() + timeoutMs;
    const queueController = new AbortController();
    const queueTimeout = setTimeout(
        () => queueController.abort(new DOMException("The media request timed out in the queue.", "TimeoutError")),
        timeoutMs,
    );

    try {
        if (jobQueue.pending >= config.maxConcurrentJobs) {
            const position = jobQueue.size + 1;
            await reply.update({ phase: "queued", detail: `Queue position: ${position}` }, { force: true });
        }

        await jobQueue.add(
            async () => {
                clearTimeout(queueTimeout);
                const remainingMs = Math.max(1, deadlineAt - Date.now());
                const runController = new AbortController();
                const runTimeout = setTimeout(
                    () => runController.abort(new DOMException("The media job timed out.", "TimeoutError")),
                    remainingMs,
                );
                try {
                    await runMediaJob(interaction, reply, request, { signal: runController.signal });
                } finally {
                    clearTimeout(runTimeout);
                }
            },
            { signal: queueController.signal },
        );
    } finally {
        clearTimeout(queueTimeout);
        releaseUserSlot(interaction.user.id);
    }
}

/**
 * Handles a media command by validating its options, deferring the Discord reply, and queuing the requested job.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction - The Discord command interaction containing the media URL and output options.
 */
export async function handleMediaCommand(interaction) {
    const privateReply = privateReplyForInteraction(interaction);
    if (!privateReply) requireGuildDeliveryPermissions(interaction);
    const deferOptions = privateReply ? { flags: MessageFlags.Ephemeral } : {};
    await interaction.deferReply(deferOptions);
    log.info(`/media from ${interaction.user.tag} context=${interaction.context ?? "unknown"}`);

    const outputType = interaction.options.getString("output", true);
    if (!OUTPUT_TYPES.has(outputType)) throw userError("Unsupported output type.", "BAD_OUTPUT_TYPE");
    const reply = new ReplySession(interaction);

    try {
        await enqueue(interaction, reply, {
            url: interaction.options.getString("url", true),
            outputType,
            fitToLimit: interaction.options.getBoolean("fit_to_limit") ?? true,
        });
    } catch (error) {
        if (isUserFacingError(error)) log.warn(`Could not queue media job (${error.code}): ${error.message}`);
        else log.error(`Could not queue media job: ${error.stack || error.message}`);
        await reply.fail(error);
    }
}

export { missingGuildDeliveryPermissions, privateReplyForInteraction, runMediaJob, uploadTargetBytesForInteraction };
