import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMediaForDiscord } from "../../src/media/processor.js";
import { checkFFmpeg, runFFmpeg } from "../../src/utils/ffmpeg.js";

test("auto fits low-bitrate video and reports transcoding progress", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-fit-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "source.mp4");
    await runFFmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24:duration=12",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=12",
        "-shortest",
        "-c:v",
        "libx264",
        "-b:v",
        "500k",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-y",
        input,
    ]);

    const targetSize = 220 * 1024;
    const statuses = [];
    const output = await prepareMediaForDiscord(
        {
            filePath: input,
            fileName: "source.mp4",
            sizeBytes: (await fs.stat(input)).size,
            mediaKind: "video",
            extension: "mp4",
        },
        {
            outputType: "auto",
            tempDir: dir,
            maxAttachmentBytes: targetSize,
            allowCompression: true,
            onStatus: (status) => statuses.push(status),
        },
    );

    assert.ok(output.sizeBytes <= targetSize);
    assert.ok(
        statuses.some((status) => status.phase === "processing" && Number.isFinite(status.progress?.percent)),
        "expected at least one processing progress update",
    );
    assert.ok(
        !statuses.some((status) => /lossless|audio-only/i.test(status.detail || "")),
        "expected mathematically impossible fast-fit attempts to be skipped",
    );
});
