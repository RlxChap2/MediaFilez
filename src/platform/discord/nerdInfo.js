import { escapeMarkdown, MessageFlags } from "discord.js";
import { formatBytes, formatElapsed } from "../../utils/format.js";

const CUSTOM_ID_PREFIX = "media-nerd:v1:";
const NOTE_CODES = new Map([
    ["transcoded to fit Discord", "tf"],
    ["downloaded as audio", "da"],
    ["extracted as MP3", "mp3"],
    ["extracted from the video", "ev"],
    ["compressed to fit Discord", "cf"],
    ["transcoded to fit Discord; compressed to fit Discord", "tcf"],
]);
const NOTES_BY_CODE = new Map([...NOTE_CODES].map(([note, code]) => [code, note]));

function engineName(method) {
    return (
        String(method || "unknown")
            .split(":", 1)[0]
            .replace(/[^a-z0-9_-]/gi, "-")
            .slice(0, 32) || "unknown"
    );
}

function encodeDuration(value) {
    return Math.max(0, Math.round((Number(value) || 0) * 10)).toString(36);
}

function encodeInteger(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toString(36);
}

function decodeInteger(value) {
    if (!/^[0-9a-z]+$/.test(value)) throw new Error("Invalid Nerd Info value.");
    const decoded = Number.parseInt(value, 36);
    if (!Number.isSafeInteger(decoded)) throw new Error("Invalid Nerd Info value.");
    return decoded;
}

function encodeDetails(output, details) {
    const fields = [
        engineName(details.method),
        encodeDuration(details.downloadMs),
        encodeDuration(details.processMs),
        encodeInteger(details.uploadTargetBytes),
        NOTE_CODES.get(output.note) || "-",
        details.recovered ? "1" : "0",
        output.remoteUrl ? encodeInteger(output.sizeBytes) : "-",
    ];
    return `${CUSTOM_ID_PREFIX}${fields.join(".")}`;
}

function decodeDetails(customId) {
    const fields = customId.slice(CUSTOM_ID_PREFIX.length).split(".");
    if (![6, 7].includes(fields.length) || !fields[0]) throw new Error("Invalid Nerd Info payload.");
    return {
        method: fields[0],
        downloadMs: decodeInteger(fields[1]) / 10,
        processMs: decodeInteger(fields[2]) / 10,
        uploadTargetBytes: decodeInteger(fields[3]),
        note: NOTES_BY_CODE.get(fields[4]),
        recovered: fields[5] === "1",
        remoteSizeBytes: !fields[6] || fields[6] === "-" ? null : decodeInteger(fields[6]),
    };
}

function firstAttachment(message) {
    const attachments = message?.attachments;
    if (!attachments) return null;
    if (typeof attachments.first === "function") return attachments.first() || null;
    if (typeof attachments.values === "function") return attachments.values().next().value || null;
    return Array.isArray(attachments) ? attachments[0] || null : null;
}

function nerdInfoCopy(attachment, details) {
    const lines = [
        `**Ready: ${escapeMarkdown(attachment.name || "attachment")}**`,
        `-# Engine: ${escapeMarkdown(details.method)}`,
        `-# Download: ${formatElapsed(details.downloadMs)} · Processing: ${formatElapsed(details.processMs)}`,
        details.remoteSizeBytes !== null
            ? `-# Delivery: CDN link · Size: ${formatBytes(attachment.size)}`
            : `-# Upload target: ${formatBytes(details.uploadTargetBytes)} · ${formatBytes(attachment.size)}`,
    ];
    if (details.note) lines.push(`-# Note: ${details.note}`);
    if (details.recovered) lines.push("-# The downloader reported an error, but the delivered file was complete.");
    return lines.join("\n");
}

export function createNerdInfoComponents(output, details) {
    return [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 2,
                    label: "Nerd Info",
                    custom_id: encodeDetails(output, details),
                },
            ],
        },
    ];
}

export async function handleNerdInfoButton(interaction) {
    if (!interaction.isButton?.() || !String(interaction.customId).startsWith(CUSTOM_ID_PREFIX)) return false;

    const details = decodeDetails(interaction.customId);
    const remoteUrl = String(interaction.message?.content || "").match(/^https:\/\/\S+/)?.[0];
    const remoteName = remoteUrl
        ? decodeURIComponent(new URL(remoteUrl).pathname.split("/").pop() || "media").replace(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
              "",
          )
        : "media";
    const attachment =
        firstAttachment(interaction.message) ||
        (details.remoteSizeBytes !== null && remoteUrl ? { name: remoteName, size: details.remoteSizeBytes } : null);
    if (!attachment) {
        await interaction.reply({
            content: "Nerd Info is unavailable because the media attachment is no longer present.",
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    await interaction.reply({
        content: nerdInfoCopy(attachment, details),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
    return true;
}

export { CUSTOM_ID_PREFIX };
