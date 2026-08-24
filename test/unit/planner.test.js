import assert from 'node:assert/strict';
import test from 'node:test';
import { planEngines } from '../../src/download/planner.js';

const settings = {
  disabledEngines: new Set(),
  youtubeJsEnabled: true,
  galleryDlEnabled: true,
  pageMetadataEnabled: true,
  instagramProxyHosts: ['www.kkkinstagram.com'],
  cobaltApiEndpoints: ['http://cobalt:9000'],
  cobaltDirectoryEnabled: false,
};

test('plans ordered YouTube fallbacks', () => {
  assert.deepEqual(planEngines('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'video', settings), [
    'yt-dlp', 'youtube-js', 'cobalt', 'page-metadata',
  ]);
});

test('sends social image posts to gallery-dl first', () => {
  assert.deepEqual(planEngines('https://www.instagram.com/p/example/', 'image', settings), [
    'gallery-dl', 'yt-dlp', 'instagram-proxy', 'cobalt', 'page-metadata',
  ]);
});

test('uses the Instagram redirect fallback before general extractors', () => {
  assert.deepEqual(planEngines('https://www.instagram.com/reels/example/', 'video', settings), [
    'yt-dlp', 'instagram-proxy', 'cobalt', 'gallery-dl', 'page-metadata',
  ]);
});

test('sends Pinterest to gallery-dl for video and image posts', () => {
  assert.deepEqual(planEngines('https://www.pinterest.com/pin/example/', 'video', settings), [
    'gallery-dl', 'yt-dlp', 'cobalt', 'page-metadata',
  ]);
});

test('uses Reddit embed fallback for short image links', () => {
  assert.deepEqual(planEngines('https://www.reddit.com/r/discordapp/s/example', 'image', settings), [
    'reddit-embed', 'gallery-dl', 'yt-dlp', 'cobalt', 'page-metadata',
  ]);
});

test('filters disabled and unconfigured engines', () => {
  const minimal = {
    ...settings,
    disabledEngines: new Set(['youtube-js']),
    cobaltApiEndpoints: [],
    pageMetadataEnabled: false,
  };
  assert.deepEqual(planEngines('https://youtu.be/dQw4w9WgXcQ', 'video', minimal), ['yt-dlp']);
});
