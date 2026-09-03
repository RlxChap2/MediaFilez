import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import lockfile from "proper-lockfile";
import { config } from "../../src/config.js";
import { cleanupStaleTempDirs, cleanupTempDir, createRequestTempDir } from "../../src/utils/temp.js";

test("request temp directories include their owner process", async (t) => {
    const dir = await createRequestTempDir();
    t.after(() => cleanupTempDir(dir));

    assert.ok(path.basename(dir).startsWith(`${config.tempPrefix}${process.pid}-`));
});

test("startup cleanup removes only temp directories owned by stopped processes", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-cleanup-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const stale = path.join(root, "mediafilez-101-job-one");
    const active = path.join(root, "mediafilez-202-job-two");
    const legacy = path.join(root, "mediafilez-job-legacy");
    const unrelated = path.join(root, "unrelated-job");
    const matchingFile = path.join(root, "mediafilez-not-a-directory");
    await Promise.all([
        fs.mkdir(stale),
        fs.mkdir(active),
        fs.mkdir(legacy),
        fs.mkdir(unrelated),
        fs.writeFile(matchingFile, "keep"),
    ]);
    const release = await lockfile.lock(active, { realpath: false });
    t.after(() => release().catch(() => {}));

    const removed = await cleanupStaleTempDirs({ rootDir: root, prefix: "mediafilez-" });

    assert.equal(removed, 1);
    await assert.rejects(fs.access(stale), { code: "ENOENT" });
    await fs.access(active);
    await fs.access(legacy);
    await fs.access(unrelated);
    await fs.access(matchingFile);
});

test("startup cleanup uses the owner lock when a PID has been reused", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-cleanup-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const abandoned = path.join(root, `mediafilez-${process.pid}-abandoned`);
    const active = path.join(root, `mediafilez-${process.pid}-active`);
    await Promise.all([fs.mkdir(abandoned), fs.mkdir(active)]);
    const release = await lockfile.lock(active, { realpath: false });
    t.after(() => release().catch(() => {}));

    const removed = await cleanupStaleTempDirs({ rootDir: root, prefix: "mediafilez-" });

    assert.equal(removed, 1);
    await assert.rejects(fs.access(abandoned), { code: "ENOENT" });
    await fs.access(active);
});
