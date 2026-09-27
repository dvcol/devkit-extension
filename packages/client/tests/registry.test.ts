import { describe, expect, it, vi } from 'vitest';
import { action, backend, client } from './fixtures.js';
import { createClient } from '../src/index.js';
import type { ConnectionSnapshot, ProviderConnection } from '../src/index.js';
import type { ProviderCatalogSnapshot } from '@devkit/core';

describe('client connection ownership', () => {
  it('rejects a catalog that changes identity without a new attachment', async () => {
    expect.assertions(2);
    const first = await backend({ id: 'A' });
    const snapshot = first.runtime.catalog.snapshot();
    const readSnapshot = vi.fn<() => ProviderCatalogSnapshot>(() => snapshot);
    const connection = {
      ...first.connection,
      catalog: { ...first.connection.catalog, snapshot: readSnapshot },
    };
    const instance = client({ connections: [connection] });
    readSnapshot.mockReturnValue({
      ...snapshot,
      provider: { ...snapshot.provider, incarnation: 'unannounced-successor' },
    });
    await expect(instance.actions.invoke({ action, input: 'invalid' })).rejects.toMatchObject({
      code: 'invalid-connection',
    });
    expect(first.calls).toEqual([]);
  });

  it('rejects duplicate logical providers, including the same instance, without replacing their owner', async () => {
    expect.assertions(4);
    const first = await backend({ id: 'A' });
    const duplicate = await backend({ id: 'A', incarnation: 'other' });
    const instance = client({ connections: [first.connection] });
    expect(() => instance.providers.attach({ connection: first.connection })).toThrow(
      'already attached',
    );
    expect(() => instance.providers.attach({ connection: duplicate.connection })).toThrow(
      'already attached',
    );
    await expect(instance.actions.invoke({ action, input: 'owner' })).resolves.toBe('A:owner');
    expect(duplicate.calls).toEqual([]);
  });

  it('keeps identical provider IDs distinct across realms and fences stale attachment handles', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'shared' });
    const second = await backend({ id: 'shared', realm: 'webext' });
    const instance = client({ connections: [second.connection] });
    const old = instance.providers.attach({ connection: first.connection });
    expect(instance.providers.snapshot()).toHaveLength(2);
    old.detach();
    instance.providers.attach({ connection: first.connection });
    old.detach();
    expect(instance.providers.snapshot()).toHaveLength(2);
    await expect(
      instance.actions.invoke({
        action,
        input: 'web',
        routing: { realm: 'webext', provider: 'shared' },
      }),
    ).resolves.toBe('shared:web');
  });

  it('does not confuse an unknown catalog with authoritative absence or wait for it', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const second = await backend({ id: 'B', realm: 'webext' });
    const unknown: ProviderConnection = {
      ...first.connection,
      catalog: { snapshot: vi.fn<() => undefined>(), subscribe: () => () => {} },
    };
    const instance = client({ connections: [unknown, second.connection] });
    expect(instance.providers.snapshot()[0]?.status).toBe('unknown');
    await expect(
      instance.actions.invoke({
        action,
        input: 'fallback',
        routing: [{ realm: 'devserver' }, { realm: 'webext' }],
      }),
    ).resolves.toBe('B:fallback');
    expect(first.calls).toEqual([]);
  });

  it('isolates listener failures and unsubscribes connection observers on detach', async () => {
    expect.assertions(5);
    const first = await backend({ id: 'A' });
    const report = vi.fn<() => void>();
    const instance = client({ report });
    const stopBroken = instance.providers.subscribe(() => {
      throw new Error('observer failed');
    });
    const listener = vi.fn<(snapshot: readonly ConnectionSnapshot[]) => void>();
    const stop = instance.providers.subscribe(listener);
    const attachment = instance.providers.attach({ connection: first.connection });
    expect(report).toHaveBeenCalled();
    expect(listener.mock.lastCall?.[0]).toHaveLength(1);
    stopBroken();
    attachment.detach();
    expect(listener.mock.lastCall?.[0]).toEqual([]);
    const count = listener.mock.calls.length;
    await first.service.disable();
    expect(listener).toHaveBeenCalledTimes(count);
    stop();
    instance.dispose();
    expect(instance.providers.snapshot()).toEqual([]);
  });

  it('rolls back constructor attachments when initial composition contains a duplicate', async () => {
    expect.assertions(2);
    const first = await backend({ id: 'A' });
    expect(() => createClient({ connections: [first.connection, first.connection] })).toThrow(
      'already attached',
    );
    await expect(first.runtime.invoke({ action, input: 'alive' })).resolves.toBe('A:alive');
  });
});
