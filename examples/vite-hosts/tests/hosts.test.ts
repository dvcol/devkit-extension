import { defineService } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { counterService } from '@devkit/example-server-contexts';
import { providerFromVite } from '@devkit/example-vite-hosts';
import { devframeHubContext, devToolsContext, serverExecution } from '@devkit/server';
import { describe, expect, it, vi } from 'vitest';

import { admitted, bindingFor, connectionMetadata, fixture } from './fixtures.js';

describe.each(['devframe', 'devtools'] as const)('%s Vite host', (host) => {
  it('serves the native host and runs the shared action with genuine native contexts', async () => {
    expect.assertions(8);
    const current = await fixture(host);
    try {
      await current.server.listen();
      const provider = await providerFromVite(current.server);
      const binding = await bindingFor(provider);
      const hub = binding.native.get(devframeHubContext);
      expect(hub).toBeDefined();
      expect(binding.native.get(devToolsContext) === hub).toBe(host === 'devtools');
      await expect(provider.invoke(increaseCounterAction, { amount: 3 })).resolves.toBe(3);
      await expect(binding.api.read({})).resolves.toBe(3);
      expect(hub?.commands.commands.has('example:read-server-counter')).toBe(true);
      const response = await connectionMetadata(current.server, host);
      expect(response.status).toBe(200);
      await current.server.close();
      expect(hub?.commands.commands.has('example:read-server-counter')).toBe(false);
      expect(admitted(provider.startup.services[0]).snapshot().status).toBe('disposed');
    } finally {
      await current.close();
    }
  });

  it('awaits old cleanup before completing restart and gives the replacement a fresh incarnation', async () => {
    expect.assertions(10);
    const current = await fixture(host);
    const cleanupEntered = Promise.withResolvers<void>();
    const cleanupRelease = Promise.withResolvers<void>();
    let restarting: Promise<boolean> | undefined;
    try {
      await current.server.listen();
      const previous = await providerFromVite(current.server);
      const service = admitted(
        await previous.services.replace(
          admitted(previous.startup.services[0]),
          defineService(counterCapability, {
            id: 'example.delayed-counter',
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
      const oldBinding = await bindingFor(previous);
      const oldHub = oldBinding.native.get(devframeHubContext);
      await expect(previous.invoke(increaseCounterAction, { amount: 7 })).resolves.toBe(7);
      let restartSettled = false;
      restarting = current.server.restart().then(() => {
        restartSettled = true;
        return restartSettled;
      });
      await cleanupEntered.promise;
      expect(restartSettled).toBe(false);
      expect(current.server.httpServer?.listening).toBe(false);
      expect(service.snapshot().status).toBe('disposing');
      cleanupRelease.resolve();
      await restarting;
      const replacement = await providerFromVite(current.server);
      expect(replacement.provider.id).toBe(previous.provider.id);
      expect(replacement.provider.incarnation).not.toBe(previous.provider.incarnation);
      expect(service.snapshot().status).toBe('disposed');
      expect(oldHub?.commands.commands.has('example:read-server-counter')).toBe(false);
      await expect(oldBinding.api.read({})).rejects.toThrow('Contribution is unavailable');
      await expect(replacement.invoke(increaseCounterAction, { amount: 2 })).resolves.toBe(2);
    } finally {
      cleanupRelease.resolve();
      await restarting;
      await current.close();
    }
  });

  it('propagates failed contribution cleanup through Vite close and retains failure status', async () => {
    expect.assertions(4);
    const current = await fixture(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await current.server.listen();
      const provider = await providerFromVite(current.server);
      const service = admitted(
        await provider.services.replace(
          admitted(provider.startup.services[0]),
          defineService(counterCapability, {
            id: 'example.failed-cleanup',
            execution: serverExecution,
            setup(context) {
              context.scope.onDispose(() => {
                throw new Error('Native cleanup sentinel');
              });
              return counterService.setup(context);
            },
          }),
        ),
      );
      await expect(current.server.close()).rejects.toThrow('Provider cleanup is blocked');
      expect(service.snapshot().status).toBe('cleanup-blocked');
      expect(current.server.httpServer?.listening).toBe(false);
      expect(errors).toHaveBeenCalled();
    } finally {
      try {
        await current.close();
      } catch {
        /* The cached cleanup rejection is intentional. */
      }
      errors.mockRestore();
    }
  });

  it('can close before listening without activating contributions', async () => {
    expect.assertions(1);
    const current = await fixture(host);
    try {
      const ready = providerFromVite(current.server);
      await current.server.close();
      await expect(ready).rejects.toThrow('Vite closed before provider activation');
    } finally {
      await current.close();
    }
  });

  it('uses Vite config watching to replace the backend without a custom supervisor', async () => {
    expect.assertions(4);
    const current = await fixture(host, true);
    try {
      await current.server.listen();
      const previous = await providerFromVite(current.server);
      const previousConfig = current.server.config;
      await vi.waitUntil(() =>
        Object.hasOwn(current.server.watcher.getWatched(), current.directory),
      );
      await current.changeConfig();
      await vi.waitUntil(() => current.server.config !== previousConfig);
      const replacement = await providerFromVite(current.server);
      expect(replacement.provider.id).toBe(previous.provider.id);
      expect(replacement.provider.incarnation).not.toBe(previous.provider.incarnation);
      expect(admitted(previous.startup.services[0]).snapshot().status).toBe('disposed');
      await expect(replacement.invoke(increaseCounterAction, { amount: 5 })).resolves.toBe(5);
    } finally {
      await current.close();
    }
  });

  it('retains the backend when Vite invalidates an ordinary client module', async () => {
    expect.assertions(4);
    const current = await fixture(host, true);
    try {
      await current.server.listen();
      const previous = await providerFromVite(current.server);
      await expect(previous.invoke(increaseCounterAction, { amount: 6 })).resolves.toBe(6);
      expect((await current.server.transformRequest('/client.js'))?.code).toContain('value = 1');
      await vi.waitUntil(() =>
        Object.hasOwn(current.server.watcher.getWatched(), current.directory),
      );
      await current.changeClient();
      await vi.waitUntil(async () =>
        (await current.server.transformRequest('/client.js'))?.code.includes('value = 2'),
      );
      const currentProvider = await providerFromVite(current.server);
      expect(currentProvider.provider).toEqual(previous.provider);
      const currentBinding = await bindingFor(currentProvider);
      await expect(currentBinding.api.read({})).resolves.toBe(6);
    } finally {
      await current.close();
    }
  });
});
