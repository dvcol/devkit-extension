import { defineNativeContext, defineService } from '@devkit/core';
import type { RuntimeDiagnostic } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import {
  devframeContext,
  devframeHubContext,
  devToolsContext,
  installDevframeProvider,
  installDevToolsProvider,
  serverExecution,
} from '../src/index.js';

import {
  admitted,
  available,
  counterCapability,
  counterPlugin,
  counterService,
  incrementAction,
  localContext,
  requireHub,
} from './fixtures.js';
import { createDevframeHost, createDevToolsHost } from './host-fixtures.js';

const unknownContext = defineNativeContext<{ readonly missing: true }>({ id: 'example.absent' });

describe('local server provider integration', () => {
  it('uses real hub state and cleans only owned registrations', async () => {
    expect.assertions(17);
    const host = await createDevframeHost();
    const closeHub = vi.spyOn(host.hub, 'close');
    const closeHttp = vi.spyOn(host.httpServer, 'close');
    const unrelatedCommand = host.context.commands.register({
      id: 'example:unrelated',
      title: 'Unrelated command',
      handler: () => 'still-owned',
    });
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.server',
      services: [counterService],
      plugins: [counterPlugin],
    });
    expect(provider.provider).toMatchObject({ id: 'example.server', realm: { id: 'devserver' } });
    expect(provider.provider.incarnation).toMatch(/^[\da-f-]{36}$/u);
    expect(admitted(provider.startup.services[0]).snapshot().status).toBe('ready');
    expect(admitted(provider.startup.plugins[0]).snapshot().status).toBe('ready');
    await expect(provider.invoke(incrementAction, 3)).resolves.toBe(3);
    const binding = available(await provider.resolve(counterCapability));
    expect(binding.context.access).toBe('local');
    const context = localContext(binding.context);
    expect(context.native.get(devframeContext)).toBe(host.context);
    expect(context.native.get(devframeHubContext)).toBe(host.context);
    expect(context.native.get(devToolsContext)).toBeUndefined();
    expect(context.native.get(unknownContext)).toBeUndefined();
    await expect(host.context.commands.execute('example:counter')).resolves.toBe(3);
    const nativeState = await host.context.rpc.sharedState.get<{ value: number }>(
      'example:counter',
      { initialValue: { value: 0 } },
    );
    await provider.dispose();
    expect(nativeState.value().value).toBe(3);
    nativeState.mutate((current) => {
      current.value += 1;
    });
    expect(nativeState.value().value).toBe(4);
    expect(closeHub).not.toHaveBeenCalled();
    expect(closeHttp).not.toHaveBeenCalled();
    expect(host.context.commands.commands.has('example:counter')).toBe(false);
    await expect(host.context.commands.execute(unrelatedCommand.id)).resolves.toBe('still-owned');
  });

  it('exposes the actual layered kit context without inventing a Vite server', async () => {
    expect.assertions(8);
    const host = await createDevToolsHost();
    const provider = await installDevToolsProvider(host.context, {
      providerId: 'example.kit',
      services: [counterService],
      plugins: [counterPlugin],
    });
    const binding = available(await provider.resolve(counterCapability));
    const context = localContext(binding.context);
    expect(context.native.get(devToolsContext)).toBe(host.context);
    expect(context.native.get(devframeHubContext)).toBe(host.context);
    expect(context.native.get(devframeContext)).toBe(host.context);
    expect(host.context.viteServer).toBeUndefined();
    expect(typeof host.context.createJsonRenderer).toBe('function');
    expect(binding.context.execution).toEqual(serverExecution);
    expect(binding.context.provider).toEqual(provider.provider);
    await expect(provider.invoke(incrementAction, 4)).resolves.toBe(4);
    await provider.dispose();
  });

  it('activates waiting actions after dynamic service admission and delegates replacement', async () => {
    expect.assertions(10);
    const host = await createDevframeHost();
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.dynamic',
      plugins: [counterPlugin],
    });
    const plugin = admitted(provider.startup.plugins[0]);
    expect(plugin.snapshot().contributions[0]?.status).toBe('waiting');
    await expect(provider.invoke(incrementAction, 2)).rejects.toMatchObject({
      code: 'unavailable-capability',
    });
    const service = admitted(await provider.services.install(counterService));
    expect(plugin.snapshot().status).toBe('ready');
    await expect(provider.invoke(incrementAction, 2)).resolves.toBe(2);
    await service.disable();
    expect(host.context.commands.commands.has('example:counter')).toBe(false);
    expect(plugin.snapshot().contributions[0]?.status).toBe('waiting');
    await service.enable();
    const replacement = admitted(await provider.services.replace(service, counterService));
    expect(replacement.snapshot().status).toBe('ready');
    const newPlugin = admitted(await provider.plugins.replace(plugin, counterPlugin));
    expect(newPlugin.snapshot().status).toBe('ready');
    await expect(provider.invoke(incrementAction, 3)).resolves.toBe(5);
    await newPlugin.dispose();
    expect(admitted(await provider.plugins.install(counterPlugin)).snapshot().status).toBe('ready');
    await provider.dispose();
  });

  it('retains a failed setup handle and its cleanup ownership with local diagnostic causes', async () => {
    expect.assertions(5);
    const host = await createDevframeHost();
    const failure = new Error('native setup failure');
    const report = vi.fn<(diagnostic: RuntimeDiagnostic, cause?: unknown) => void>();
    const service = defineService(counterCapability, {
      id: 'example.failure',
      execution: serverExecution,
      setup({ native, scope }) {
        const context = requireHub(native);
        const command = context.commands.register({ id: 'example:failed', title: 'Failed setup' });
        scope.onDispose(() => {
          command.unregister();
        });
        throw failure;
      },
    });
    const provider = await installDevframeProvider(host.context, {
      providerId: 'example.failure',
      services: [service],
      report,
    });
    const installation = admitted(provider.startup.services[0]);
    expect(installation.snapshot().status).toBe('partial');
    expect(installation.snapshot().contributions[0]?.status).toBe('failed');
    expect(host.context.commands.commands.has('example:failed')).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'setup-failure' }),
      failure,
    );
    await provider.dispose();
    expect(installation.snapshot().status).toBe('disposed');
  });
});
