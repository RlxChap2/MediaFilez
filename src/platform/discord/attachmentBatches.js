import { userError } from "../../utils/errors.js";

export const MAX_DISCORD_ATTACHMENTS = 10;
export const MAX_DISCORD_REQUEST_BYTES = 25 * 1024 * 1024;
export const DISCORD_FILE_BUDGET = 24 * 1024 * 1024;

export function interactionMessageLimit(interaction) {
    const owners = interaction.authorizingIntegrationOwners;
    return owners?.userId && !owners.guildId ? 6 : Infinity;
}

export function carouselUploadTarget(interaction, itemCount, perFileLimit) {
    const messages = interactionMessageLimit(interaction);
    const filesPerMessage = Number.isFinite(messages)
        ? Math.min(MAX_DISCORD_ATTACHMENTS, Math.ceil(itemCount / messages))
        : 1;
    return Math.min(perFileLimit, Math.floor(DISCORD_FILE_BUDGET / Math.max(1, filesPerMessage)));
}

export function attachmentBatches(outputs, maxMessages = Infinity) {
    const batches = [];
    let current = [];
    let bytes = 0;
    for (const output of outputs) {
        if (
            !Number.isSafeInteger(output.sizeBytes) ||
            output.sizeBytes <= 0 ||
            output.sizeBytes > DISCORD_FILE_BUDGET
        ) {
            throw userError(
                "A media file exceeds the safe Discord message size. Enable file fitting or choose a smaller output.",
                "FILE_TOO_LARGE",
            );
        }
        if (current.length === MAX_DISCORD_ATTACHMENTS || bytes + output.sizeBytes > DISCORD_FILE_BUDGET) {
            batches.push(current);
            current = [];
            bytes = 0;
        }
        current.push(output);
        bytes += output.sizeBytes;
    }
    if (current.length) batches.push(current);
    if (!batches.length || batches.length > maxMessages) {
        throw userError(
            "This post needs more messages than Discord allows for this interaction. Enable file fitting or choose a smaller output.",
            "TOO_MANY_ATTACHMENTS",
        );
    }
    return batches;
}
