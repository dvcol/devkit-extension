import { defineContributionKind, defineExtension, definePlugin } from '@devkit/core';
import type { ContributionKindInstaller } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { devframeHubContext, installDevframeProvider, serverExecution } from '../src/index.js';

import { admitted, counterService } from './fixtures.js';
import { createDevframeHost } from './host-fixtures.js';

const commandKind = defineContributionKind({
  id: 'example.command',
  schema: z.object({ title: z.string() }),
});
const commandInstaller: ContributionKindInstaller<typeof commandKind> = {
  descriptor: commandKind,
  activate(definition, { native, scope }) {
    const context = native.get(devframeHubContext);
    if (context === undefined) throw new Error('Missing hub');
    const command = context.commands.register({
      id: definition.id,
      title: definition.payload.title,
      handler: () => definition.payload.title,
    });
    scope.onDispose(() => {
      command.unregister();
    });
  },
};

describe('server contribution kinds and diagnostics', () => {
  it('runs an explicit kind installer against the real native host and owns its cleanup', async () => {
    expect.assertions(3);
    const host = await createDevframeHost();
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.extension',
      kinds: [commandInstaller],
      plugins: [
        definePlugin({
          id: 'example.commands',
          extensions: [
            defineExtension({
              descriptor: commandKind,
              id: 'example:command',
              execution: serverExecution,
              payload: { title: 'Custom command' },
            }),
          ],
        }),
      ],
    });
    expect(admitted(provider.startup.plugins[0]).snapshot().status).toBe('ready');
    await expect(host.context.commands.execute('example:command')).resolves.toBe('Custom command');
    await provider.dispose();
    expect(host.context.commands.commands.has('example:command')).toBe(false);
  });

  it('reports skipped startup definitions through the default local sink', async () => {
    expect.assertions(3);
    const output = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = await createDevframeHost();
    try {
      const provider = await installDevframeProvider(host.context, {
        providerId: 'example.diagnostics',
        strict: false,
        services: [counterService, counterService],
      });
      expect(provider.startup.services.map((result) => result.status)).toEqual([
        'admitted',
        'skipped',
      ]);
      expect(output).toHaveBeenCalledWith(
        expect.stringContaining('[devkit/server]'),
        expect.objectContaining({ code: 'duplicate-registration' }),
        undefined,
      );
      expect(admitted(provider.startup.services[0]).snapshot().status).toBe('ready');
      await provider.dispose();
    } finally {
      output.mockRestore();
    }
  });
});
