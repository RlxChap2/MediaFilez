import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { log } from "./logger.js";
import { userError } from "./errors.js";
import { formatBytes } from "./format.js";

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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), config.tempPrefix));
    log.debug("Created temp dir:", dir);
    return dir;
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
