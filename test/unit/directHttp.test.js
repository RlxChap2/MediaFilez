import assert from "node:assert/strict";
import dns from "node:dns";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadDirectHttp } from "../../src/download/engines/directHttp.js";
import { DownloadMethodError } from "../../src/utils/errors.js";

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
);

async function listen(handler) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    return server;
}

test("allows a transfer longer than the idle timeout while bytes continue to arrive", { timeout: 5_000 }, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let sendNextChunk;
    const server = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "image/png" });
        let offset = 0;
        sendNextChunk = () => {
            const next = Math.min(PNG.length, offset + 10);
            const chunk = PNG.subarray(offset, next);
            offset = next;
            if (offset === PNG.length) response.end(chunk);
            else response.write(chunk);
        };
        sendNextChunk();
    });
    t.after(() => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-http-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const host = `127.0.0.1:${server.address().port}`;

    let elapsedMs = 0;
    const result = await downloadDirectHttp(`http://${host}/image.png`, dir, {
        maxBytes: 1024,
        idleTimeoutMs: 60,
        trustedHosts: ["127.0.0.1"],
        onProgress({ downloadedBytes }) {
            if (downloadedBytes === PNG.length) return;
            t.mock.timers.tick(40);
            elapsedMs += 40;
            sendNextChunk();
        },
    });
    assert.ok(elapsedMs > 60);
    assert.equal(result.sizeBytes, PNG.length);
});

test("fails a transfer that stops making progress", { timeout: 5_000 }, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const server = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "image/png" });
        response.write(PNG.subarray(0, 8));
    });
    t.after(() => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-http-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const host = `127.0.0.1:${server.address().port}`;

    await assert.rejects(
        downloadDirectHttp(`http://${host}/image.png`, dir, {
            maxBytes: 1024,
            idleTimeoutMs: 30,
            trustedHosts: ["127.0.0.1"],
            onProgress: () => t.mock.timers.tick(31),
        }),
        /stalled/,
    );
});

test("turns an incomplete socket close into an engine failure and removes the partial file", async (t) => {
    const server = net.createServer((socket) => {
        socket.once("data", () => {
            socket.write(
                [
                    "HTTP/1.1 200 OK",
                    "Content-Type: image/png",
                    `Content-Length: ${PNG.length}`,
                    "Connection: close",
                    "",
                    "",
                ].join("\r\n"),
            );
            socket.write(PNG.subarray(0, 12), () => socket.destroy());
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-http-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const host = `127.0.0.1:${server.address().port}`;

    await assert.rejects(
        downloadDirectHttp(`http://${host}/image.png`, dir, {
            maxBytes: 1024,
            responseTimeoutMs: 100,
            idleTimeoutMs: 100,
            trustedHosts: ["127.0.0.1"],
        }),
        (error) =>
            error instanceof DownloadMethodError && /closed|socket|terminated|aborted|ECONNRESET/i.test(error.message),
    );
    assert.deepEqual(await fs.readdir(dir), []);
});

test("stops fallback when socket DNS changes to a private address", async (t) => {
    const originalLookup = dns.lookup;
    const originalPromiseLookup = dns.promises.lookup;
    dns.promises.lookup = async (hostname, options) =>
        hostname === "rebind.example"
            ? [{ address: "93.184.216.34", family: 4 }]
            : await originalPromiseLookup(hostname, options);
    dns.lookup = (hostname, options, callback) => {
        if (hostname === "rebind.example") {
            callback(null, [{ address: "127.0.0.1", family: 4 }]);

            return;
        }

        originalLookup(hostname, options, callback);
    };
    t.after(() => {
        dns.lookup = originalLookup;
        dns.promises.lookup = originalPromiseLookup;
    });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-http-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await assert.rejects(
        downloadDirectHttp("http://rebind.example/image.png", dir, {
            maxBytes: 1024,
            responseTimeoutMs: 100,
        }),
        (error) => error.code === "PRIVATE_URL" && error.stopFallback === true,
    );
});
