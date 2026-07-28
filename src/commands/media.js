import { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("media")
    .setDescription("Download video, image, thumbnail, or audio from a public URL")
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption((option) =>
        option.setName("url").setDescription("Public media page URL or direct media file URL").setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName("output")
            .setDescription("Choose what the bot should send back")
            .setRequired(true)
            .addChoices(
                { name: "Video", value: "video" },
                { name: "Image", value: "image" },
                { name: "Thumbnail", value: "thumbnail" },
                { name: "Audio", value: "audio" },
            ),
    )
    .addBooleanOption((option) =>
        option.setName("fit_to_limit").setDescription("Transcode only when needed to fit this Discord upload limit"),
    );
