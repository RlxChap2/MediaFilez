import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../src/config.js";
import { resolveYtDlpPath } from "../src/download/engines/ytDlp.js";
import { resolveGalleryDlPath } from "../src/download/engines/galleryDl.js";
import { resolveFFmpegPaths } from "../src/utils/ffmpeg.js";

const execFileAsync = promisify(execFile);

async function commandOk(command, args = ["--version"]) {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, {
            timeout: 10_000,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });
        return { ok: true, detail: (stdout || stderr).split(/\r?\n/)[0] };
    } catch (error) {
        return { ok: false, detail: error.code === "ENOENT" ? "not found on PATH" : error.message };
    }
}

async function cookieFileOk() {
    if (!config.mediaCookiesFile) {
        const browser = config.ytdlpCookiesFromBrowser
            ? `browser extraction: ${config.ytdlpCookiesFromBrowser}`
            : "not configured";
        return { ok: true, detail: browser };
    }
    try {
        const stat = await fs.stat(config.mediaCookiesFile);
        return { ok: stat.isFile() && stat.size > 0, detail: `${stat.size} bytes` };
    } catch (error) {
        return { ok: false, detail: error.code === "ENOENT" ? "file not found" : error.message };
    }
}

async function cobaltOk() {
    if (config.cobaltApiEndpoints.length === 0) return { ok: true, detail: "disabled" };
    const knownSharedHosts = new Set([
        "rue-cobalt.xenon.zone",
        "fox.kittycat.boo",
        "cobaltapi.cjs.nz",
        "cobaltapi.kittycat.boo",
        "dog.kittycat.boo",
    ]);
    const results = [];
    const shared = [];
    for (const endpoint of config.cobaltApiEndpoints.slice(0, config.cobaltMaxEndpoints)) {
        const host = new URL(endpoint).hostname;
        if (knownSharedHosts.has(host)) shared.push(host);
        try {
            const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
            results.push(`${host}: HTTP ${response.status}`);
        } catch (error) {
            results.push(`${host}: ${error.message}`);
        }
    }
    const detail = shared.length
        ? `${results.join(" | ")} | replace shared instance(s) with a private Cobalt: ${shared.join(", ")}`
        : results.join(" | ");
    return { ok: results.some((result) => /HTTP 2\d\d/.test(result)) && shared.length === 0, detail };
}

function printResult(name, result, required = true) {
    const mark = result.ok ? "OK" : required ? "FAIL" : "WARN";
    console.log(`${mark}\t${name}\t${result.detail}`);
    return result.ok || !required;
}

const ffmpegPaths = resolveFFmpegPaths();
const checks = [
    ["node", { ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version }, true],
    ["BOT_TOKEN", { ok: Boolean(config.botToken), detail: config.botToken ? "configured" : "missing" }, true],
    ["CLIENT_ID", { ok: Boolean(config.clientId), detail: config.clientId ? "configured" : "missing" }, false],
    ["ffmpeg", await commandOk(ffmpegPaths.ffmpeg, ["-version"]), false],
    ["ffprobe", await commandOk(ffmpegPaths.ffprobe, ["-version"]), false],
    ["yt-dlp", await commandOk(resolveYtDlpPath()), true],
    ["gallery-dl", config.galleryDlEnabled ? await commandOk(resolveGalleryDlPath()) : { ok: true, detail: "disabled" }, false],
    ["cookie source", await cookieFileOk(), false],
    ["Cobalt", await cobaltOk(), false],
    ["YouTube.js", { ok: config.youtubeJsEnabled, detail: config.youtubeJsEnabled ? "enabled" : "disabled" }, false],
];

let ok = true;
for (const [name, result, required] of checks) ok = printResult(name, result, required) && ok;

console.log(`INFO\tengine policy\tsequential attempts; artifact validation before fallback`);
console.log(`INFO\tjob timeout\t${config.jobTimeoutMs}ms with process cancellation`);
if (!ok) process.exitCode = 1;
