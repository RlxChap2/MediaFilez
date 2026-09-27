import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ReplySession } from "../../src/platform/discord/replySession.js";
import { messageForError } from "../../src/utils/errors.js";

async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mediafilez-reply-"));
    const filePath = path.join(dir, "result.txt");
    await fs.writeFile(filePath, "media");
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return { filePath, fileName: "result.txt", sizeBytes: 5 };
}

const details = { method: "test", downloadMs: 10, processMs: 2, uploadTargetBytes: 25 * 1024 * 1024 };

async function uploadThroughInteraction(interaction, payload) {
    await interaction.editReply({ content: payload.content, components: payload.components, files: [payload] });
}

test("keeps progress updates clear without exposing the downloader engine", async () => {
    const edits = [];
    const interaction = { editReply: async (payload) => edits.push(payload) };
    const reply = new ReplySession(interaction, { intervalMs: 0 });

    await reply.update({ phase: "resolving", engine: "yt-dlp" });
    await reply.update({ phase: "downloading", engine: "gallery-dl", progress: { percent: 50 } });

    assert.equal(edits[0].content, "Finding the media...");
    assert.equal(edits[1].content, "Downloading the media | 50.0%...");
    assert.doesNotMatch(`${edits[0].content} ${edits[1].content}`, /yt-dlp|gallery-dl/);
});

test("commits once and never overwrites success with a later error", async (t) => {
    const output = await fixture(t);
    const edits = [];
    const interaction = {
        editReply: async (payload) => {
            edits.push(payload);
        },
        fetchReply: async () => ({ attachments: new Map() }),
    };
    const reply = new ReplySession(interaction, { intervalMs: 0, upload: uploadThroughInteraction });
    await reply.commit(output, details);
    await reply.fail(new Error("late failure"));

    assert.equal(reply.state, "committed");
    assert.equal(edits.length, 1);
    assert.equal(edits[0].files.length, 1);
});

test("keeps the media reply compact and adds a Nerd Info button", async (t) => {
    const output = { ...(await fixture(t)), fileName: "clip_test.mp4" };
    const edits = [];
    const interaction = {
        editReply: async (payload) => edits.push(payload),
        fetchReply: async () => ({ attachments: new Map() }),
    };
    const reply = new ReplySession(interaction, { upload: uploadThroughInteraction });

    await reply.commit(output, {
        method: "yt-dlp",
        downloadMs: 21_600,
        processMs: 65_000,
        uploadTargetBytes: 20 * 1024 * 1024,
        metadata: { title: "A clean video title", creator: "The creator" },
    });

    assert.equal(edits[0].content, "-# 5 B");
    assert.equal(edits[0].components[0].components[0].label, "Nerd Info");
    assert.match(edits[0].components[0].components[0].custom_id, /^media-nerd:v1:yt-dlp\./);
});

test("shares a public media URL without uploading an attachment", async () => {
    const edits = [];
    const reply = new ReplySession({ editReply: async (payload) => edits.push(payload) });
    await reply.commit(
        { remoteUrl: "https://cdn.example.test/clip.mp4", fileName: "clip.mp4", sizeBytes: 50_000_000 },
        details,
    );
    assert.equal(reply.state, "committed");
    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /^https:\/\/cdn\.example\.test\/clip\.mp4\n/);
    assert.equal(edits[0].files, undefined);
    assert.equal(edits[0].components[0].components[0].label, "Nerd Info");
});

test("keeps a CDN reply when Discord accepted the edit but the connection failed", async () => {
    const remoteUrl = "https://cdn.example.test/clip.mp4";
    const interaction = {
        editReply: async () => {
            throw new Error("connection closed");
        },
        fetchReply: async () => ({ content: `${remoteUrl}\n-# 47.7 MB` }),
    };
    const reply = new ReplySession(interaction);
    await reply.commit({ remoteUrl, fileName: "clip.mp4", sizeBytes: 50_000_000 }, details);
    await reply.fail(new Error("late failure"));
    assert.equal(reply.state, "committed");
});

test("does not overwrite an uncertain CDN reply with a failure", async () => {
    const remoteUrl = "https://cdn.example.test/clip.mp4";
    let edits = 0;
    const interaction = {
        editReply: async () => {
            edits += 1;
            throw new Error("connection closed");
        },
        fetchReply: async () => {
            throw new Error("connection closed");
        },
    };
    const reply = new ReplySession(interaction);
    await assert.rejects(reply.commit({ remoteUrl, fileName: "clip.mp4", sizeBytes: 50_000_000 }, details));
    await reply.fail(new Error("late failure"));
    assert.equal(reply.state, "unknown");
    assert.equal(edits, 1);
});

test("does not place page metadata in the public media reply", async (t) => {
    const output = await fixture(t);
    let sent;
    const reply = new ReplySession(
        { editReply: async (payload) => (sent = payload) },
        { upload: uploadThroughInteraction },
    );

    await reply.commit(output, {
        ...details,
        metadata: { title: "AmazonPrime https://amzn.to/example", creator: "Ad" },
        recovered: true,
    });

    assert.equal(sent.content, "-# 5 B");
    assert.equal(sent.components[0].components[0].label, "Nerd Info");
});

