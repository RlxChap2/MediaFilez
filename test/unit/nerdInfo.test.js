import assert from "node:assert/strict";
import test from "node:test";
import { MessageFlags } from "discord.js";
import { createNerdInfoComponents, handleNerdInfoButton } from "../../src/platform/discord/nerdInfo.js";

test("shows persistent Nerd Info from the message attachment", async () => {
    const components = createNerdInfoComponents(
        { note: "transcoded to fit Discord" },
        {
            method: "gallery-dl",
            downloadMs: 1_530,
            processMs: 0.3,
            uploadTargetBytes: 20 * 1024 * 1024,
            recovered: false,
        },
    );
    let reply;
    const handled = await handleNerdInfoButton({
        isButton: () => true,
        customId: components[0].components[0].custom_id,
        message: { attachments: new Map([["1", { name: "_1083115779141952773.mp4", size: 893.5 * 1024 }]]) },
        reply: async (payload) => {
            reply = payload;
        },
    });

    assert.equal(handled, true);
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(
        reply.content,
        [
            "**Ready: \\_1083115779141952773.mp4**",
            "-# Engine: gallery-dl",
            "-# Download: 1.53s · Processing: 0.3ms",
            "-# Upload target: 20.0 MB · 893.5 KB",
            "-# Note: transcoded to fit Discord",
        ].join("\n"),
    );
});

test("ignores unrelated buttons", async () => {
    assert.equal(await handleNerdInfoButton({ isButton: () => true, customId: "another-button" }), false);
});

test("handles a missing attachment without throwing", async () => {
    const components = createNerdInfoComponents(
        {},
        { method: "yt-dlp", downloadMs: 10, processMs: 2, uploadTargetBytes: 20 * 1024 * 1024 },
    );
    let reply;
    assert.equal(
        await handleNerdInfoButton({
            isButton: () => true,
            customId: components[0].components[0].custom_id,
            message: { attachments: new Map() },
            reply: async (payload) => {
                reply = payload;
            },
        }),
        true,
    );
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, /attachment is no longer present/);
});

test("shows Nerd Info for a CDN link without an attachment", async () => {
    const components = createNerdInfoComponents(
        { remoteUrl: "https://cdn.example.test/clip.mp4", sizeBytes: 50_000_000 },
        { method: "media-api-worker", downloadMs: 100, processMs: 20, uploadTargetBytes: 20_000_000 },
    );
    let sent;
    await handleNerdInfoButton({
        isButton: () => true,
        customId: components[0].components[0].custom_id,
        message: { content: "https://cdn.example.test/clip.mp4\n-# 47.7 MB", attachments: new Map() },
        reply: async (value) => (sent = value),
    });
    assert.match(sent.content, /clip\.mp4/);
    assert.match(sent.content, /47\.7 MB/);
    assert.match(sent.content, /Delivery: CDN link/);
});
