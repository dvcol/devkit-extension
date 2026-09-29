import { createClient } from '@devkit/client';
import { describe, expect, it, vi } from 'vitest';
import { createDevframeProviderConnection } from '../src/client/index.js';
import { createDevframeProvider } from '../src/index.js';
import { catalogMethod } from './exposure-fixtures.js';
import { counterCapability, incrementAction, available, admitted } from './fixtures.js';
import { ownCleanup, remoteComposition, remoteHost } from './remote-fixtures.js';

describe('native remote provider connection', () => {
  it('routes typed actions and capabilities through authenticated native RPC and follows availability', async () => {
    expect.assertions(9);
    const host = await remoteHost();
    const rpc = await host.connect();
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      connection.dispose();
    });
    const client = createClient({ connections: [connection] });
    ownCleanup(() => {
      client.dispose();
    });
    expect(connection.provider).toEqual(host.provider.provider);
    await expect(client.actions.invoke({ action: incrementAction, input: 2 })).resolves.toBe(2);
    const binding = available(await client.capabilities.resolve({ capability: counterCapability }));
    expect(binding.context.access).toBe('remote');
    expect('native' in binding.context).toBe(false);
    await expect(binding.api.increment(3)).resolves.toBe(5);
    const service = admitted(host.provider.startup.services[0]);
    await service.disable();
    await vi.waitUntil(() => connection.catalog.snapshot()?.capabilities[0]?.status === 'disabled');
    expect(connection.catalog.snapshot()?.capabilities[0]?.status).toBe('disabled');
    await expect(binding.api.increment(10)).rejects.toThrow(/unavailable/u);
    await service.enable();
    await vi.waitUntil(() => connection.catalog.snapshot()?.capabilities[0]?.status === 'active');
    expect(connection.catalog.snapshot()?.capabilities[0]?.status).toBe('active');
    await expect(binding.api.increment(1)).resolves.toBe(6);
  });

  it('rejects unauthorized catalog reads without publishing provider identity', async () => {
    expect.assertions(2);
    const host = await remoteHost();
    const rpc = await host.connect('invalid-token');
    await expect(
      createDevframeProviderConnection({ rpc, providerId: 'example.remote' }),
    ).rejects.toThrow(/authoriz|trust|credentials/u);
    expect(rpc.client.definitions.has('devkit:catalog:changed')).toBe(true);
  });

  it('invalidates old connections on replacement and reuses the native client without accumulating methods', async () => {
    expect.assertions(6);
    const host = await remoteHost();
    const rpc = await host.connect();
    const report = vi.fn<(error: Error) => void>();
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
      report,
    });
    ownCleanup(() => {
      connection.dispose();
    });
    const count = rpc.client.definitions.size;
    const binding = available(await connection.resolve({ capability: counterCapability }));
    await host.provider.dispose();
    const successor = await createDevframeProvider({ context: host.context, ...remoteComposition });
    ownCleanup(() => successor.dispose());
    await vi.waitUntil(() => report.mock.calls.length > 0);
    expect(report).toHaveBeenCalled();
    expect(connection.catalog.snapshot()).toBeUndefined();
    await expect(binding.api.increment(10)).rejects.toThrow(/unavailable|incarnation/u);
    const replacement = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      replacement.dispose();
    });
    expect(replacement.provider.incarnation).toBe(successor.provider.incarnation);
    expect(rpc.client.definitions.size).toBe(count);
    await expect(replacement.invoke({ action: incrementAction, input: 1 })).resolves.toBe(1);
  });

  it('disposes only adapter subscriptions and rejects native method caching', async () => {
    expect.assertions(6);
    const host = await remoteHost();
    const rpc = await host.connect();
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    connection.dispose();
    expect(connection.catalog.snapshot()).toBeUndefined();
    expect(rpc.status).toBe('connected');
    await expect(host.provider.invoke({ action: incrementAction, input: 1 })).resolves.toBe(1);
    vi.spyOn(rpc.cacheManager, 'validate').mockImplementation(
      (method) => method === catalogMethod('example.remote'),
    );
    await expect(
      createDevframeProviderConnection({ rpc, providerId: 'example.remote' }),
    ).rejects.toThrow(/caching/u);
    vi.restoreAllMocks();
    const replacement = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      replacement.dispose();
    });
    vi.spyOn(rpc.cacheManager, 'validate').mockReturnValue(true);
    await expect(replacement.invoke({ action: incrementAction, input: 10 })).rejects.toThrow(
      /caching/u,
    );
    await expect(host.provider.invoke({ action: incrementAction, input: 1 })).resolves.toBe(2);
  });

  it('rejects static transports before registering client notifications', async () => {
    expect.assertions(2);
    const host = await remoteHost();
    const rpc = await host.connect();
    vi.spyOn(rpc, 'transport', 'get').mockReturnValue('static');
    await expect(
      createDevframeProviderConnection({ rpc, providerId: 'example.remote' }),
    ).rejects.toThrow(/live native connection/u);
    expect(rpc.client.definitions.has('devkit:catalog:changed')).toBe(false);
  });
});
