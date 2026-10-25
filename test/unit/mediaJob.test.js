import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import {
    enqueue,
    missingGuildDeliveryPermissions,
    privateReplyForInteraction,
    runMediaJob,
    uploadTargetBytesForInteraction,
} from "../../src/jobs/mediaJob.js";

const MiB = 1024 * 1024;

test("prepares and commits every carousel item before cleaning the job directory", async () => {
    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
    );
    let committed;
    let directory;
    const reply = {
        update: async () => {},
        commit: async () => assert.fail("must deliver the whole collection"),
        commitMany: async (items) => {
            assert.equal(items.length, 3);
            for (const item of items) assert.deepEqual(await fs.readFile(item.filePath), png);
            committed = items;
        },
        fail: async (error) => assert.fail(error.message),
    };
    await runMediaJob(
        { user: { tag: "carousel-test" }, attachmentSizeLimit: 10 * MiB },
        reply,
        { url: "https://www.instagram.com/p/fixture/", outputType: "auto", fitToLimit: true },
        {
            downloadMedia: async (_url, tempDir) => {
                directory = tempDir;
                const items = [];
                for (let i = 1; i <= 3; i++) {
                    const filePath = path.join(tempDir, `${i}.png`);
                    await fs.writeFile(filePath, png);
                    items.push({
                        filePath,
                        fileName: `${i}.png`,
                        sizeBytes: png.length,
                        mime: "image/png",
                        mediaKind: "image",
                        extension: "png",
                    });
                }
                return { ...items[0], items, method: "fixture" };
            },
        },
    );
    assert.equal(committed.length, 3);
    await assert.rejects(fs.stat(directory), { code: "ENOENT" });
});

test("keeps an operator ceiling below the Discord advertised limit", () => {
    const interaction = { attachmentSizeLimit: 10 * MiB };
    assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 7 * MiB);
});

test("keeps a smaller interaction attachment limit", () => {
    const interaction = { attachmentSizeLimit: 5 * MiB };
    assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 5 * MiB);
});

test("uses the Discord advertised limit when the operator ceiling is higher", () => {
    const interaction = { attachmentSizeLimit: 100 * MiB };
    assert.equal(uploadTargetBytesForInteraction(interaction, 500 * MiB), 100 * MiB);
});

function guildInteraction(permissions, { thread = false, guildInstall = true } = {}) {
    return {
        inGuild: () => true,
        authorizingIntegrationOwners: { guildId: guildInstall ? "guild" : null },
        appPermissions: new PermissionsBitField(permissions),
        channel: { isThread: () => thread },
    };
}

test("requires only the permissions used for a public guild upload", () => {
    const interaction = guildInteraction([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);

    assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), ["Attach Files"]);
});

test("requires thread send permission only inside a thread", () => {
    const interaction = guildInteraction(
        [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
        { thread: true },
    );

    assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), ["Send Messages in Threads"]);
});

test("does not apply guild bot permissions to a user-installed command", () => {
    const interaction = guildInteraction([], { guildInstall: false });
    assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), []);
});

function privacyInteraction(value, inGuild = true) {
    return {
        inGuild: () => inGuild,
        options: { getBoolean: (name) => (name === "private" ? value : null) },
    };
}

test("makes a guild reply private only when the user requests it", () => {
    assert.equal(privateReplyForInteraction(privacyInteraction(true), true), true);
    assert.equal(privateReplyForInteraction(privacyInteraction(false), true), false);
    assert.equal(privateReplyForInteraction(privacyInteraction(null), true), false);
});

test("keeps the operator privacy setting and treats DMs as already private", () => {
    assert.equal(privateReplyForInteraction(privacyInteraction(false), false), true);
});

test("honors a requested private reply outside guilds", () => {
    assert.equal(privateReplyForInteraction(privacyInteraction(true, false), true), true);
    assert.equal(privateReplyForInteraction(privacyInteraction(false, false), true), false);
});

test("expires a media request while it is still waiting in the queue", async () => {
    const waitingQueue = {
        size: 0,
        pending: 0,
        add(_task, options) {
            assert.ok(options?.signal, "the queue entry should receive a deadline signal");
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
            });
        },
    };
    const reply = { update: async () => {} };
    const interaction = { user: { id: "queued-user" } };

    await assert.rejects(
        enqueue(interaction, reply, {}, { queue: waitingQueue, timeoutMs: 20 }),
        (error) => error.name === "TimeoutError",
    );
});

test("reports a job timeout when a running media request is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline reached", "TimeoutError"));
    let attemptedDownload = false;
    let failure;
    const reply = {
        fail: async (error) => {
            failure = error;
        },
    };
    const interaction = {
        attachmentSizeLimit: 20 * 1024 * 1024,
        user: { tag: "timeout-user" },
    };

    await runMediaJob(
        interaction,
        reply,
        { url: "https://example.com/video.mp4", outputType: "auto" },
        {
            signal: controller.signal,
            downloadMedia: async () => {
                attemptedDownload = true;
                throw new DOMException("cancelled download", "AbortError");
            },
        },
    );

    assert.equal(attemptedDownload, true);
    assert.equal(failure?.code, "JOB_TIMEOUT");
});
