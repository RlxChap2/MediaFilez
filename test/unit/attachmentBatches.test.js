import assert from "node:assert/strict";
import test from "node:test";
import {
    attachmentBatches,
    carouselUploadTarget,
    interactionMessageLimit,
    DISCORD_FILE_BUDGET,
} from "../../src/platform/discord/attachmentBatches.js";

const files = (count, sizeBytes = 1024) =>
    Array.from({ length: count }, (_, i) => ({ fileName: `${i}.jpg`, sizeBytes }));

test("keeps carousel order across the ten-attachment message boundary", () => {
    const outputs = files(16);
    const batches = attachmentBatches(outputs);
    assert.deepEqual(
        batches.map((batch) => batch.length),
        [10, 6],
    );
    assert.deepEqual(batches.flat(), outputs);
});

test("splits uploads by aggregate message bytes before sending", () => {
    assert.deepEqual(
        attachmentBatches(files(3, 13 * 1024 * 1024)).map((batch) => batch.length),
        [1, 1, 1],
    );
    assert.throws(() => attachmentBatches(files(1, DISCORD_FILE_BUDGET + 1)), { code: "FILE_TOO_LARGE" });
});

test("fits user-only installs within the original reply and five followups", () => {
    const userOnly = { authorizingIntegrationOwners: { userId: "123" } };
    assert.equal(interactionMessageLimit(userOnly), 6);
    assert.equal(
        interactionMessageLimit({ authorizingIntegrationOwners: { userId: "123", guildId: "456" } }),
        Infinity,
    );
    const target = carouselUploadTarget(userOnly, 50, 25 * 1024 * 1024);
    assert.ok(attachmentBatches(files(50, target), 6).length <= 6);
    assert.throws(() => attachmentBatches(files(7, DISCORD_FILE_BUDGET), 6), { code: "TOO_MANY_ATTACHMENTS" });
});
