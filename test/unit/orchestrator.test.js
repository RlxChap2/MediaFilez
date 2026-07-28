import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadMedia } from '../../src/download/orchestrator.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function tempJob() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-test-'));
}

test('stops after the first valid engine result', async (t) => {
  const jobDir = await tempJob();
  t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
  const calls = [];
  const engines = new Map([
    ['first', async (_url, attemptDir) => {
      calls.push('first');
      const filePath = path.join(attemptDir, 'result.png');
      await fs.writeFile(filePath, PNG);
      return { filePath, fileName: 'result.png', method: 'first' };
    }],
    ['second', async () => { calls.push('second'); throw new Error('must not run'); }],
  ]);

  const result = await downloadMedia('https://example.com/post', jobDir, {
    outputType: 'image',
    plan: ['first', 'second'],
    engines,
  });

  assert.deepEqual(calls, ['first']);
  assert.equal(result.committed, true);
  assert.equal(result.method, 'first');
});

test('recovers a complete artifact after an engine error and stops fallback', async (t) => {
  const jobDir = await tempJob();
  t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
  const calls = [];
  const engines = new Map([
    ['unstable', async (_url, attemptDir) => {
      calls.push('unstable');
      await fs.writeFile(path.join(attemptDir, 'complete.png'), PNG);
      throw new Error('process returned a non-zero exit code');
    }],
    ['fallback', async () => { calls.push('fallback'); throw new Error('must not run'); }],
  ]);

  const result = await downloadMedia('https://example.com/post', jobDir, {
    outputType: 'image',
    plan: ['unstable', 'fallback'],
    engines,
  });

  assert.deepEqual(calls, ['unstable']);
  assert.equal(result.recovered, true);
  assert.equal(result.method, 'unstable');
});

test('does not start an engine after job cancellation', async (t) => {
  const jobDir = await tempJob();
  t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  let called = false;

  await assert.rejects(
    downloadMedia('https://example.com/post', jobDir, {
      outputType: 'image',
      signal: controller.signal,
      plan: ['engine'],
      engines: new Map([['engine', async () => { called = true; }]]),
    }),
    /timed out/,
  );
  assert.equal(called, false);
});

test('does not misreport a generic HTTP 403 as missing account cookies', async (t) => {
  const jobDir = await tempJob();
  t.after(() => fs.rm(jobDir, { recursive: true, force: true }));
  const engines = new Map([
    ['blocked', async () => { throw new Error('HTTP Error 403: Forbidden'); }],
    ['unsupported', async () => { throw new Error('Unsupported URL'); }],
  ]);

  await assert.rejects(
    downloadMedia('https://example.com/stock-page', jobDir, {
      outputType: 'image',
      plan: ['blocked', 'unsupported'],
      engines,
    }),
    (error) => /blocked automated access/.test(error.message) && !/cookies/i.test(error.message),
  );
});
