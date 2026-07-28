import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFFmpeg, compressVideo, runFFmpeg } from '../../src/utils/ffmpeg.js';

test('fits low-bitrate video instead of rejecting it before an attempt', async (t) => {
  if (!await checkFFmpeg()) return t.skip('FFmpeg is not installed.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-fit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.mp4');
  await runFFmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
    '-shortest', '-c:v', 'libx264', '-b:v', '500k',
    '-c:a', 'aac', '-b:a', '128k', '-y', input,
  ]);

  const targetSize = 220 * 1024;
  const output = await compressVideo(input, dir, targetSize);
  assert.ok((await fs.stat(output)).size <= targetSize);
});
