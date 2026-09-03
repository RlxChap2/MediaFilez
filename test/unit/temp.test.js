import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStaleTempDirs } from "../../src/utils/temp.js";

test("startup cleanup removes only matching temp directories", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-cleanup-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const staleOne = path.join(root, "mediafilez-job-one");
    const staleTwo = path.join(root, "mediafilez-job-two");
    const unrelated = path.join(root, "unrelated-job");
    const matchingFile = path.join(root, "mediafilez-not-a-directory");
    await Promise.all([
        fs.mkdir(staleOne),
        fs.mkdir(staleTwo),
        fs.mkdir(unrelated),
        fs.writeFile(matchingFile, "keep"),
    ]);

    const removed = await cleanupStaleTempDirs({ rootDir: root, prefix: "mediafilez-" });

    assert.equal(removed, 2);
    await assert.rejects(fs.access(staleOne), { code: "ENOENT" });
    await assert.rejects(fs.access(staleTwo), { code: "ENOENT" });
    await fs.access(unrelated);
    await fs.access(matchingFile);
});
