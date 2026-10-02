import {
  defineAction,
  defineNativeContext,
  definePlugin,
  defineService,
  defineTransform,
} from '@devkit/core';
import type { NativeContextAccess, SetupContext } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { action, capability, deferred, execution, provider } from './provider-fixtures.js';

describe('provider transform lifecycle', () => {
  it('binds required services and native context only while active and releases before its service', async () => {
    expect.assertions(12);
    const events: string[] = [];
    const nativeContext = defineNativeContext<{ install(value: string): () => void }>({
      id: 'example.native-transform',
    });
    const install = vi.fn<(value: string) => () => void>((value) => {
      events.push(`installed:${value}`);
      return () => {
        events.push('native-released');
      };
    });
    const nativeAccess: NativeContextAccess = { get: vi.fn<() => undefined>() };
    const nativeLookup = vi.spyOn(nativeAccess, 'get').mockReturnValue({ install });
    const { runtime } = provider({ native: nativeAccess });
    const transform = defineTransform({
      id: 'transform',
      execution,
      requires: { source: capability },
      async setup({ services, native, scope }) {
        const release = native.get(nativeContext)?.install(await services.source.api.echo('ready'));
        scope.onDispose(() => {
          release?.();
        });
        scope.onDispose(() => {
          events.push(`subscription-released:${scope.signal.aborted}`);
        });
      },
    });
    const plugin = await runtime.plugins.install(
      definePlugin({ id: 'plugin', transforms: [transform] }),
    );
    expect(plugin.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'dependency-unavailable',
      generation: 0,
    });
    expect(nativeLookup).not.toHaveBeenCalled();
    const source = await runtime.services.install(
      defineService({
        id: 'source',
        capability,
        execution,
        setup({ scope }) {
          scope.onDispose(() => {
            events.push('service-released');
          });
          return { echo: (value) => value };
        },
      }),
    );
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 1 });
    expect(nativeLookup).toHaveBeenCalledWith(nativeContext);
    expect(install).toHaveBeenCalledWith('ready');
    await source.disable();
    expect(events).toEqual([
      'installed:ready',
      'subscription-released:true',
      'native-released',
      'service-released',
    ]);
    expect(plugin.snapshot().contributions[0]?.status).toBe('waiting');
    await plugin.disable();
    await source.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'disabled', generation: 1 });
    expect(install).toHaveBeenCalledTimes(1);
    await plugin.enable();
    expect(plugin.snapshot().contributions[0]).toMatchObject({ status: 'active', generation: 2 });
    await runtime.dispose();
    expect(plugin.snapshot().status).toBe('disposed');
    expect(events.slice(-4)).toEqual([
      'installed:ready',
      'subscription-released:true',
      'native-released',
      'service-released',
    ]);
  });

  it('cleans failed setup, requires explicit retry and owns only cleanup registered with its scope', async () => {
    expect.assertions(9);
    const { runtime, diagnostics } = provider();
    const cleanup = vi.fn<() => void>();
    const returnedDisposer = vi.fn<() => void>();
    const register = vi.fn<() => void>().mockImplementationOnce(() => {
      throw new Error('native hook registration failed');
    });
    const transform = {
      kind: 'transform' as const,
      id: 'transform',
      execution,
      requires: {},
      setup({ scope }: SetupContext<Record<never, never>>) {
        scope.onDispose(cleanup);
        register();
        return { dispose: returnedDisposer };
      },
    };
    const plugin = await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        transforms: [transform],
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
    expect(
      plugin.snapshot().contributions.find((contribution) => contribution.id === 'transform'),
    ).toMatchObject({ status: 'failed', generation: 1 });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'setup-failure', contributionId: 'transform' }),
    );
    await expect(runtime.invoke({ action, input: 'sibling' })).resolves.toBe('sibling');
    await plugin.disable();
    await plugin.enable();
    expect(register).toHaveBeenCalledTimes(1);
    await plugin.retry('transform');
    expect(plugin.snapshot().status).toBe('ready');
    expect(register).toHaveBeenCalledTimes(2);
    await runtime.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(returnedDisposer).not.toHaveBeenCalled();
  });

  it('retains the replacement barrier while native cleanup is pending and after it fails', async () => {
    expect.assertions(8);
    const { runtime } = provider();
    const cleaning = deferred<void>();
    const release = deferred<void>();
    const cleanup = vi.fn<() => Promise<void>>(async () => {
      cleaning.resolve();
      await release.promise;
      throw new Error('native hook remains installed');
    });
    const previous = await runtime.plugins.install(
      definePlugin({
        id: 'plugin',
        transforms: [
          defineTransform({
            id: 'transform',
            execution,
            setup({ scope }) {
              scope.onDispose(cleanup);
            },
          }),
        ],
      }),
    );
    const setup = vi.fn<() => void>();
    const successor = definePlugin({
      id: 'plugin',
      transforms: [defineTransform({ id: 'transform', execution, setup })],
    });
    const replacing = runtime.plugins.replace(previous, successor);
    await cleaning.promise;
    expect(previous.snapshot().status).toBe('disposing');
    expect(setup).not.toHaveBeenCalled();
    await expect(runtime.plugins.install(successor)).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    release.resolve();
    await expect(replacing).rejects.toMatchObject({ code: 'cleanup-failure' });
    expect(previous.snapshot().status).toBe('cleanup-blocked');
    expect(setup).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup-failure' });
  });
});
