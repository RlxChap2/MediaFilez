import { MB } from "../src/config.js";
import { downloadMedia } from "../src/download/orchestrator.js";
import { prepareMediaForDiscord } from "../src/media/processor.js";
import { cleanupTempDir, createRequestTempDir } from "../src/utils/temp.js";
import { formatBytes } from "../src/utils/format.js";

const url = process.argv.slice(2).find((arg) => arg !== "--") || "https://samplelib.com/lib/preview/mp4/sample-5s.mp4";
let tempDir = null;

try {
    tempDir = await createRequestTempDir();
    const download = await downloadMedia(url, tempDir, {
        maxBytes: 10 * MB,
        outputType: "video",
    });

    const thumbnail = await prepareMediaForDiscord(download, {
        outputType: "thumbnail",
        tempDir,
        maxAttachmentBytes: 10 * MB,
        allowCompression: true,
    });

    const audio = await prepareMediaForDiscord(download, {
        outputType: "audio",
        tempDir,
        maxAttachmentBytes: 10 * MB,
        allowCompression: true,
    });

    console.log(`Thumbnail OK: ${thumbnail.fileName} (${formatBytes(thumbnail.sizeBytes)}).`);
    console.log(`Audio OK: ${audio.fileName} (${formatBytes(audio.sizeBytes)}).`);
} finally {
    await cleanupTempDir(tempDir);
}
