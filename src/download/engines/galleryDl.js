import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import { DownloadMethodError } from '../../utils/errors.js';
import { ProcessExecutionError, runProcess } from '../../utils/process.js';
import { recoverArtifact } from '../artifact.js';

export function resolveGalleryDlPath() {
  if (config.galleryDlPath) return config.galleryDlPath;
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const bundledName = process.platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl';
  const bundledPath = path.join(projectRoot, '.tools', bundledName);
  return fsSync.existsSync(bundledPath) ? bundledPath : 'gallery-dl';
}

async function readMetadata(attemptDir) {
  const entries = await fs.readdir(attemptDir, { recursive: true }).catch(() => []);
  const metadataName = entries.find((name) => typeof name === 'string' && name.endsWith('.json'));
  if (!metadataName) return null;
  try {
    const data = JSON.parse(await fs.readFile(path.join(attemptDir, metadataName), 'utf8'));
    return {
      title: data.title || data.description,
      creator: data.author?.name || data.author || data.username,
      sourceUrl: data.post_url || data.url,
      sourceId: data.id || data.post_id,
      extractor: data.category || data.extractor,
    };
  } catch {
    return null;
  }
}

function processMessage(error) {
  if (error?.cause?.code === 'ENOENT') {
    return 'gallery-dl is unavailable. Run pnpm run tools:install, set GALLERY_DL_PATH, or use Docker.';
  }
  const lines = `${error?.stderr || ''}\n${error?.stdout || ''}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.findLast((line) => /error|failed|unsupported/i.test(line)) || lines.at(-1) || error.message;
}

export async function downloadWithGalleryDl(rawUrl, attemptDir, options = {}) {
  const args = [
    '--no-input', '--no-colors', '--directory', attemptDir, '--range', '1',
    '--write-metadata', '--write-info-json', '--retries', '3', '--http-timeout', '30',
    '--filename', '{title[:120]}_{id}.{extension}', '--', rawUrl,
  ];
  if (config.mediaCookiesFile) args.unshift('--cookies', config.mediaCookiesFile);

  let processError = null;
  try {
    await runProcess(resolveGalleryDlPath(), args, {
      timeoutMs: config.ytdlpTimeoutMs,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.aborted) throw Object.assign(new Error('The download was cancelled.'), { name: 'AbortError' });
    processError = error;
  }

  const artifact = await recoverArtifact(attemptDir, {
    outputType: options.outputType,
    maxBytes: options.maxBytes,
    signal: options.signal,
  });
  if (artifact) {
    return {
      ...artifact,
      method: 'gallery-dl',
      sourceUrl: rawUrl,
      metadata: await readMetadata(attemptDir),
      recoveredFromProcessError: Boolean(processError),
    };
  }
  throw new DownloadMethodError('gallery-dl', processError ? processMessage(processError) : 'gallery-dl produced no playable file.');
}
