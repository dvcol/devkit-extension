import { defineAction, defineCapability, definePlugin, defineService } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import {
  action,
  admitted,
  available,
  capability,
  echoService,
  execution,
  operation,
  provider,
} from './provider-fixtures.js';

describe('provider lifecycle composition', () => {
  it('reports the native setup cause locally without copying it into portable snapshots', async () => {
    expect.assertions(4);
    const failure = new Error('native setup detail');
    const report = vi.fn<(diagnostic: unknown, cause?: unknown) => void>();
    const { runtime } = provider({ report });
    const handle = admitted(
      await runtime.services.install(
        defineService({
          capability: capability,
          id: 'failed',
          execution,
          setup() {
            throw failure;
          },
        }),
      ),
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'setup-failure' }),
      failure,
    );
    expect(handle.snapshot().contributions[0]?.status).toBe('failed');
    expect(handle.snapshot().diagnostics[0]).not.toHaveProperty('cause');
    expect(JSON.stringify(handle.snapshot())).not.toContain('native setup detail');
    await runtime.dispose();
  });

  it('activates dependencies in order and exposes local bindings and action calls', async () => {
    expect.assertions(7);
    const { runtime } = provider();
    const starts: string[] = [];
    const other = defineCapability({
      id: 'example.other',
      version: 1,
      operations: { echo: operation },
    });
    const dependent = defineService({
      capability: other,
      id: 'dependent',
      execution,
      requires: { source: capability },
      setup({ services }) {
        starts.push('dependent');
        return { echo: (value) => services.source.api.echo(value) };
      },
    });
    const source = defineService({
      capability: capability,
      id: 'source',
      execution,
      setup() {
        starts.push('source');
        return { echo: (value) => value };
      },
    });
    const contribution = defineAction({
      contract: action,
      id: 'action',
      execution,
      requires: { other },
      handler: ({ input, services }) => services.other.api.echo(input),
    });
    const result = await runtime.startup({
      services: [dependent, source],
      plugins: [definePlugin({ id: 'plugin', actions: [contribution] })],
    });
    expect(starts).toEqual(['source', 'dependent']);
    expect(result.services).toHaveLength(2);
    expect(admitted(result.services[0]).snapshot().status).toBe('ready');
    expect(admitted(result.plugins[0]).snapshot().status).toBe('ready');
    await expect(runtime.invoke({ action: action, input: 'hello' })).resolves.toBe('hello');
    const resolution = await runtime.resolve({ capability: capability });
    expect(resolution.status).toBe('available');
    expect(available(resolution).context).toMatchObject({
      access: 'local',
      provider: {
        id: 'example.provider',
        incarnation: 'example.backend-lifetime',
        realm: { id: 'example.custom-realm' },
      },
      execution,
    });
    await runtime.dispose();
  });

  it('restores waiting dependents automatically but preserves explicit disable', async () => {
    expect.assertions(8);
    const { runtime } = provider();
    const contribution = defineAction({
      contract: action,
      id: 'action',
      execution,
      requires: { source: capability },
      handler: ({ input, services }) => services.source.api.echo(input),
    });
    const plugin = admitted(
      await runtime.plugins.install(definePlugin({ id: 'plugin', actions: [contribution] })),
    );
    expect(plugin.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'dependency-unavailable',
      generation: 0,
    });
    const source = admitted(await runtime.services.install(echoService()));
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 1 });
    await source.disable();
    expect(plugin.snapshot().contributions[0]?.status).toBe('waiting');
    await source.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 2 });
    await plugin.disable();
    await source.disable();
    await source.enable();
    expect(plugin.snapshot().contributions[0]?.status).toBe('disabled');
    await expect(runtime.invoke({ action: action, input: 'hello' })).rejects.toMatchObject({
      code: 'unavailable-capability',
    });
    await plugin.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 3 });
    await expect(runtime.invoke({ action: action, input: 'hello' })).resolves.toBe('hello');
    await runtime.dispose();
  });

  it('isolates setup failure and retries only after an explicit request', async () => {
    expect.assertions(8);
    const { runtime, diagnostics } = provider();
    const setup = vi
      .fn<() => { echo: (value: string) => string }>(() => ({ echo: (value) => value }))
      .mockImplementationOnce(() => {
        throw new Error('temporary failure');
      });
    const failing = defineService({ capability: capability, id: 'failing', execution, setup });
    const independent = defineAction({
      contract: action,
      id: 'independent',
      execution,
      handler: ({ input }) => input,
    });
    const handle = admitted(
      await runtime.plugins.install(
        definePlugin({ id: 'plugin', services: [failing], actions: [independent] }),
      ),
    );
    expect(handle.snapshot().status).toBe('partial');
    expect(handle.snapshot().contributions[0]?.status).toBe('failed');
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'setup-failure', contributionId: 'failing' }),
      ]),
    );
    await expect(runtime.invoke({ action: action, input: 'working' })).resolves.toBe('working');
    await handle.disable();
    await handle.enable();
    expect(setup).toHaveBeenCalledTimes(1);
    await handle.retry('failing');
    expect(setup).toHaveBeenCalledTimes(2);
    expect(handle.snapshot().status).toBe('ready');
    expect(handle.snapshot().diagnostics).toEqual([]);
    await runtime.dispose();
  });

  it('delivers initial snapshots and isolates listener failures and unsubscribe', async () => {
    expect.assertions(6);
    const { runtime, diagnostics } = provider();
    const handle = admitted(await runtime.services.install(echoService()));
    const listener = vi.fn<(snapshot: unknown) => void>();
    const unsubscribe = handle.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const removeBroken = handle.subscribe(() => {
      throw new Error('broken view');
    });
    expect(handle.snapshot().diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'listener-failed' })]),
    );
    removeBroken();
    unsubscribe();
    unsubscribe();
    await handle.disable();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'listener-failed')).toBe(true);
    await handle.dispose();
    expect(handle.snapshot().status).toBe('disposed');
    const lateListener = vi.fn<(snapshot: unknown) => void>();
    handle.subscribe(lateListener)();
    expect(lateListener).toHaveBeenCalledWith(expect.objectContaining({ status: 'disposed' }));
    await runtime.dispose();
  });
});
