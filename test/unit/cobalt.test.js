import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../src/config.js';
import { downloadWithCobalt } from '../../src/download/engines/cobalt.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('downloads a Cobalt tunnel from a configured private instance', async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'POST') {
      const base = `http://127.0.0.1:${server.address().port}`;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'tunnel',
        url: `${base}/media.png`,
        filename: 'cobalt.png',
        metadata: { title: 'Fixture', artist: 'Test' },
      }));
      return;
    }
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
    response.end(PNG);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const attemptDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-cobalt-'));
  t.after(() => fs.rm(attemptDir, { recursive: true, force: true }));
  const previousEndpoints = config.cobaltApiEndpoints;
  const previousDirectory = config.cobaltDirectoryEnabled;
  config.cobaltApiEndpoints = [`http://127.0.0.1:${server.address().port}`];
  config.cobaltDirectoryEnabled = false;
  t.after(() => {
    config.cobaltApiEndpoints = previousEndpoints;
    config.cobaltDirectoryEnabled = previousDirectory;
  });

  const result = await downloadWithCobalt('https://example.com/post', attemptDir, {
    outputType: 'image',
    maxBytes: 1024 * 1024,
  });

  assert.equal(result.fileName, 'cobalt.png');
  assert.equal(result.metadata.title, 'Fixture');
  assert.deepEqual(requests, ['POST /', 'GET /media.png']);
});
