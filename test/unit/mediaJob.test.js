import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadTargetBytesForInteraction } from '../../src/jobs/mediaJob.js';

const MiB = 1024 * 1024;

test('caps the processing target below Discord advertised limit', () => {
  const interaction = { attachmentSizeLimit: 10 * MiB };
  assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 7 * MiB);
});

test('keeps a smaller interaction attachment limit', () => {
  const interaction = { attachmentSizeLimit: 5 * MiB };
  assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 5 * MiB);
});
