import { defineAction, definePlugin, defineService, defineView } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { action, capability, deferred, execution, provider } from './provider-fixtures.js';

describe('provider view lifecycle', () => {
  it('waits for requirements and cleans up before dependency loss while preserving explicit disable', async () => {
    expect.assertions(11);
    const { runtime } = provider();
    const events: string[] = [];
    const view = defineView({
      id: 'view',
      execution,
      requires: { source: capability },
      async setup({ services, scope }) {
        const value = await services.source.api.echo('ready');
        events.push(`view:${value}`);
        scope.onDispose(() => {
          events.push(`view-disposed:${scope.signal.aborted}`);
        });
      },
    });
    const plugin = await runtime.plugins.install(definePlugin({ id: 'plugin', views: [view] }));
    expect(plugin.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'dependency-unavailable',
      generation: 0,
    });
    expect(events).toEqual([]);
    const source = await runtime.services.install(
      defineService({
        id: 'source',
        capability,
        execution,
        setup({ scope }) {
          scope.onDispose(() => {
            events.push('service-disposed');
          });
          return { echo: (value) => value };
        },
      }),
    );
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 1 });
    expect(events).toEqual(['view:ready']);
    await source.disable();
    expect(events).toEqual(['view:ready', 'view-disposed:true', 'service-disposed']);
    expect(plugin.snapshot().contributions[0]?.status).toBe('waiting');
    await source.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 2 });
    await plugin.disable();
    await source.disable();
    await source.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'disabled', generation: 2 });
    await plugin.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 3 });
    await runtime.dispose();
    expect(plugin.snapshot().status).toBe('disposed');
    expect(events).toEqual([
      'view:ready',
      'view-disposed:true',
      'service-disposed',
      'view:ready',
      'view-disposed:true',
      'service-disposed',
      'view:ready',
      'view-disposed:true',
      'service-disposed',
    ]);
  });

  it('cleans partial setup and leaves siblings usable until an explicit view retry', async () => {
    expect.assertions(8);
    const { runtime, diagnostics } = provider();
    const cleanup = vi.fn<() => void>();
    const publish = vi.fn<() => void>().mockImplementationOnce(() => {
      throw new Error('native publication failed');
    });
    const view = defineView({
      id: 'view',
      execution,
      setup({ scope }) {
        scope.onDispose(cleanup);
        publish();
      },
    });
    const handle = await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        views: [view],
        actions: [
          defineAction({
            id: 'action',
            contract: action,
            execution,
            handler: ({ input }) => input,
          }),
        ],
      }),
    );
    expect(handle.snapshot().contributions.find((item) => item.id === 'view')?.status).toBe(
      'failed',
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'setup-failure', contributionId: 'view' }),
    );
    await expect(runtime.invoke({ action, input: 'sibling' })).resolves.toBe('sibling');
    await handle.disable();
    await handle.enable();
    expect(publish).toHaveBeenCalledTimes(1);
    await handle.retry('view');
    expect(publish).toHaveBeenCalledTimes(2);
    expect(handle.snapshot().status).toBe('ready');
    await runtime.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('waits for native view cleanup before activating a replacement', async () => {
    expect.assertions(6);
    const { runtime } = provider();
    const cleaning = deferred<void>();
    const released = deferred<void>();
    const old = await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        views: [
          defineView({
            id: 'view',
            execution,
            setup({ scope }) {
              scope.onDispose(() => {
                cleaning.resolve();
                return released.promise;
              });
            },
          }),
        ],
      }),
    );
    const setup = vi.fn<() => void>();
    const successor = definePlugin({
      id: 'plugin',
      views: [defineView({ id: 'view', execution, setup })],
    });
    const replacing = runtime.plugins.replace(old, successor);
    await cleaning.promise;
    expect(old.snapshot().status).toBe('disposing');
    expect(setup).not.toHaveBeenCalled();
    await expect(runtime.plugins.install(successor)).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    released.resolve();
    const current = await replacing;
    expect(old.snapshot().status).toBe('disposed');
    expect(current.snapshot().status).toBe('ready');
    expect(setup).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it('retains reservations and blocks replacement when native view cleanup fails', async () => {
    expect.assertions(7);
    const { runtime } = provider();
    const cleanup = vi.fn<() => void>(() => {
      throw new Error('native resource still owned');
    });
    const old = await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        views: [
          defineView({
            id: 'view',
            execution,
            setup: ({ scope }) => {
              scope.onDispose(cleanup);
            },
          }),
        ],
      }),
    );
    const setup = vi.fn<() => void>();
    const successor = definePlugin({
      id: 'plugin',
      views: [defineView({ id: 'view', execution, setup })],
    });
    await expect(runtime.plugins.replace(old, successor)).rejects.toMatchObject({
      code: 'cleanup-failure',
    });
    expect(old.snapshot().status).toBe('cleanup-blocked');
    expect(setup).not.toHaveBeenCalled();
    await expect(old.dispose()).rejects.toMatchObject({ code: 'cleanup-failure' });
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(runtime.plugins.install(successor)).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup-failure' });
  });

  it('does not adopt a resource returned by structural JavaScript setup', async () => {
    expect.assertions(2);
    const { runtime } = provider();
    const dispose = vi.fn<() => void>();
    const scoped = vi.fn<() => void>();
    const view = {
      kind: 'view' as const,
      id: 'view',
      execution,
      requires: {},
      setup(context: { readonly scope: { onDispose(cleanup: () => void): void } }) {
        context.scope.onDispose(scoped);
        return { dispose };
      },
    };
    await runtime.plugins.install(definePlugin({ id: 'plugin', views: [view] }));
    await runtime.dispose();
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });
});