test("does not try to change reply visibility after the initial response", async () => {
    const edits = [];
    const interaction = {
        editReply: async (payload) => {
            edits.push(payload);
        },
    };
    const reply = new ReplySession(interaction, { upload: uploadThroughInteraction });

    await reply.fail(new Error("failed"));

    assert.equal(edits.length, 1);
    assert.equal("ephemeral" in edits[0], false);
});

test("treats a rejected edit as success when Discord already has the attachment", async (t) => {
    const output = await fixture(t);
    const interaction = {
        editReply: async () => {
            throw new Error("socket closed after upload");
        },
        fetchReply: async () => ({
            attachments: new Map([["1", { name: output.fileName, size: output.sizeBytes }]]),
        }),
    };
    const reply = new ReplySession(interaction, { upload: uploadThroughInteraction });
    await reply.commit(output, details);
    assert.equal(reply.state, "committed");
});

test("retries a transient upload only after Discord confirms there is no attachment", async (t) => {
    const output = await fixture(t);
    let uploadAttempts = 0;
    let verifications = 0;
    const interaction = {
        editReply: async () => {
            uploadAttempts += 1;
            if (uploadAttempts === 1) {
                const error = new Error("other side closed");
                error.name = "SocketError";
                error.code = "UND_ERR_SOCKET";
                throw error;
            }
        },
        fetchReply: async () => {
            verifications += 1;
            return { attachments: new Map() };
        },
    };
    const reply = new ReplySession(interaction, {
        uploadAttempts: 3,
        uploadRetryDelayMs: 0,
        upload: uploadThroughInteraction,
        wait: async () => {},
    });

    await reply.commit(output, details);

    assert.equal(reply.state, "committed");
    assert.equal(uploadAttempts, 2);
    assert.equal(verifications, 1);
});

test("returns a useful error after verified upload attempts are exhausted", async (t) => {
    const output = await fixture(t);
    let uploadAttempts = 0;
    const interaction = {
        editReply: async () => {
            uploadAttempts += 1;
            const error = new Error("other side closed");
            error.name = "SocketError";
            error.code = "UND_ERR_SOCKET";
            throw error;
        },
        fetchReply: async () => ({ attachments: new Map() }),
    };
    const reply = new ReplySession(interaction, {
        uploadAttempts: 2,
        uploadRetryDelayMs: 0,
        upload: uploadThroughInteraction,
        wait: async () => {},
    });

    await assert.rejects(
        reply.commit(output, details),
        (error) => error.name === "UserFacingError" && /after 2 attempts/.test(error.message),
    );

    assert.equal(reply.state, "open");
    assert.equal(uploadAttempts, 2);
});

test("does not retry an upload after the whole job is cancelled", async (t) => {
    const output = await fixture(t);
    const controller = new AbortController();
    controller.abort();
    let uploadAttempts = 0;
    const interaction = {
        fetchReply: async () => ({ attachments: new Map() }),
    };
    const reply = new ReplySession(interaction, {
        uploadAttempts: 3,
        uploadRetryDelayMs: 0,
        upload: async () => {
            uploadAttempts += 1;
            throw Object.assign(new Error("upload aborted"), { name: "AbortError" });
        },
        wait: async () => {},
    });

    await assert.rejects(
        reply.commit(output, details, { signal: controller.signal }),
        (error) => error.name === "UserFacingError" && error.code === "JOB_TIMEOUT",
    );
    assert.equal(uploadAttempts, 1);
    assert.equal(reply.state, "open");
});

test("cancels an upload retry wait when the whole job times out", async (t) => {
    const output = await fixture(t);
    const controller = new AbortController();
    let uploadAttempts = 0;
    let waitCancelled = false;
    let markWaitStarted;
    const waitStarted = new Promise((resolve) => {
        markWaitStarted = resolve;
    });
    const interaction = {
        fetchReply: async () => ({ attachments: new Map() }),
    };
    const reply = new ReplySession(interaction, {
        uploadAttempts: 3,
        upload: async () => {
            uploadAttempts += 1;
            throw Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 60_000 });
        },
        wait: async (_milliseconds, signal) => {
            markWaitStarted();
            return await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(true), 60_000);
                signal.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        waitCancelled = true;
                        resolve(false);
                    },
                    { once: true },
                );
            });
        },
    });

    const rejection = assert.rejects(
        reply.commit(output, details, { signal: controller.signal }),
        (error) => error.name === "UserFacingError" && error.code === "JOB_TIMEOUT",
    );
    await waitStarted;
    controller.abort();
    await rejection;

    assert.equal(uploadAttempts, 1);
    assert.equal(waitCancelled, true);
    assert.equal(reply.state, "open");
});

test("preserves user-facing messages even across module or realm boundaries", () => {
    assert.equal(
        messageForError({ name: "UserFacingError", message: "The measured file does not fit." }),
        "The measured file does not fit.",
    );
});
