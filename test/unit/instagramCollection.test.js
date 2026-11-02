import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadMedia } from "../../src/download/orchestrator.js";
import { recoverMediaCollection } from "../../src/download/collection.js";
import { checkFFmpeg, runFFmpeg } from "../../src/utils/ffmpeg.js";

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
);

for (const outputType of ["auto", "video", "audio"]) {
    test(`a mixed Instagram collection preserves every selected ${outputType} item`, async (t) => {
        if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");

        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-mixed-collection-"));
        t.after(() => fs.rm(directory, { recursive: true, force: true }));
        const video = path.join(directory, "fixture.mp4");
        await runFFmpeg([
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=32x32:d=0.1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.1",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-y",
            video,
        ]);
        const result = await downloadMedia("https://www.instagram.com/p/fixture/", directory, {
            outputType,
            maxBytes: 1024 * 1024,
            plan: ["fixture"],
            engines: new Map([
                [
                    "fixture",
                    async (_url, attemptDir, options) => {
                        await fs.writeFile(path.join(attemptDir, "1.png"), PNG);
                        await fs.copyFile(video, path.join(attemptDir, "2.mp4"));

                        return recoverMediaCollection(attemptDir, options);
                    },
                ],
            ]),
        });

        assert.equal(result.items?.length ?? 1, outputType === "auto" ? 2 : 1);

        if (outputType !== "auto") assert.equal(result.mediaKind, "video");
    });
}

test("an invalid slide cannot be recovered as a successful first slide", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-invalid-collection-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));

    await assert.rejects(
        downloadMedia("https://www.instagram.com/p/fixture/", directory, {
            outputType: "auto",
            plan: ["collection", "single"],
            engines: new Map([
                [
                    "collection",
                    async (_url, attemptDir, options) => {
                        await fs.writeFile(path.join(attemptDir, "1.png"), PNG);
                        await fs.writeFile(path.join(attemptDir, "2.html"), "<html>invalid media</html>");

                        return recoverMediaCollection(attemptDir, options);
                    },
                ],
                [
                    "single",
                    async (_url, attemptDir) => {
                        const filePath = path.join(attemptDir, "1.png");
                        await fs.writeFile(filePath, PNG);

                        return { filePath, fileName: "1.png" };
                    },
                ],
            ]),
        }),
    );
});
