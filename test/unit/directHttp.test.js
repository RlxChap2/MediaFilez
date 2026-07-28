import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { downloadDirectHttp } from '../../src/download/engines/directHttp.js';
import { DownloadMethodError } from '../../src/utils/errors.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('allows a slow transfer while bytes continue to arrive', async (t) => {
  const server = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.flushHeaders();
    let offset = 0;
    const timer = setInterval(() => {
      const next = Math.min(PNG.length, offset + 10);
      response.write(PNG.subarray(offset, next));
      offset = next;
      if (offset === PNG.length) {
        clearInterval(timer);
        response.end();
      }
    }, 20);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-http-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const host = `127.0.0.1:${server.address().port}`;

  const result = await downloadDirectHttp(`http://${host}/image.png`, dir, {
    maxBytes: 1024,
    responseTimeoutMs: 50,
    idleTimeoutMs: 60,
    trustedHosts: ['127.0.0.1'],
  });
  assert.equal(result.sizeBytes, PNG.length);
});

test('fails a transfer that stops making progress', async (t) => {
  const server = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.write(PNG.subarray(0, 8));
    setTimeout(() => response.end(), 150).unref();
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-http-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const host = `127.0.0.1:${server.address().port}`;

  await assert.rejects(
    downloadDirectHttp(`http://${host}/image.png`, dir, {
      maxBytes: 1024,
      responseTimeoutMs: 50,
      idleTimeoutMs: 30,
      trustedHosts: ['127.0.0.1'],
    }),
    /stalled/,
  );
});

test('turns an incomplete socket close into an engine failure and removes the partial file', async (t) => {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write([
        'HTTP/1.1 200 OK',
        'Content-Type: image/png',
        `Content-Length: ${PNG.length}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n'));
      socket.write(PNG.subarray(0, 12), () => socket.destroy());
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediafilez-http-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const host = `127.0.0.1:${server.address().port}`;

  await assert.rejects(
    downloadDirectHttp(`http://${host}/image.png`, dir, {
      maxBytes: 1024,
      responseTimeoutMs: 100,
      idleTimeoutMs: 100,
      trustedHosts: ['127.0.0.1'],
    }),
    (error) => error instanceof DownloadMethodError && /closed|socket|terminated|aborted|ECONNRESET/i.test(error.message),
  );
  assert.deepEqual(await fs.readdir(dir), []);
});
