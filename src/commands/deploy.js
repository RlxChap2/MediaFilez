import { ApplicationCommandType, Routes } from "discord.js";

function commandIdentity(command) {
    return `${command.type ?? ApplicationCommandType.ChatInput}:${command.name}`;
}

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
