import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { config, requireConfig } from "./config.js";
import { formatBytes } from "./utils/format.js";
import { log } from "./utils/logger.js";
import { checkFFmpeg } from "./utils/ffmpeg.js";
import { handleCommand } from "./handlers/commandHandler.js";

requireConfig(["botToken"]);

const ffmpegReady = await checkFFmpeg();
if (!ffmpegReady) {
    log.warn(
        "FFmpeg or ffprobe was not found. Video fitting, thumbnails, and audio extraction will fail until it is installed.",
    );
} else {
    log.ok("FFmpeg and ffprobe are ready.");
}

const client = new Client({
    intents: [Object.keys(GatewayIntentBits)],
    partials: [Object.keys(Partials)],
    rest: {
        timeout: config.discordRestTimeoutMs,
        retries: config.discordRestRetries,
    },
});

log.info(
    `Discord REST timeout: ${config.discordRestTimeoutMs}ms; internal retries: ${config.discordRestRetries}; upload target: ${formatBytes(config.discordUploadTargetBytes)}.`,
);

client.once(Events.ClientReady, (readyClient) => {
    log.ok(`Ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    await handleCommand(interaction);
});

client.on(Events.Error, (error) => {
    log.error("Discord client error:", error.stack || error.message);
});

process.on("unhandledRejection", (error) => {
    log.error("Unhandled rejection:", error?.stack || error);
});

process.on("SIGINT", () => {
    log.info("Shutting down...");
    client.destroy();
    process.exit(0);
});

process.on("SIGTERM", () => {
    log.info("Shutting down...");
    client.destroy();
    process.exit(0);
});

await client.login(config.botToken);
