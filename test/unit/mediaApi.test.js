import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../../src/config.js";
import { downloadWithMediaApi } from "../../src/integrations/mediaApi.js";

test("retries a transient Media API response before returning the job error", async () => {
    const originalFetch = globalThis.fetch;
    const original = {
        mediaApiUrl: config.mediaApiUrl,
        mediaApiKey: config.mediaApiKey,
        mediaApiRetries: config.mediaApiRetries,
        mediaApiRetryDelayMs: config.mediaApiRetryDelayMs,
    };
    const calls = [];

    config.mediaApiUrl = "https://api.example.test";
    config.mediaApiKey = "test-key";
    config.mediaApiRetries = 1;
    config.mediaApiRetryDelayMs = 1;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) return new Response("origin unavailable", { status: 521 });
        if (calls.length === 2)
            return Response.json({ job: { id: "job_1", status: "failed", error: null } }, { status: 202 });
        throw new Error("unexpected request");
    };

    try {
        await assert.rejects(
            downloadWithMediaApi("https://example.test/video", "C:\\temp", {
                outputType: "auto",
                timeoutMs: 10_000,
                idempotencyKey: "interaction-1",
            }),
            { code: "WORKER_FAILED" },
        );
        assert.equal(calls.length, 2);
        assert.equal(calls[0].options.headers["idempotency-key"], "interaction-1");
        assert.equal(calls[1].options.headers["idempotency-key"], "interaction-1");
    } finally {
        globalThis.fetch = originalFetch;
        Object.assign(config, original);
    }
});

test("uses the public CDN URL without downloading or fitting the file", async () => {
    const originalFetch = globalThis.fetch;
    const original = {
        mediaApiUrl: config.mediaApiUrl,
        mediaApiKey: config.mediaApiKey,
        mediaCdnBaseUrl: config.mediaCdnBaseUrl,
    };
    const calls = [];
    config.mediaApiUrl = "https://api.example.test";
    config.mediaApiKey = "test-key";
    config.mediaCdnBaseUrl = "https://cdn.example.test";
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1)
            return Response.json(
                { job: { id: "job_1", status: "completed", result: { fileId: "fil_1" } } },
                { status: 202 },
            );
        if (calls.length === 2)
            return Response.json({
                file: {
                    fileName: "clip.mp4",
                    sizeBytes: 50_000_000,
                    delivery: "public",
                    url: "https://cdn.example.test/2026/clip.mp4",
                },
            });
        throw new Error("unexpected request");
    };
    try {
        const result = await downloadWithMediaApi("https://example.test/video", "C:\\temp", {
            publicDelivery: true,
            targetBytes: 20_000_000,
            outputType: "auto",
        });
        assert.equal(result.remoteUrl, "https://cdn.example.test/2026/clip.mp4");
        assert.equal(result.sizeBytes, 50_000_000);
        assert.equal(calls.length, 2);
        const request = JSON.parse(calls[0].options.body);
        assert.equal(request.delivery, "public");
        assert.equal(request.processing.fitToLimit, false);
        assert.equal(request.limits.maxBytes, config.mediaApiMaxDownloadBytes);
    } finally {
        globalThis.fetch = originalFetch;
        Object.assign(config, original);
    }
});

test("receives a completed worker state through the event stream without repeated polling", async () => {
    const originalFetch = globalThis.fetch;
    const original = { mediaApiUrl: config.mediaApiUrl, mediaApiKey: config.mediaApiKey };
    config.mediaApiUrl = "https://api.example.test";
    config.mediaApiKey = "test-key";
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        if (urls.length === 1)
            return Response.json({ job: { id: "job_1", status: "queued", progress: 0 } }, { status: 202 });
        if (urls.length === 2)
            return new Response('event: job.updated\ndata: {"status":"failed","progress":0}\n\n', {
                headers: { "content-type": "text/event-stream" },
            });
        if (urls.length === 3)
            return Response.json({
                job: {
                    id: "job_1",
                    status: "failed",
                    error: { code: "SOURCE_UNAVAILABLE", message: "Source unavailable" },
                },
            });
        throw new Error("unexpected request");
    };
    try {
        await assert.rejects(downloadWithMediaApi("https://example.test/video", "C:\\temp", { timeoutMs: 10_000 }), {
            code: "SOURCE_UNAVAILABLE",
        });
        assert.equal(urls.length, 3);
        assert.match(urls[1], /\/jobs\/job_1\/events$/);
        assert.match(urls[2], /\/jobs\/job_1$/);
    } finally {
        globalThis.fetch = originalFetch;
        Object.assign(config, original);
    }
});
