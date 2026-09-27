import { describe, expect, it, vi } from 'vitest';
import { getRpcHandler } from 'devframe/rpc';
import type { DevframeRpcClient } from 'devframe/client';
import { createDevframeProviderConnection } from '../src/client/index.js';
import * as nativeCalls from '../src/client/native-call.js';
import { catalogChanged, catalogMethod } from '../src/rpc-contract.js';
import { admitted, counterCapability, deferred, incrementAction } from './fixtures.js';
import { invokeExposed } from './exposure-fixtures.js';
import { ownCleanup, remoteComposition, remoteHost } from './remote-fixtures.js';

describe('authoritative native catalog synchronization', () => {
  it('projects only exposed contracts and never stores its catalog in client-writable shared state', async () => {
    expect.assertions(3);
    const host = await remoteHost({ ...remoteComposition, expose: { actions: [incrementAction] } });
    const rpc = await host.connect();
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      connection.dispose();
    });
    expect(connection.catalog.snapshot()?.capabilities).toEqual([]);
    expect(connection.catalog.snapshot()?.actions.map(({ id }) => id)).toEqual([
      incrementAction.id,
    ]);
    await expect(connection.resolve({ capability: counterCapability })).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'unsupported',
    });
  });

  it('rereads after invalidation during an outstanding query instead of publishing stale availability', async () => {
    expect.assertions(3);
    const host = await remoteHost();
    const rpc = await host.connect();
    const stale = await invokeExposed(host.context, catalogMethod('example.remote'));
    const held = deferred();
    const calls = vi
      .spyOn(nativeCalls, 'nativeCall')
      .mockReturnValueOnce(held.promise.then(() => stale));
    const pending = createDevframeProviderConnection({ rpc, providerId: 'example.remote' });
    await admitted(host.provider.startup.services[0]).disable();
    await notifyCatalog(rpc);
    held.resolve();
    const connection = await pending;
    ownCleanup(() => {
      connection.dispose();
    });
    expect(calls.mock.calls.length).toBeGreaterThan(1);
    expect(connection.catalog.snapshot()?.capabilities[0]?.status).toBe('disabled');
    await expect(connection.invoke({ action: incrementAction, input: 10 })).rejects.toThrow(
      /unavailable/u,
    );
  });

  it('rejects malformed or mismatched catalog metadata before attachment', async () => {
    expect.assertions(2);
    const host = await remoteHost();
    const rpc = await host.connect();
    const calls = vi.spyOn(nativeCalls, 'nativeCall');
    calls.mockResolvedValueOnce({ provider: { id: 'forged' } });
    await expect(
      createDevframeProviderConnection({ rpc, providerId: 'example.remote' }),
    ).rejects.toThrow(/invalid|expected/iu);
    const catalog = host.provider.catalog.snapshot();
    calls.mockResolvedValueOnce({ ...catalog, provider: { ...catalog.provider, id: 'forged' } });
    await expect(
      createDevframeProviderConnection({ rpc, providerId: 'example.remote' }),
    ).rejects.toThrow(/different provider/u);
  });

  it('cancels startup and ignores its late native response', async () => {
    expect.assertions(3);
    const host = await remoteHost();
    const rpc = await host.connect();
    const held = deferred();
    const calls = vi
      .spyOn(nativeCalls, 'nativeCall')
      .mockReturnValueOnce(held.promise.then(() => host.provider.catalog.snapshot()));
    const cancellation = new AbortController();
    const pending = createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
      signal: cancellation.signal,
    });
    cancellation.abort();
    await expect(pending).rejects.toThrow(/abort/iu);
    held.resolve();
    await held.promise;
    const connection = await createDevframeProviderConnection({
      rpc,
      providerId: 'example.remote',
    });
    ownCleanup(() => {
      connection.dispose();
    });
    expect(connection.catalog.snapshot()?.status).toBe('open');
    expect(calls).toHaveBeenCalledTimes(2);
  });
});

async function notifyCatalog(rpc: DevframeRpcClient): Promise<void> {
  const definition = rpc.client.definitions.get(catalogChanged);
  if (definition === undefined) throw new Error('Catalog notification is missing');
  const handler = await getRpcHandler(definition, { rpc });
  await handler();
}
