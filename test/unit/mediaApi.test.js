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
