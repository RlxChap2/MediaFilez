import assert from "node:assert/strict";
import test from "node:test";
import { data } from "../../src/commands/media.js";
import { OUTPUT_TYPES } from "../../src/utils/constants.js";

test("exposes auto, video, image, and audio without a separate thumbnail choice", () => {
    const command = data.toJSON();
    const output = command.options.find((option) => option.name === "output");
    assert.deepEqual(
        output.choices.map((choice) => choice.value),
        ["auto", "video", "image", "audio"],
    );
    assert.equal(OUTPUT_TYPES.has("auto"), true);
});
