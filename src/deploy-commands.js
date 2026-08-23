import { REST } from "discord.js";
import { upsertGlobalCommands } from "./commands/deploy.js";
import { data as mediaCommand } from "./commands/media.js";
import { config, requireConfig } from "./config.js";
import { log } from "./utils/logger.js";

requireConfig(["botToken", "clientId"]);

const commands = [mediaCommand.toJSON()];

const rest = new REST({
    version: "10",
    timeout: config.discordRestTimeoutMs,
    retries: config.discordRestRetries,
}).setToken(config.botToken);

try {
    log.info(`Upserting ${commands.length} global application command(s).`);
    const data = await upsertGlobalCommands(rest, config.clientId, commands);
    log.ok(`Upserted ${data.length} global application command(s).`);
} catch (error) {
    log.error("Command deployment failed:", error.stack || error.message);
    process.exitCode = 1;
}
