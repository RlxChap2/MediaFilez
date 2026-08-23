import assert from "node:assert/strict";
import test from "node:test";
import { extractPageMetadata } from "../../src/download/engines/pageMetadata.js";

test("extracts ordered Open Graph media and resolves relative URLs", () => {
    const html = `
        <meta property="og:title" content="Example reel">
        <meta property="og:video:secure_url" content="/media/reel.mp4?x=1&amp;y=2">
        <meta property="og:video" content="https://cdn.example.net/fallback.mp4">
    `;
    const metadata = extractPageMetadata(html, new URL("https://example.com/post/1"), "video");

    assert.equal(metadata.title, "Example reel");
    assert.deepEqual(metadata.candidates, [
        "https://example.com/media/reel.mp4?x=1&y=2",
        "https://cdn.example.net/fallback.mp4",
    ]);
});

test("keeps image metadata separate from video candidates", () => {
    const html = `
        <meta property="og:video" content="https://cdn.example/video.mp4">
        <meta property="og:image" content="https://cdn.example/post.jpg">
    `;
    const metadata = extractPageMetadata(html, new URL("https://example.com/post"), "image");
    assert.deepEqual(metadata.candidates, ["https://cdn.example/post.jpg"]);
});
