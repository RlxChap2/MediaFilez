import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadMedia } from "../../src/download/orchestrator.js";
import { DownloadMethodError } from "../../src/utils/errors.js";

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
);

async function tempJob() {
    return await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-test-"));
}

test("stops after the first valid engine result", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const calls = [];
    const engines = new Map([
        [
            "first",
            async (_url, attemptDir) => {
                calls.push("first");
                const filePath = path.join(attemptDir, "result.png");
                await fs.writeFile(filePath, PNG);
                return { filePath, fileName: "result.png", method: "first" };
            },
        ],
        [
            "second",
            async () => {
                calls.push("second");
                throw new Error("must not run");
            },
        ],
    ]);

    const result = await downloadMedia("https://example.com/post", jobDir, {
        outputType: "image",
        plan: ["first", "second"],
        engines,
    });

    assert.deepEqual(calls, ["first"]);
    assert.equal(result.committed, true);
    assert.equal(result.method, "first");
});

test("auto accepts the first recognized media kind", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const engines = new Map([
        [
            "detector",
            async (_url, attemptDir) => {
                const filePath = path.join(attemptDir, "detected.png");
                await fs.writeFile(filePath, PNG);
                return { filePath, fileName: "detected.png", method: "detector" };
            },
        ],
    ]);

    const result = await downloadMedia("https://example.com/post", jobDir, {
        outputType: "auto",
        plan: ["detector"],
        engines,
    });

    assert.equal(result.mediaKind, "image");
    assert.equal(result.method, "detector");
});

test("falls back from a blocked Reddit response to a proxy artifact", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const calls = [];
    const engines = new Map([
        [
            "reddit-embed",
            async () => {
                calls.push("reddit-embed");
                throw new DownloadMethodError("reddit-embed", "HTTP 403");
            },
        ],
        [
            "reddit-proxy",
            async (_url, attemptDir) => {
                calls.push("reddit-proxy");
                const filePath = path.join(attemptDir, "result.png");
                await fs.writeFile(filePath, PNG);
                return { filePath, fileName: "result.png", method: "reddit-proxy:working.example" };
            },
        ],
    ]);

    const result = await downloadMedia("https://www.reddit.com/r/example/s/share", jobDir, {
        outputType: "auto",
        plan: ["reddit-embed", "reddit-proxy"],
        engines,
    });

    assert.deepEqual(calls, ["reddit-embed", "reddit-proxy"]);
    assert.equal(result.mediaKind, "image");
    assert.equal(result.method, "reddit-proxy:working.example");
});

test("recovers a complete artifact after an engine error and stops fallback", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const calls = [];
    const engines = new Map([
        [
            "unstable",
            async (_url, attemptDir) => {
                calls.push("unstable");
                await fs.writeFile(path.join(attemptDir, "complete.png"), PNG);
                throw new Error("process returned a non-zero exit code");
            },
        ],
        [
            "fallback",
            async () => {
                calls.push("fallback");
                throw new Error("must not run");
            },
        ],
    ]);

    const result = await downloadMedia("https://example.com/post", jobDir, {
        outputType: "image",
        plan: ["unstable", "fallback"],
        engines,
    });

    assert.deepEqual(calls, ["unstable"]);
    assert.equal(result.recovered, true);
    assert.equal(result.method, "unstable");
});

test("does not start an engine after job cancellation", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const controller = new AbortController();
    controller.abort();
    let called = false;

    await assert.rejects(
        downloadMedia("https://example.com/post", jobDir, {
            outputType: "image",
            signal: controller.signal,
            plan: ["engine"],
            engines: new Map([
                [
                    "engine",
                    async () => {
                        called = true;
                    },
                ],
            ]),
        }),
        /timed out/,
    );
    assert.equal(called, false);
});

test("falls back when one engine reaches its own timeout", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const calls = [];
    const engines = new Map([
        [
            "timed-out",
            async () => {
                calls.push("timed-out");
                throw Object.assign(new Error("engine request timed out"), { name: "AbortError" });
            },
        ],
        [
            "fallback",
            async (_url, attemptDir) => {
                calls.push("fallback");
                const filePath = path.join(attemptDir, "result.png");
                await fs.writeFile(filePath, PNG);
                return { filePath, fileName: "result.png", method: "fallback" };
            },
        ],
    ]);

    const result = await downloadMedia("https://example.com/post", jobDir, {
        outputType: "image",
        plan: ["timed-out", "fallback"],
        engines,
    });

    assert.deepEqual(calls, ["timed-out", "fallback"]);
    assert.equal(result.method, "fallback");
});

test("does not misreport a generic HTTP 403 as missing account cookies", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const engines = new Map([
        [
            "blocked",
            async () => {
                throw new Error("HTTP Error 403: Forbidden");
            },
        ],
        [
            "unsupported",
            async () => {
                throw new Error("Unsupported URL");
            },
        ],
    ]);

    await assert.rejects(
        downloadMedia("https://example.com/stock-page", jobDir, {
            outputType: "image",
            plan: ["blocked", "unsupported"],
            engines,
        }),
        (error) => /blocked automated access/.test(error.message) && !/cookies/i.test(error.message),
    );
});

test("replaces verbose network block pages with a bounded engine error", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const blockPage = `[reddit][error] ${"body{color:red}".repeat(10_000)} You've been blocked by network security.`;

    await assert.rejects(
        downloadMedia("https://example.com/blocked", jobDir, {
            outputType: "video",
            plan: ["gallery-dl"],
            engines: new Map([
                [
                    "gallery-dl",
                    async () => {
                        throw new DownloadMethodError("gallery-dl", blockPage);
                    },
                ],
            ]),
        }),
        (error) => {
            assert.equal(error.attempts[0].error, "The source blocked this server's network address.");
            return true;
        },
    );
});

test("reports an image post before generic network failures", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const engines = new Map([
        [
            "blocked",
            async () => {
                throw new Error("HTTP Error 403: Forbidden");
            },
        ],
        [
            "reddit-embed",
            async () => {
                throw new DownloadMethodError("reddit-embed", "The Reddit post contains image media, not video.");
            },
        ],
    ]);

    await assert.rejects(
        downloadMedia("https://www.reddit.com/r/example/comments/abc/post", jobDir, {
            outputType: "video",
            plan: ["blocked", "reddit-embed"],
            engines,
        }),
        (error) => /source is an image.*choose image output/i.test(error.message),
    );
});

test("auto does not tell the user to switch to image output", async (t) => {
    const jobDir = await tempJob();
    t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
    const engines = new Map([
        [
            "blocked",
            async () => {
                throw new Error("HTTP Error 403: Forbidden");
            },
        ],
        [
            "reddit-embed",
            async () => {
                throw new DownloadMethodError("reddit-embed", "The Reddit post contains image media, not video.");
            },
        ],
    ]);

    await assert.rejects(
        downloadMedia("https://www.reddit.com/r/example/comments/abc/post", jobDir, {
            outputType: "auto",
            plan: ["blocked", "reddit-embed"],
            engines,
        }),
        (error) => /blocked automated access/.test(error.message) && !/choose image output/i.test(error.message),
    );
});
