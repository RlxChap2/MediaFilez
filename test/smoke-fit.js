import { MB } from "../src/config.js";
import { downloadMedia } from "../src/download/orchestrator.js";
import { prepareMediaForDiscord } from "../src/media/processor.js";
import { cleanupTempDir, createRequestTempDir } from "../src/utils/temp.js";
import { formatBytes } from "../src/utils/format.js";

const url = process.argv.slice(2).find((argument) => argument !== "--");
if (!url) throw new Error("Usage: pnpm run smoke:fit -- <media URL>");

const maxAttachmentBytes = Number.parseInt(process.env.SMOKE_UPLOAD_LIMIT_BYTES || "", 10) || 10 * MB;
let tempDir;
let lastPhase;
let lastProgressBucket = -1;

function reportStatus(status) {
    const percent = Number.isFinite(status.progress?.percent) ? status.progress.percent : null;
    const progressBucket = percent === null ? -1 : Math.floor(percent / 10);
    if (status.phase === lastPhase && progressBucket === lastProgressBucket) return;
    lastPhase = status.phase;
    lastProgressBucket = progressBucket;
    const progress = percent === null ? "" : ` ${Math.min(percent, 100).toFixed(1)}%`;
    console.log(`${status.phase}${status.engine ? ` (${status.engine})` : ""}${progress}`);
}

try {
    tempDir = await createRequestTempDir();
    const download = await downloadMedia(url, tempDir, {
        maxBytes: 500 * MB,
        targetBytes: maxAttachmentBytes,
        outputType: "auto",
        onStatus: reportStatus,
    });
    const output = await prepareMediaForDiscord(download, {
        outputType: "auto",
        tempDir,
        maxAttachmentBytes,
        allowCompression: true,
        onStatus: reportStatus,
    });

    console.log(
        `Fit OK: ${output.fileName} (${formatBytes(output.sizeBytes)}) via ${download.method}; limit ${formatBytes(maxAttachmentBytes)}.`,
    );
} finally {
    await cleanupTempDir(tempDir);
}
