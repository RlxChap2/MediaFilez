import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  missingGuildDeliveryPermissions,
  uploadTargetBytesForInteraction,
} from '../../src/jobs/mediaJob.js';

const MiB = 1024 * 1024;

test('caps the processing target below Discord advertised limit', () => {
  const interaction = { attachmentSizeLimit: 10 * MiB };
  assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 7 * MiB);
});

test('keeps a smaller interaction attachment limit', () => {
  const interaction = { attachmentSizeLimit: 5 * MiB };
  assert.equal(uploadTargetBytesForInteraction(interaction, 7 * MiB), 5 * MiB);
});

function guildInteraction(permissions, { thread = false, guildInstall = true } = {}) {
  return {
    inGuild: () => true,
    authorizingIntegrationOwners: { guildId: guildInstall ? 'guild' : null },
    appPermissions: new PermissionsBitField(permissions),
    channel: { isThread: () => thread },
  };
}

test('requires only the permissions used for a public guild upload', () => {
  const interaction = guildInteraction([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
  ]);

  assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), ['Attach Files']);
});

test('requires thread send permission only inside a thread', () => {
  const interaction = guildInteraction([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ], { thread: true });

  assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), ['Send Messages in Threads']);
});

test('does not apply guild bot permissions to a user-installed command', () => {
  const interaction = guildInteraction([], { guildInstall: false });
  assert.deepEqual(missingGuildDeliveryPermissions(interaction, true), []);
});
