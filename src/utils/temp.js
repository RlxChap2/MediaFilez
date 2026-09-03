import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { log } from "./logger.js";
import { userError } from "./errors.js";
import { formatBytes } from "./format.js";

function validateTempPrefix(prefix) {
    if (typeof prefix !== "string" || prefix.length < 8 || prefix.includes("/") || prefix.includes("\\")) {
        throw new TypeError("TEMP_PREFIX must be a plain name at least eight characters long.");
    }
    return prefix;
}

async function ensureTempDiskSpace() {
    if (!fs.statfs) return;

    try {
        const stats = await fs.statfs(os.tmpdir());
        const freeBytes = stats.bavail * stats.bsize;
        if (freeBytes < config.minFreeDiskBytes) {
            throw userError(
                `The host has only ${formatBytes(freeBytes)} free in temp storage. Need at least ${formatBytes(config.minFreeDiskBytes)} before starting another job.`,
                "LOW_DISK_SPACE",
            );
        }
    } catch (error) {
        if (error.name === "UserFacingError") throw error;
        log.warn(`Could not check temp disk space: ${error.message}`);
    }
}

export async function createRequestTempDir() {
    await ensureTempDiskSpace();
    const prefix = validateTempPrefix(config.tempPrefix);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}${process.pid}-`));
    log.debug("Created temp dir:", dir);
    return dir;
}

function isProcessActive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code !== "ESRCH";
    }
}

export async function cleanupStaleTempDirs(options = {}) {
    const rootDir = path.resolve(options.rootDir ?? os.tmpdir());
    const prefix = validateTempPrefix(options.prefix ?? config.tempPrefix);
    const processIsActive = options.isProcessActive ?? isProcessActive;
    let entries;
    try {
        entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
        log.warn(`Could not inspect stale temp directories: ${error.message}`);
        return 0;
    }

    let removed = 0;
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
        const ownerMatch = /^(\d+)-/.exec(entry.name.slice(prefix.length));
        if (!ownerMatch) continue;
        const ownerPid = Number.parseInt(ownerMatch[1], 10);
        if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || processIsActive(ownerPid)) continue;
        const target = path.resolve(rootDir, entry.name);
        if (path.dirname(target) !== rootDir) continue;
        try {
            await fs.rm(target, { recursive: true, force: true });
            removed += 1;
        } catch (error) {
            log.warn(`Could not clean stale temp dir ${target}: ${error.message}`);
        }
    }

    if (removed > 0) log.info(`Cleaned ${removed} stale media temp director${removed === 1 ? "y" : "ies"}.`);
    return removed;
}

export async function cleanupTempDir(dir) {
    if (!dir) return;

    try {
        await fs.rm(dir, { recursive: true, force: true });
        log.debug("Cleaned up temp dir:", dir);
    } catch (error) {
        log.warn(`Could not clean temp dir ${dir}: ${error.message}`);
    }
}
