import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDiscordUploader } from "../../src/platform/discord/discordUpload.js";

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return server.address().port;
}

async function close(server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("streams a large Discord multipart upload with bounded memory", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-upload-"));
    const filePath = path.join(dir, "large.bin");
    const fileSize = Number.parseInt(process.env.DISCORD_UPLOAD_TEST_BYTES || "", 10) || 64 * 1024 * 1024;
    const handle = await fs.open(filePath, "w");
    await handle.truncate(fileSize);
    await handle.close();
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    let receivedBytes = 0;
    let expectedBytes = 0;
    let firstBytes = Buffer.alloc(0);
    let lastBytes = Buffer.alloc(0);
    let requestPath;
    let chunks = 0;
    const server = http.createServer((request, response) => {
        requestPath = request.url;
        expectedBytes = Number(request.headers["content-length"]);
        request.on("data", (chunk) => {
            chunks += 1;
            receivedBytes += chunk.length;
            if (firstBytes.length < 8 * 1024) {
                firstBytes = Buffer.concat([firstBytes, chunk]).subarray(0, 8 * 1024);
            }
            lastBytes = Buffer.concat([lastBytes, chunk]).subarray(-2 * 1024);
            if (chunks % 8 === 0) {
                request.pause();
                setTimeout(() => request.resume(), 1);
            }
        });
        request.on("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end('{"id":"message-id"}');
        });
    });
    const port = await listen(server);
    t.after(() => close(server));

    const upload = createDiscordUploader({ apiBaseUrl: `http://127.0.0.1:${port}/api/v10/`, timeoutMs: 30_000 });
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    const sampler = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 2);

    try {
        await upload(
            { applicationId: "123456789", token: "interaction-token" },
            {
                content: "Ready",
                filePath,
                fileName: 'safe " name.bin',
                sizeBytes: fileSize,
            },
        );
    } finally {
        clearInterval(sampler);
    }

    assert.equal(requestPath, "/api/v10/webhooks/123456789/interaction-token/messages/@original");
    assert.equal(receivedBytes, expectedBytes);
    assert.match(firstBytes.toString("utf8"), /name="payload_json"/);
    assert.match(firstBytes.toString("utf8"), /"allowed_mentions":\{"parse":\[\]\}/);
    assert.match(firstBytes.toString("utf8"), /filename="safe _ name\.bin"/);
    assert.match(lastBytes.toString("utf8"), /--\r\n$/);
    assert.ok(peakRss - baselineRss < 128 * 1024 * 1024, `RSS grew by ${peakRss - baselineRss} bytes`);
});

test("returns bounded Discord API errors without exposing the interaction token", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-upload-"));
    const filePath = path.join(dir, "small.bin");
    await fs.writeFile(filePath, "media");
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const server = http.createServer((request, response) => {
        request.resume();
        request.on("end", () => {
            response.writeHead(413, { "content-type": "application/json" });
            response.end('{"code":40005,"message":"Request entity too large"}');
        });
    });
    const port = await listen(server);
    t.after(() => close(server));

    const upload = createDiscordUploader({ apiBaseUrl: `http://127.0.0.1:${port}/api/v10/` });
    await assert.rejects(
        upload(
            { applicationId: "123456789", token: "secret-token" },
            { content: "Ready", filePath, fileName: "small.bin", sizeBytes: 5 },
        ),
        (error) => {
            assert.equal(error.status, 413);
            assert.equal(error.code, 40005);
            assert.doesNotMatch(error.message, /secret-token/);
            return true;
        },
    );
});
