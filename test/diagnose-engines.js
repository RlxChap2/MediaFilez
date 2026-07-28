import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../src/config.js';
import { planEngines } from '../src/download/planner.js';
import { resolveYtDlpPath } from '../src/download/engines/ytDlp.js';

const execFileAsync = promisify(execFile);
const sampleUrl = process.argv.slice(2).find((value) => value !== '--') || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function version(command) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], { timeout: 10_000, windowsHide: true });
    return (stdout || stderr).trim().split(/\r?\n/)[0];
  } catch (error) {
    return error.code === 'ENOENT' ? 'not installed' : `failed: ${error.message}`;
  }
}

console.log(`URL\t${sampleUrl}`);
console.log(`PLAN\t${planEngines(sampleUrl, 'video').join(' -> ')}`);
console.log(`yt-dlp\t${await version(resolveYtDlpPath())}`);
console.log(`gallery-dl\t${config.galleryDlEnabled ? await version(config.galleryDlPath) : 'disabled'}`);
console.log(`Cobalt\t${config.cobaltApiEndpoints.length ? config.cobaltApiEndpoints.map((value) => new URL(value).host).join(', ') : 'disabled'}`);
console.log(`cookies\t${config.mediaCookiesFile ? 'file configured' : config.ytdlpCookiesFromBrowser ? 'browser extraction configured' : 'anonymous'}`);
