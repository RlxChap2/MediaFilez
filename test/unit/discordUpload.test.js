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

test("streams every carousel part to a known followup message", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-upload-album-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const files = [];
    for (const [i, contents] of ["first-media", "second-media", "third-media"].entries()) {
        const filePath = path.join(dir, `${i}.jpg`);
        await fs.writeFile(filePath, contents);
        files.push({ filePath, fileName: `${i}.jpg`, sizeBytes: contents.length });
    }
    let body;
    let requestPath;
    let requestMethod;
    const server = http.createServer(async (request, response) => {
        requestPath = request.url;
        requestMethod = request.method;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        body = Buffer.concat(chunks);
        assert.equal(body.length, Number(request.headers["content-length"]));
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
    });
    const port = await listen(server);
    t.after(() => close(server));
    const upload = createDiscordUploader({ apiBaseUrl: `http://127.0.0.1:${port}/api/v10/` });
    await upload(
        { applicationId: "123456789", token: "interaction-token" },
        { files, content: "Ready" },
        { messageId: "123456789012345678" },
    );
    assert.equal(requestMethod, "PATCH");
    assert.ok(requestPath.endsWith("/messages/123456789012345678"));
    for (let i = 0; i < 3; i++) assert.ok(body.includes(Buffer.from(`name="files[${i}]"`)));
    for (const value of ["first-media", "second-media", "third-media"]) assert.ok(body.includes(Buffer.from(value)));
});

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

    const upload = createDiscordUploader({
        apiBaseUrl: `http://127.0.0.1:${port}/api/v10/`,
        timeoutMs: 30_000,
        maxRequestBytes: fileSize + 1024 * 1024,
    });
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
                components: [
                    {
                        type: 1,
                        components: [{ type: 2, style: 2, label: "Nerd Info", custom_id: "media-nerd:v1:test" }],
                    },
                ],
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
    assert.match(firstBytes.toString("utf8"), /"label":"Nerd Info"/);
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

test("preserves retry metadata when Discord rejects an upload before reading it", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-upload-"));
    const filePath = path.join(dir, "large.bin");
    const handle = await fs.open(filePath, "w");
    await handle.truncate(64 * 1024 * 1024);
    await handle.close();
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const server = http.createServer((_request, response) => {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "2" });
        response.end('{"message":"rate limited","retry_after":2}');
    });
    const port = await listen(server);
    t.after(() => close(server));

    const upload = createDiscordUploader({
        apiBaseUrl: `http://127.0.0.1:${port}/api/v10/`,
        maxRequestBytes: 65 * 1024 * 1024,
    });
    await assert.rejects(
        upload(
            { applicationId: "123456789", token: "secret-token" },
            { content: "Ready", filePath, fileName: "large.bin", sizeBytes: 64 * 1024 * 1024 },
        ),
        (error) => {
            assert.equal(error.status, 429);
            assert.equal(error.retryAfterMs, 2_000);
            assert.doesNotMatch(error.message, /secret-token/);
            return true;
        },
    );
});
