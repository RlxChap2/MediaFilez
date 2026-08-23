import dotenv from "dotenv";

dotenv.config({ quiet: true });

export const MB = 1024 * 1024;
export const DISCORD_HARD_MAX_BYTES = 500 * MB;

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseSize(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    if (!value) return fallback;

    const normalized = String(value).trim().toLowerCase();
    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/);
    if (!match) return fallback;

    const amount = Number.parseFloat(match[1]);
    const unit = match[2] ?? "b";
    const multiplier = {
        b: 1,
        kb: 1024,
        kib: 1024,
        mb: MB,
        mib: MB,
        gb: 1024 * MB,
        gib: 1024 * MB,
    }[unit];

    return Math.min(Math.floor(amount * multiplier), max);
}

function parseList(value) {
    if (!value || String(value).trim().toLowerCase() === "none") return [];
    return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export const config = {
    botToken: process.env.BOT_TOKEN,
    clientId: process.env.CLIENT_ID,
    publicRepliesInGuilds: parseBoolean(process.env.PUBLIC_REPLIES_IN_GUILDS, true),
    maxDownloadBytes: parseSize(process.env.MAX_DOWNLOAD_SIZE, DISCORD_HARD_MAX_BYTES, DISCORD_HARD_MAX_BYTES),
    minFreeDiskBytes: parseSize(process.env.MIN_FREE_DISK_SPACE, 1024 * MB),
    httpResponseTimeoutMs: parseInteger(process.env.HTTP_RESPONSE_TIMEOUT_MS, 45_000, 5_000, 5 * 60_000),
    httpIdleTimeoutMs: parseInteger(process.env.HTTP_IDLE_TIMEOUT_MS, 60_000, 5_000, 5 * 60_000),
    ytdlpTimeoutMs: parseInteger(process.env.YTDLP_TIMEOUT_MS, 8 * 60_000, 30_000, 15 * 60_000),
    ffmpegTimeoutMs: parseInteger(process.env.FFMPEG_TIMEOUT_MS, 10 * 60_000, 30_000, 15 * 60_000),
    jobTimeoutMs: parseInteger(process.env.JOB_TIMEOUT_MS, 14 * 60_000, 60_000, 15 * 60_000),
    discordRestTimeoutMs: parseInteger(process.env.DISCORD_REST_TIMEOUT_MS, 5 * 60_000, 15_000, 5 * 60_000),
    discordRestRetries: parseInteger(process.env.DISCORD_REST_RETRIES, 0, 0, 3),
    discordUploadTargetBytes: parseSize(
        process.env.DISCORD_UPLOAD_TARGET_SIZE,
        DISCORD_HARD_MAX_BYTES,
        DISCORD_HARD_MAX_BYTES,
    ),
    discordUploadAttempts: parseInteger(process.env.DISCORD_UPLOAD_ATTEMPTS, 3, 1, 5),
    discordUploadRetryDelayMs: parseInteger(process.env.DISCORD_UPLOAD_RETRY_DELAY_MS, 1_500, 250, 10_000),
    maxConcurrentJobs: parseInteger(process.env.MAX_CONCURRENT_JOBS, 4, 1, 16),
    maxQueueSize: parseInteger(process.env.MAX_QUEUE_SIZE, 50, 1, 500),
    maxConcurrentJobsPerUser: parseInteger(process.env.MAX_CONCURRENT_JOBS_PER_USER, 2, 1, 5),
    statusUpdateIntervalMs: parseInteger(process.env.STATUS_UPDATE_INTERVAL_MS, 2_500, 750, 15_000),
    mediaCookiesFile: process.env.MEDIA_COOKIES_FILE || null,
    ytdlpPath: process.env.YTDLP_PATH || null,
    ytdlpCookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || null,
    ytdlpConcurrentFragments: parseInteger(process.env.YTDLP_CONCURRENT_FRAGMENTS, 4, 1, 16),
    ytdlpImpersonate:
        String(process.env.YTDLP_IMPERSONATE || "chrome").toLowerCase() === "none"
            ? null
            : process.env.YTDLP_IMPERSONATE || "chrome",
    ffmpegPath: process.env.FFMPEG_PATH || null,
    ffprobePath: process.env.FFPROBE_PATH || null,
    ffmpegThreads: parseInteger(process.env.FFMPEG_THREADS, 2, 1, 8),
    youtubeJsEnabled: parseBoolean(process.env.YOUTUBE_JS_ENABLED, true),
    galleryDlEnabled: parseBoolean(process.env.GALLERY_DL_ENABLED, true),
    galleryDlPath: process.env.GALLERY_DL_PATH || null,
    pageMetadataEnabled: parseBoolean(process.env.PAGE_METADATA_ENABLED, true),
    pageMetadataMaxBytes: parseSize(process.env.PAGE_METADATA_MAX_SIZE, MB, 4 * MB),
    instagramProxyHosts:
        process.env.INSTAGRAM_PROXY_HOSTS === undefined
            ? ["www.kkkinstagram.com"]
            : parseList(process.env.INSTAGRAM_PROXY_HOSTS),
    disabledEngines: new Set(parseList(process.env.DISABLED_ENGINES).map((item) => item.toLowerCase())),
    cobaltApiEndpoints: parseList(process.env.COBALT_API_ENDPOINTS),
    cobaltDirectoryEnabled: parseBoolean(process.env.COBALT_DIRECTORY_ENABLED, false),
    cobaltDirectoryUrl: process.env.COBALT_DIRECTORY_URL || "https://cobalt.directory/api/working?type=api",
    cobaltEndpointTimeoutMs: parseInteger(process.env.COBALT_ENDPOINT_TIMEOUT_MS, 12_000, 3_000, 60_000),
    cobaltMaxEndpoints: parseInteger(process.env.COBALT_MAX_ENDPOINTS, 5, 1, 10),
    cobaltFailureCooldownMs: parseInteger(process.env.COBALT_FAILURE_COOLDOWN_MS, 60_000, 1_000, 10 * 60_000),
    cobaltAuthScheme: process.env.COBALT_AUTH_SCHEME || "Api-Key",
    cobaltApiKey: process.env.COBALT_API_KEY,
    tempPrefix: process.env.TEMP_PREFIX || "mediafilez-",
    userAgent: process.env.HTTP_USER_AGENT || "MediaFilez/2.1 (Discord media downloader)",
};

export function requireConfig(keys) {
    const missing = keys.filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment value(s): ${missing.join(", ")}`);
    }
}
