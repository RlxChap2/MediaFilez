import { ApplicationCommandType, Routes } from "discord.js";

function commandIdentity(command) {
    return `${command.type ?? ApplicationCommandType.ChatInput}:${command.name}`;
}

/**
 * Synchronizes application commands with the global command set.
 * @param {import("discord.js").REST} rest - Authenticated Discord REST client.
 * @param {string} applicationId - The application whose global commands are synchronized.
 * @param {Array<Object>} commands - The command definitions to create or update.
 * @return {Promise<Array<Object>>} The results of the create and update operations.
 */
export async function upsertGlobalCommands(rest, applicationId, commands) {
    const existingCommands = await rest.get(Routes.applicationCommands(applicationId));
    const existingByIdentity = new Map(existingCommands.map((command) => [commandIdentity(command), command]));

    return Promise.all(
        commands.map((command) => {
            const existing = existingByIdentity.get(commandIdentity(command));
            if (existing) {
                return rest.patch(Routes.applicationCommand(applicationId, existing.id), { body: command });
            }

            return rest.post(Routes.applicationCommands(applicationId), { body: command });
        }),
    );
}
