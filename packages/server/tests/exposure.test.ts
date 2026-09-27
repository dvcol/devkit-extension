import { describe, expect, it } from 'vitest';

import { invokeExposed } from './exposure-fixtures.js';

import { createDevframeProvider, createDevToolsProvider } from '../src/index.js';

import {
  admitted,
  counterCapability,
  counterPlugin,
  counterService,
  incrementAction,
} from './fixtures.js';
import { createDevframeHost, createDevToolsHost } from './host-fixtures.js';

const actionMethod = 'devkit:["example.remote","action","example.increment",1]';
const capabilityMethod = 'devkit:["example.remote","capability","example.counter",1,"increment"]';
const composition = {
  providerId: 'example.remote',
  services: [counterService],
  plugins: [counterPlugin],
  expose: { actions: [incrementAction], capabilities: [counterCapability] },
};

describe('host-owned native exposure', () => {
  it('starts services, plugins and exposed schemas in one native host call', async () => {
    expect.assertions(8);
    const host = await createDevframeHost();
    const provider = await createDevframeProvider({ context: host.context, ...composition });
    const incarnation = provider.provider.incarnation;
    const action = host.context.rpc.get(actionMethod);
    expect(action?.args).toEqual([expect.anything(), incrementAction.operation.input]);
    expect(action?.returns).toBe(incrementAction.operation.output);
    expect(host.context.rpc.get(capabilityMethod)?.returns).toBe(
      counterCapability.operations.increment.output,
    );
    await expect(invokeExposed(host.context, actionMethod, incarnation, 3)).resolves.toBe(3);
    await expect(invokeExposed(host.context, capabilityMethod, incarnation, 2)).resolves.toBe(5);
    await expect(invokeExposed(host.context, actionMethod, 123, 10)).rejects.toThrow(
      /incarnation/u,
    );
    await expect(invokeExposed(host.context, actionMethod, incarnation, 'invalid')).rejects.toThrow(
      /invalid/iu,
    );
    expect(admitted(provider.startup.plugins[0]).snapshot().status).toBe('ready');
    await provider.dispose();
  });

  it('keeps methods while implementation availability changes and reuses them on replacement', async () => {
    expect.assertions(10);
    const host = await createDevToolsHost();
    const provider = await createDevToolsProvider({ context: host.context, ...composition });
    const incarnation = provider.provider.incarnation;
    const definition = host.context.rpc.get(actionMethod);
    const plugin = admitted(provider.startup.plugins[0]);
    await plugin.disable();
    await expect(invokeExposed(host.context, actionMethod, incarnation, 1)).rejects.toThrow(
      /unavailable/u,
    );
    await plugin.enable();
    await expect(invokeExposed(host.context, actionMethod, incarnation, 3)).resolves.toBe(3);
    await plugin.dispose();
    await expect(invokeExposed(host.context, actionMethod, incarnation, 1)).rejects.toThrow(
      /unavailable/u,
    );
    const replacementPlugin = await provider.plugins.install(counterPlugin);
    expect(replacementPlugin.snapshot().status).toBe('ready');
    await provider.dispose();
    await expect(invokeExposed(host.context, capabilityMethod, incarnation, 1)).rejects.toThrow(
      /unavailable/u,
    );
    const successor = await createDevToolsProvider({ context: host.context, ...composition });
    expect(host.context.rpc.get(actionMethod)).toBe(definition);
    expect(host.context.rpc.list().filter((name) => name.startsWith('devkit:'))).toHaveLength(2);
    await expect(invokeExposed(host.context, actionMethod, incarnation, 100)).rejects.toThrow(
      /incarnation changed/u,
    );
    await expect(
      invokeExposed(host.context, actionMethod, successor.provider.incarnation, 4),
    ).resolves.toBe(7);
    await provider.dispose();
    await expect(
      invokeExposed(host.context, capabilityMethod, successor.provider.incarnation, 1),
    ).resolves.toBe(8);
    await successor.dispose();
  });

  it('does not publish unlisted contracts or reactivate exposure when omitted on replacement', async () => {
    expect.assertions(4);
    const host = await createDevframeHost();
    const local = await createDevframeProvider({
      context: host.context,
      providerId: composition.providerId,
      plugins: [counterPlugin],
    });
    expect(host.context.rpc.has(actionMethod)).toBe(false);
    await local.dispose();
    const exposed = await createDevframeProvider({
      context: host.context,
      ...composition,
      expose: { actions: [incrementAction] },
    });
    expect(host.context.rpc.has(capabilityMethod)).toBe(false);
    await exposed.dispose();
    const replacement = await createDevframeProvider({
      context: host.context,
      providerId: composition.providerId,
      services: composition.services,
      plugins: composition.plugins,
    });
    await expect(
      invokeExposed(host.context, actionMethod, replacement.provider.incarnation, 1),
    ).rejects.toThrow(/unavailable/u);
    await expect(replacement.invoke({ action: incrementAction, input: 2 })).resolves.toBe(2);
    await replacement.dispose();
  });

  it('keeps declared methods unavailable until their implementations are installed', async () => {
    expect.assertions(3);
    const host = await createDevframeHost();
    const provider = await createDevframeProvider({
      context: host.context,
      providerId: composition.providerId,
      expose: composition.expose,
    });
    await expect(
      invokeExposed(host.context, actionMethod, provider.provider.incarnation, 1),
    ).rejects.toThrow(/unavailable/u);
    await provider.services.install(counterService);
    await provider.plugins.install(counterPlugin);
    await expect(
      invokeExposed(host.context, actionMethod, provider.provider.incarnation, 1),
    ).resolves.toBe(1);
    expect(host.context.rpc.list().filter((name) => name.startsWith('devkit:'))).toHaveLength(2);
    await provider.dispose();
  });
});
