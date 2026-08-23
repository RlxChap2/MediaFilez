import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const toolsDir = path.join(projectRoot, ".tools");
const manifestPath = path.join(toolsDir, "gallery-dl.json");
const disabled = ["0", "false", "no", "off"].includes(
    String(process.env.GALLERY_DL_AUTO_INSTALL ?? "true").toLowerCase(),
);

function assetName() {
    if (process.platform === "win32" && process.arch === "x64") return "gallery-dl_windows.exe";
    if (process.platform === "win32" && process.arch === "ia32") return "gallery-dl_windows_x86.exe";
    if (process.platform === "linux" && process.arch === "x64") return "gallery-dl_linux";
    if (process.platform === "darwin" && ["x64", "arm64"].includes(process.arch)) return "gallery-dl_macos";
    return null;
}

async function sha256(filePath) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex");
}

async function currentInstallMatches(asset, release) {
    const targetName = process.platform === "win32" ? "gallery-dl.exe" : "gallery-dl";
    const targetPath = path.join(toolsDir, targetName);
    try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (manifest.release !== release.tag_name || manifest.digest !== asset.digest) return false;
        return (await sha256(targetPath)) === asset.digest.slice("sha256:".length);
    } catch {
        return false;
    }
}

async function install() {
    if (disabled || process.env.GALLERY_DL_PATH) return;
    const wantedAsset = assetName();
    if (!wantedAsset) {
        console.warn(`gallery-dl auto-install skipped on ${process.platform}/${process.arch}.`);
        return;
    }

    const headers = { accept: "application/vnd.github+json", "user-agent": "MediaFilez installer" };
    const releaseResponse = await fetch("https://api.github.com/repos/gdl-org/builds/releases/latest", {
        headers,
        signal: AbortSignal.timeout(30_000),
    });
    if (!releaseResponse.ok) throw new Error(`gallery-dl release lookup returned HTTP ${releaseResponse.status}.`);
    const release = await releaseResponse.json();
    const asset = release.assets?.find((item) => item.name === wantedAsset);
    if (
        !asset?.browser_download_url ||
        !/^sha256:[\da-f]{64}$/i.test(asset.digest || "") ||
        !Number.isSafeInteger(asset.size) ||
        asset.size > 100 * 1024 * 1024
    ) {
        throw new Error(`gallery-dl release ${release.tag_name || "unknown"} has no verified ${wantedAsset} asset.`);
    }

    await fs.mkdir(toolsDir, { recursive: true });
    if (await currentInstallMatches(asset, release)) {
        console.log(`gallery-dl ${release.tag_name} is ready.`);
        return;
    }

    const targetName = process.platform === "win32" ? "gallery-dl.exe" : "gallery-dl";
    const targetPath = path.join(toolsDir, targetName);
    const partialPath = `${targetPath}.part`;
    const download = await fetch(asset.browser_download_url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!download.ok || !download.body) throw new Error(`gallery-dl download returned HTTP ${download.status}.`);

    try {
        await pipeline(Readable.fromWeb(download.body), createWriteStream(partialPath, { flags: "w" }));
        const digest = await sha256(partialPath);
        if (digest !== asset.digest.slice("sha256:".length)) throw new Error("gallery-dl SHA-256 verification failed.");
        await fs.rm(targetPath, { force: true });
        await fs.rename(partialPath, targetPath);
        if (process.platform !== "win32") await fs.chmod(targetPath, 0o755);
        await fs.writeFile(
            manifestPath,
            `${JSON.stringify({ release: release.tag_name, asset: asset.name, digest: asset.digest }, null, 2)}\n`,
        );
        console.log(`Installed gallery-dl ${release.tag_name} in .tools.`);
    } finally {
        await fs.rm(partialPath, { force: true });
    }
}

try {
    await install();
} catch (error) {
    console.warn(`gallery-dl auto-install failed: ${error.message}`);
    if (process.env.npm_lifecycle_event !== "postinstall") process.exitCode = 1;
}
