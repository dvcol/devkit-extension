import { defineService } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { counterService } from '@devkit/example-server-contexts';
import { providerFromVite } from '@devkit/example-vite-hosts';
import { devframeHubContext, devToolsContext, serverExecution } from '@devkit/server';
import { describe, expect, it, vi } from 'vitest';

import { admitted, bindingFor } from './fixtures.js';
import { previewFixture } from './preview-fixture.js';

describe.each(['devframe', 'devtools'] as const)('%s production preview', (host) => {
  it('serves a real build with live metadata, native context and counter actions', async () => {
    expect.assertions(11);
    const current = await previewFixture(host);
    try {
      const provider = await providerFromVite(current.server);
      const { api, native } = await bindingFor(provider);
      const hub = native.get(devframeHubContext);
      const page = await fetch(current.origin);
      expect(await page.text()).toBe(current.builtHtml);
      const assetPath = /src="([^"]+)"/u.exec(current.builtHtml)?.[1];
      expect(assetPath).toMatch(/^\/assets\//u);
      const asset = await fetch(`${current.origin}${assetPath}`);
      expect(await asset.text()).toContain('Built preview receipt');
      const metadata = await fetch(`${current.origin}${current.metadataPath}`);
      expect(await metadata.json()).toMatchObject({ backend: 'websocket' });
      expect(hub).toBeDefined();
      expect(native.get(devToolsContext) === hub).toBe(host === 'devtools');
      expect(native.get(devToolsContext)?.viteServer).toBeUndefined();
      await expect(provider.invoke(increaseCounterAction, { amount: 4 })).resolves.toBe(4);
      await expect(api.read({})).resolves.toBe(4);
      await current.server.close();
      expect(hub?.commands.commands.has('example:read-server-counter')).toBe(false);
      expect(admitted(provider.startup.services[0]).snapshot().status).toBe('disposed');
    } finally {
      await current.close();
    }
  });

  it('closes native transports even when contribution cleanup fails', async () => {
    expect.assertions(5);
    const current = await previewFixture(host);
    const reporting = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const provider = await providerFromVite(current.server);
      const installation = admitted(
        await provider.services.replace(
          admitted(provider.startup.services[0]),
          defineService({
            capability: counterCapability,
            id: 'example.preview-failed-cleanup',
            execution: serverExecution,
            setup(context) {
              context.scope.onDispose(() => {
                throw new Error('Preview cleanup sentinel');
              });
              return counterService.setup(context);
            },
          }),
        ),
      );
      await expect(current.server.close()).rejects.toThrow('Preview backend cleanup failed');
      expect(installation.snapshot().status).toBe('cleanup-blocked');
      expect(current.server.httpServer.listenerCount('upgrade')).toBe(0);
      expect(current.server.httpServer.listening).toBe(false);
    } finally {
      try {
        await expect(current.close()).rejects.toThrow('Preview backend cleanup failed');
      } finally {
        reporting.mockRestore();
      }
    }
  });

  it('awaits contribution cleanup before preview shutdown resolves', async () => {
    expect.assertions(4);
    const current = await previewFixture(host);
    const cleanupEntered = Promise.withResolvers<void>();
    const cleanupRelease = Promise.withResolvers<void>();
    let closing: Promise<boolean> | undefined;
    try {
      const provider = await providerFromVite(current.server);
      const installation = admitted(
        await provider.services.replace(
          admitted(provider.startup.services[0]),
          defineService({
            capability: counterCapability,
            id: 'example.preview-delayed-counter',
            execution: serverExecution,
            setup(context) {
              context.scope.onDispose(async () => {
                cleanupEntered.resolve();
                await cleanupRelease.promise;
              });
              return counterService.setup(context);
            },
          }),
        ),
      );
      let closed = false;
      closing = current.server.close().then(() => {
        closed = true;
        return closed;
      });
      await cleanupEntered.promise;
      expect(closed).toBe(false);
      expect(installation.snapshot().status).toBe('disposing');
      cleanupRelease.resolve();
      await closing;
      expect(installation.snapshot().status).toBe('disposed');
      expect(current.server.httpServer.listenerCount('upgrade')).toBe(0);
    } finally {
      cleanupRelease.resolve();
      await closing;
      await current.close();
    }
  });
});
