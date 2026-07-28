import assert from 'node:assert/strict';
import test from 'node:test';
import { planEngines } from '../../src/download/planner.js';

const settings = {
  disabledEngines: new Set(),
  youtubeJsEnabled: true,
  galleryDlEnabled: true,
  cobaltApiEndpoints: ['http://cobalt:9000'],
  cobaltDirectoryEnabled: false,
};

test('plans ordered YouTube fallbacks', () => {
  assert.deepEqual(planEngines('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video', settings), [
    'yt-dlp', 'youtube-js', 'cobalt',
  ]);
});

test('sends social image posts to gallery-dl first', () => {
  assert.deepEqual(planEngines('https://www.instagram.com/p/example/', 'image', settings), [
    'gallery-dl', 'cobalt', 'yt-dlp',
  ]);
});

test('filters disabled and unconfigured engines', () => {
  const minimal = { ...settings, disabledEngines: new Set(['youtube-js']), cobaltApiEndpoints: [] };
  assert.deepEqual(planEngines('https://youtu.be/dQw4w9WgXcQ', 'video', minimal), ['yt-dlp']);
});
