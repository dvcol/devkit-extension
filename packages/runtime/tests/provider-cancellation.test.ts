import { defineAction, defineCapability, definePlugin, defineService } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import {
  action,
  admitted,
  available,
  capability,
  deferred,
  execution,
  operation,
  provider,
} from './provider-fixtures.js';

describe('provider cancellation and resource ownership', () => {
  it('cancels service work before waiting for dependent actions that omitted signal forwarding', async () => {
    expect.assertions(4);
    const { runtime } = provider();
    const started = deferred<void>();
    const service = defineService({
      capability: capability,
      id: 'service',
      execution,
      setup: () => ({
        echo: (_value, context) =>
          new Promise<string>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                resolve('cancelled');
              },
              { once: true },
            );
            started.resolve();
          }),
      }),
    });
    const source = admitted(await runtime.services.install(service));
    const contribution = defineAction({
      contract: action,
      id: 'action',
      execution,
      requires: { source: capability },
      handler: ({ input, services }) => services.source.api.echo(input),
    });
    const dependent = admitted(
      await runtime.plugins.install(definePlugin({ id: 'plugin', actions: [contribution] })),
    );
    const invoked = runtime.invoke({ action: action, input: 'wait' });
    const outcome = invoked.catch((error: unknown) => error);
    await started.promise;
    await source.disable();
    await expect(outcome).resolves.toMatchObject({ code: 'cancelled' });
    expect(source.snapshot().contributions[0]?.status).toBe('disabled');
    expect(dependent.snapshot().contributions[0]?.status).toBe('waiting');
    expect(await runtime.resolve({ capability: capability })).toMatchObject({
      status: 'unavailable',
    });
    await runtime.dispose();
  });

  it('waits for setup to finish, fences its late value and cleans resources on provider disposal', async () => {
    expect.assertions(5);
    const { runtime } = provider();
    const started = deferred<void>();
    const finish = deferred<void>();
    const cleanup = vi.fn<() => void>();
    const installing = runtime.services.install(
      defineService({
        capability: capability,
        id: 'service',
        execution,
        async setup({ scope }) {
          scope.onDispose(cleanup);
          started.resolve();
          await finish.promise;
          return { echo: (value) => value };
        },
      }),
    );
    await started.promise;
    const disposing = runtime.dispose();
    expect(disposing).toBe(runtime.dispose());
    expect(cleanup).not.toHaveBeenCalled();
    finish.resolve();
    await disposing;
    const handle = admitted(await installing);
    expect(handle.snapshot().status).toBe('disposed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(await runtime.resolve({ capability: capability })).toMatchObject({
      status: 'unavailable',
    });
  });

  it('finishes dependent cleanup before disposing the service resource', async () => {
    expect.assertions(2);
    const { runtime } = provider();
    const order: string[] = [];
    const other = defineCapability({
      id: 'example.dependent',
      version: 1,
      operations: { echo: operation },
    });
    const source = admitted(
      await runtime.services.install(
        defineService({
          capability: capability,
          id: 'source',
          execution,
          setup({ scope }) {
            scope.onDispose(() => {
              order.push('source');
            });
            return { echo: (value) => value };
          },
        }),
      ),
    );
    await runtime.services.install(
      defineService({
        capability: other,
        id: 'dependent',
        execution,
        requires: { source: capability },
        setup({ scope }) {
          scope.onDispose(() => {
            order.push('dependent');
          });
          return { echo: (value) => value };
        },
      }),
    );
    const pinned = available(await runtime.resolve({ capability: capability }));
    await source.disable();
    expect(order).toEqual(['dependent', 'source']);
    await expect(pinned.api.echo('late')).rejects.toMatchObject({ code: 'unavailable-capability' });
    await runtime.dispose();
  });

  it('publishes the stop attempt before synchronous abort listeners reenter disable', async () => {
    expect.assertions(4);
    const { runtime } = provider();
    const reentry = deferred<Promise<unknown>>();
    const cleanup = vi.fn<() => void>();
    const service = defineService({
      capability: capability,
      id: 'service',
      execution,
      setup({ scope }) {
        scope.onDispose(cleanup);
        scope.signal.addEventListener(
          'abort',
          () => {
            reentry.resolve(handle.disable());
          },
          { once: true },
        );
        return { echo: (value) => value };
      },
    });
    const handle = admitted(await runtime.services.install(service));
    await handle.disable();
    await expect(reentry.promise).resolves.toMatchObject({ status: 'inactive' });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(handle.snapshot().contributions[0]?.status).toBe('disabled');
    expect(handle.snapshot().diagnostics).toEqual([]);
    await runtime.dispose();
  });
});
