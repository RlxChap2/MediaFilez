import { config, MB } from '../src/config.js';
import { downloadMedia } from '../src/download/orchestrator.js';
import { cleanupTempDir, createRequestTempDir } from '../src/utils/temp.js';
import { formatBytes } from '../src/utils/format.js';

const url = process.argv.slice(2).find(arg => arg !== '--') || 'https://raw.githubusercontent.com/github/explore/main/topics/nodejs/nodejs.png';
let tempDir = null;

try {
  tempDir = await createRequestTempDir();
  const result = await downloadMedia(url, tempDir, {
    maxBytes: Math.min(config.maxDownloadBytes, 10 * MB),
    targetBytes: 10 * MB,
    outputType: 'auto',
  });

  console.log(`Detected ${result.mediaKind}: ${result.fileName} (${formatBytes(result.sizeBytes)}) via ${result.method}.`);
} finally {
  await cleanupTempDir(tempDir);
}
