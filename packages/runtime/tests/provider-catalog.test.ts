import { defineAction, defineCapability, definePlugin, defineService } from '@devkit/core';
import type { ProviderCatalogSnapshot } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import {
  action,
  admitted,
  capability,
  deferred,
  echoService,
  execution,
  provider,
} from './provider-fixtures.js';

describe('provider catalog', () => {
  it('starts with an authoritative empty snapshot and publishes final disposal', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const listener = vi.fn<(snapshot: ProviderCatalogSnapshot) => void>();
    const unsubscribe = runtime.catalog.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(runtime.catalog.snapshot()).toEqual({
      provider: {
        id: 'example.provider',
        incarnation: 'example.backend-lifetime',
        realm: { id: 'example.custom-realm' },
      },
      status: 'open',
      capabilities: [],
      actions: [],
    });
    const disposal = runtime.dispose();
    expect(runtime.catalog.snapshot().status).toBe('disposing');
    await disposal;
    expect(listener.mock.lastCall?.[0]).toMatchObject({
      status: 'disposed',
      capabilities: [],
      actions: [],
    });
    unsubscribe();
    const closed = vi.fn<(snapshot: ProviderCatalogSnapshot) => void>();
    runtime.catalog.subscribe(closed)();
    expect(closed).toHaveBeenCalledExactlyOnceWith(runtime.catalog.snapshot());
  });

  it('retains exact versions and immutable portable metadata without implementation objects', async () => {
    expect.assertions(9);
    const { runtime } = provider();
    const newer = defineCapability({
      id: capability.id,
      operations: capability.operations,
      version: 2,
    });
    const installed = await runtime.startup({
      services: [
        echoService('original'),
        defineService({
          capability: newer,
          id: 'newer',
          execution,
          setup: () => ({ echo: (value) => value }),
        }),
      ],
      plugins: [
        definePlugin({
          id: 'plugin',
          actions: [
            defineAction({
              contract: action,
              id: 'handler',
              execution,
              handler: ({ input }) => input,
            }),
          ],
          views: [{ id: 'view', kind: 'view', execution }],
        }),
      ],
    });
    const before = runtime.catalog.snapshot();
    expect(before.capabilities).toEqual(
      [
        [1, 'original'],
        [2, 'newer'],
      ].map(([version, contributionId]) => ({
        id: capability.id,
        version,
        contributionId,
        execution,
        status: 'active',
        operations: [{ name: 'echo', target: 'none' }],
      })),
    );
    expect(before.actions).toEqual([
      {
        id: action.id,
        version: 1,
        contributionId: 'handler',
        execution,
        status: 'active',
        target: 'none',
      },
    ]);
    expect(JSON.parse(JSON.stringify(before))).toEqual(before);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.capabilities)).toBe(true);
    expect(Object.isFrozen(before.capabilities[0])).toBe(true);
    expect(Object.isFrozen(before.capabilities[0]?.operations[0])).toBe(true);
    await admitted(installed.services[0]).dispose();
    expect(runtime.catalog.snapshot().capabilities.map((entry) => entry.version)).toEqual([2]);
    expect(before.capabilities.map((entry) => entry.version)).toEqual([1, 2]);
    await runtime.dispose();
  });

  it('publishes dependency loss and restoration while retaining registered contracts', async () => {
    expect.assertions(6);
    const { runtime } = provider();
    await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        actions: [
          defineAction({
            contract: action,
            id: 'handler',
            execution,
            requires: { echo: capability },
            handler: ({ input, services }) => services.echo.api.echo(input),
          }),
        ],
      }),
    );
    const snapshots: ProviderCatalogSnapshot[] = [];
    const unsubscribe = runtime.catalog.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    expect(snapshots.at(-1)?.actions[0]).toMatchObject({
      status: 'waiting',
      reason: 'dependency-unavailable',
    });
    const installation = admitted(await runtime.services.install(echoService()));
    expect(snapshots.at(-1)?.actions[0]?.status).toBe('active');
    await installation.disable();
    expect(snapshots.at(-1)?.capabilities[0]?.status).toBe('disabled');
    expect(snapshots.at(-1)?.actions[0]?.status).toBe('waiting');
    await installation.enable();
    expect(snapshots.at(-1)?.actions[0]?.status).toBe('active');
    unsubscribe();
    const lastSnapshot = snapshots.at(-1);
    await runtime.dispose();
    expect(snapshots.at(-1)).toBe(lastSnapshot);
  });

  it('publishes replacement without advertising both owners and ignores rejected admission', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const original = admitted(await runtime.services.install(echoService('original')));
    const listener = vi.fn<(snapshot: ProviderCatalogSnapshot) => void>();
    runtime.catalog.subscribe(listener);
    await expect(runtime.services.install(echoService('duplicate'))).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    await runtime.services.replace(original, echoService('replacement'));
    expect(listener.mock.calls.every(([snapshot]) => snapshot.capabilities.length <= 1)).toBe(true);
    expect(listener.mock.calls.some(([snapshot]) => snapshot.capabilities.length === 0)).toBe(true);
    expect(runtime.catalog.snapshot().capabilities[0]).toMatchObject({
      contributionId: 'replacement',
      status: 'active',
    });
    await runtime.dispose();
  });

  it('reports subscriber failures without breaking lifecycle updates or sibling subscribers', async () => {
    expect.assertions(4);
    const { runtime, diagnostics } = provider();
    const broken = runtime.catalog.subscribe(() => {
      throw new Error('listener failed');
    });
    const listener = vi.fn<(snapshot: ProviderCatalogSnapshot) => void>();
    runtime.catalog.subscribe(listener);
    await runtime.services.install(echoService());
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'listener-failed')).toBe(true);
    expect(listener.mock.lastCall?.[0].capabilities[0]?.status).toBe('active');
    broken();
    const diagnosticCount = diagnostics.length;
    await runtime.dispose();
    expect(diagnostics).toHaveLength(diagnosticCount);
    expect(listener.mock.lastCall?.[0].status).toBe('disposed');
  });

  it('exposes pending setup and cleanup without claiming active or completed ownership', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const started = deferred<void>();
    const setup = deferred<void>();
    const snapshots: ProviderCatalogSnapshot[] = [];
    runtime.catalog.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const installation = runtime.services.install(
      defineService({
        capability,
        id: 'slow',
        execution,
        async setup({ scope }) {
          started.resolve();
          await setup.promise;
          scope.onDispose(() => {
            throw new Error('cleanup failed');
          });
          return { echo: (value) => value };
        },
      }),
    );
    await started.promise;
    expect(runtime.catalog.snapshot().capabilities[0]?.status).toBe('starting');
    setup.resolve();
    await installation;
    expect(runtime.catalog.snapshot().capabilities[0]?.status).toBe('active');
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup-failure' });
    expect(snapshots.some((snapshot) => snapshot.capabilities[0]?.status === 'stopping')).toBe(
      true,
    );
    expect(snapshots.at(-1)).toMatchObject({
      status: 'cleanup-blocked',
      capabilities: [{ status: 'cleanup-blocked' }],
    });
  });

  it('keeps failed setup visible without advertising it as active', async () => {
    expect.assertions(2);
    const { runtime } = provider();
    await runtime.services.install(
      defineService({
        capability,
        id: 'failed',
        execution,
        setup() {
          throw new Error('setup failed');
        },
      }),
    );
    expect(runtime.catalog.snapshot().capabilities[0]).toMatchObject({
      id: capability.id,
      status: 'failed',
    });
    await runtime.dispose();
    expect(runtime.catalog.snapshot().capabilities).toEqual([]);
  });
});
