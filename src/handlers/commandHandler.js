import { MessageFlags } from "discord.js";
import { log } from "../utils/logger.js";
import { isUserFacingError, messageForError } from "../utils/errors.js";
import { handleMediaCommand } from "../jobs/mediaJob.js";

async function sendError(interaction, error) {
    if (error?.responseLocked) return;
    const content = `Request failed: ${messageForError(error)}`;

    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content, files: [] });
            return;
        }

        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
        log.error("Failed to send error reply:", replyError.message);
    }
}

function isUnknownInteraction(error) {
    return error?.code === 10062 || error?.rawError?.code === 10062;
}

/**
 * Handles a chat input command interaction and dispatches supported commands.
 * @param {import("discord.js").Interaction} interaction - The interaction to process.
 */
export async function handleCommand(interaction) {
    if (!interaction.isChatInputCommand()) return;

    try {
        if (interaction.commandName === "media") {
            await handleMediaCommand(interaction);
            return;
        }

        await interaction.reply({
            content: "Unknown command.",
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        if (isUnknownInteraction(error)) {
            log.warn(`/${interaction.commandName} expired before Discord accepted the initial response.`);
            return;
        }
        if (isUserFacingError(error)) {
            log.warn(`/${interaction.commandName} ended (${error.code}): ${error.message}`);
        } else {
            log.error(`/${interaction.commandName} failed:`, error.stack || error.message);
        }
        await sendError(interaction, error);
    }
}
