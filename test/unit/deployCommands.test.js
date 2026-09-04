import assert from "node:assert/strict";
import test from "node:test";
import { upsertGlobalCommands } from "../../src/commands/deploy.js";

function createRest(existingCommands) {
    const calls = [];
    const rest = {
        calls,
        async get(route) {
            calls.push(["get", route]);
            return existingCommands;
        },
        async patch(route, request) {
            calls.push(["patch", route, request]);
            return { id: "media-id", ...request.body };
        },
        async post(route, request) {
            calls.push(["post", route, request]);
            return { id: "new-media-id", ...request.body };
        },
    };

    return rest;
}

test("updates the managed command without overwriting an Entry Point command", async () => {
    const rest = createRest([
        { id: "entry-id", name: "launch", type: 4, handler: 2 },
        { id: "media-id", name: "media", type: 1 },
    ]);
    const command = { name: "media", description: "Download media", type: 1 };

    const result = await upsertGlobalCommands(rest, "app-id", [command]);

    assert.equal(result.length, 1);
    assert.deepEqual(
        rest.calls.map(([method]) => method),
        ["get", "patch"],
    );
    assert.match(rest.calls[1][1], /media-id$/);
    assert.deepEqual(rest.calls[1][2].body, command);
});

test("creates the managed command when it does not exist", async () => {
    const rest = createRest([{ id: "entry-id", name: "launch", type: 4, handler: 2 }]);
    const command = { name: "media", description: "Download media", type: 1 };

    await upsertGlobalCommands(rest, "app-id", [command]);

    assert.deepEqual(
        rest.calls.map(([method]) => method),
        ["get", "post"],
    );
    assert.deepEqual(rest.calls[1][2].body, command);
});
