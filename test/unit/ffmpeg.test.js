import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMediaForDiscord } from "../../src/media/processor.js";
import { checkFFmpeg, compressImage, extractThumbnail, getMediaInfo, runFFmpeg } from "../../src/utils/ffmpeg.js";

test("extracts AAC audio without changing its encoded samples", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-aac-copy-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "source.mp4");
    await runFFmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x64:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        input,
    ]);
    const output = await prepareMediaForDiscord(
        {
            filePath: input,
            fileName: "source.mp4",
            sizeBytes: (await fs.stat(input)).size,
            mediaKind: "video",
            extension: "mp4",
        },
        { outputType: "audio", tempDir: dir, maxAttachmentBytes: 10 * 1024 * 1024, allowCompression: true },
    );
    assert.equal(output.extension, "m4a");
    const encodedHash = async (file) =>
        (
            await runFFmpeg(["-i", file, "-map", "0:a:0", "-c:a", "copy", "-f", "streamhash", "-hash", "sha256", "-"])
        ).stdout.trim();
    assert.equal(await encodedHash(output.filePath), await encodedHash(input));
    const info = await getMediaInfo(output.filePath);
    assert.equal(info.hasVideo, false);
    assert.equal(info.audioCodec, "aac");
});

test("fits oversized AAC only when compression is enabled", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-aac-fit-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "source.mp4");
    await runFFmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x64:d=6",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=duration=6:sample_rate=44100:seed=1",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-y",
        input,
    ]);
    const download = {
        filePath: input,
        fileName: "source.mp4",
        sizeBytes: (await fs.stat(input)).size,
        mediaKind: "video",
        extension: "mp4",
    };
    const options = { outputType: "audio", tempDir: dir, maxAttachmentBytes: 48 * 1024 };
    await assert.rejects(prepareMediaForDiscord(download, { ...options, allowCompression: false }), {
        code: "FILE_TOO_LARGE",
    });
    const output = await prepareMediaForDiscord(download, { ...options, allowCompression: true });
    assert.equal(output.extension, "mp3");
    assert.ok(output.sizeBytes <= options.maxAttachmentBytes);
});

test("extracts an image from a sub-second video", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-short-video-"));
    const input = path.join(dir, "short.mp4");
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await runFFmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.2", "-c:v", "libx264", "-y", input]);

    const output = await extractThumbnail(input, dir);
    assert.ok((await fs.stat(output)).size > 0);
});

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
    assert.equal((await getMediaInfo(output.filePath)).hasAudio, true);
    assert.ok(
        statuses.some((status) => status.phase === "processing" && Number.isFinite(status.progress?.percent)),
        "expected at least one processing progress update",
    );
    assert.ok(
        !statuses.some((status) => /lossless|audio-only/i.test(status.detail || "")),
        "expected mathematically impossible fast-fit attempts to be skipped",
    );
});

test("auto fits oversized audio instead of rejecting the original", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-audio-fit-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "source.wav");
    await runFFmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:a", "pcm_s16le", "-y", input]);

    const targetSize = 80 * 1024;
    const inputSize = (await fs.stat(input)).size;
    assert.ok(inputSize > targetSize);
    const output = await prepareMediaForDiscord(
        {
            filePath: input,
            fileName: "source.wav",
            sizeBytes: inputSize,
            mediaKind: "audio",
            extension: "wav",
            isAudioOnly: true,
        },
        {
            outputType: "auto",
            tempDir: dir,
            maxAttachmentBytes: targetSize,
            allowCompression: true,
        },
    );

    assert.ok(output.sizeBytes <= targetSize);
    assert.equal(output.extension, "mp3");
    assert.match(output.note, /fit Discord/);
});

test("audio output extracts audio from a WebM video", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-webm-audio-"));
    const input = path.join(dir, "source.webm");
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await runFFmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x90:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-shortest",
        "-c:v",
        "libvpx-vp9",
        "-c:a",
        "libopus",
        "-y",
        input,
    ]);
    const inputInfo = await getMediaInfo(input);

    const output = await prepareMediaForDiscord(
        {
            filePath: input,
            fileName: "source.webm",
            sizeBytes: (await fs.stat(input)).size,
            mediaKind: "video",
            extension: "webm",
            isAudioOnly: false,
            mediaInfo: inputInfo,
        },
        {
            outputType: "audio",
            tempDir: dir,
            maxAttachmentBytes: 10 * 1024 * 1024,
            allowCompression: true,
        },
    );

    const outputInfo = await getMediaInfo(output.filePath);
    assert.equal(output.extension, "mp3");
    assert.equal(outputInfo.hasVideo, false);
    assert.equal(outputInfo.hasAudio, true);
});

test("auto fits oversized images instead of rejecting the original", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-image-fit-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "source.bmp");
    await runFFmpeg(["-f", "lavfi", "-i", "testsrc2=size=1024x1024", "-frames:v", "1", "-y", input]);

    const targetSize = 120 * 1024;
    const inputSize = (await fs.stat(input)).size;
    assert.ok(inputSize > targetSize);
    const output = await prepareMediaForDiscord(
        {
            filePath: input,
            fileName: "source.bmp",
            sizeBytes: inputSize,
            mediaKind: "image",
            extension: "bmp",
        },
        {
            outputType: "auto",
            tempDir: dir,
            maxAttachmentBytes: targetSize,
            allowCompression: true,
        },
    );

    assert.ok(output.sizeBytes <= targetSize);
    assert.equal(output.extension, "jpg");
    assert.match(output.note, /fit Discord/);
});

test("image fitting rejects unsafe decoded dimensions", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-image-dimensions-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "extreme.png");
    await runFFmpeg(["-f", "lavfi", "-i", "color=c=white:s=2x20000:d=0.04", "-frames:v", "1", "-y", input]);

    await assert.rejects(
        compressImage(input, dir, 10 * 1024 * 1024),
        (error) => error.name === "UserFacingError" && error.code === "IMAGE_DIMENSIONS_TOO_LARGE",
    );
});

test("image fitting caps both output dimensions", async (t) => {
    if (!(await checkFFmpeg())) return t.skip("FFmpeg is not installed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-image-aspect-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = path.join(dir, "tall.png");
    await runFFmpeg(["-f", "lavfi", "-i", "color=c=white:s=8x8000:d=0.04", "-frames:v", "1", "-y", input]);

    const output = await compressImage(input, dir, 10 * 1024 * 1024);
    const info = await getMediaInfo(output);

    assert.ok(info.width <= 4096);
    assert.ok(info.height <= 4096);
});
