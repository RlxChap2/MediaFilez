import assert from "node:assert/strict";
import test from "node:test";
import { data } from "../../src/commands/media.js";

test("exposes video, image, and audio without a separate thumbnail choice", () => {
    const command = data.toJSON();
    const output = command.options.find((option) => option.name === "output");
    assert.deepEqual(
        output.choices.map((choice) => choice.value),
        ["video", "image", "audio"],
    );
});
