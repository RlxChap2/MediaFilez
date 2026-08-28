import PQueue from "p-queue";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { config, DISCORD_HARD_MAX_BYTES } from "../config.js";
import { FILE_LIMITS, OUTPUT_TYPES } from "../utils/constants.js";
import { createRequestTempDir, cleanupTempDir } from "../utils/temp.js";
import { formatBytes, formatElapsed } from "../utils/format.js";
import { userError } from "../utils/errors.js";
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

    return required
        .filter(([permission]) => !interaction.appPermissions.has(permission))
        .map(([, label]) => label);
}

function requireGuildDeliveryPermissions(interaction) {
    const missing = missingGuildDeliveryPermissions(interaction);
    if (missing.length === 0) return;
    throw userError(
        `MediaFilez is missing Discord permissions in this channel: ${missing.join(", ")}. Ask a server administrator to update the bot role or use the command in a DM.`,
        "MISSING_DISCORD_PERMISSIONS",
    );
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

async function runMediaJob(interaction, reply, request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.jobTimeoutMs);
    const uploadTargetBytes = uploadTargetBytesForInteraction(interaction);
    let tempDir;

    try {
        tempDir = await createRequestTempDir();
        const downloadStarted = performance.now();
        const download = await downloadMedia(request.url, tempDir, {
            outputType: request.outputType,
            maxBytes: config.maxDownloadBytes,
            targetBytes: uploadTargetBytes,
            signal: controller.signal,
            onStatus: (status) => reply.update(status),
        });
        const downloadMs = performance.now() - downloadStarted;

        const processStarted = performance.now();
        const output = await prepareMediaForDiscord(download, {
            outputType: request.outputType,
            tempDir,
            maxAttachmentBytes: uploadTargetBytes,
            allowCompression: request.fitToLimit,
            signal: controller.signal,
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
        await reply.commit(output, {
            method: download.method,
            downloadMs,
            processMs,
            uploadTargetBytes,
            recovered: download.recovered,
            metadata: download.metadata,
        });

        log.info(`Completed media job for ${interaction.user.tag}: ${output.fileName} via ${download.method}`);
    } catch (error) {
        log.error(`Media job failed for ${interaction.user.tag}:`, error.stack || error.message);
        await reply.fail(error);
    } finally {
        clearTimeout(timeout);
        await cleanupTempDir(tempDir);
    }
}

async function enqueue(interaction, reply, request) {
    if (queue.size >= config.maxQueueSize)
        throw userError("The download queue is full. Try again in a minute.", "QUEUE_FULL");

    acquireUserSlot(interaction.user.id);

    try {
        if (queue.pending >= config.maxConcurrentJobs) {
            const position = queue.size + 1;
            await reply.update({ phase: "queued", detail: `Queue position: ${position}` }, { force: true });
        }

        await queue.add(() => runMediaJob(interaction, reply, request));
    } finally {
        releaseUserSlot(interaction.user.id);
    }
}

export async function handleMediaCommand(interaction) {
    requireGuildDeliveryPermissions(interaction);
    const privateReply = interaction.inGuild() && !config.publicRepliesInGuilds;
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
        log.error(`Could not queue media job: ${error.stack || error.message}`);
        await reply.fail(error);
    }
}

export {
    missingGuildDeliveryPermissions,
    runMediaJob,
    uploadTargetBytesForInteraction,
};
