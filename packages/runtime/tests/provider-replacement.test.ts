import { defineCapability, definePlugin, defineService } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';

import {
  admitted,
  available,
  capability,
  deferred,
  echoService,
  execution,
  operation,
  provider,
} from './provider-fixtures.js';

describe('provider replacement', () => {
  it('keeps the old service active when relaxed replacement skips an already owned successor slot', async () => {
    expect.assertions(5);
    const { runtime, diagnostics } = provider({ strict: false });
    const old = admitted(await runtime.services.install(echoService('old', 'old:')));
    const other = defineCapability({
      id: 'example.occupied',
      version: 1,
      operations: { echo: operation },
    });
    await runtime.services.install(
      defineService({
        capability: other,
        id: 'occupied',
        execution,
        setup: () => ({ echo: (value) => value }),
      }),
    );
    const result = await runtime.services.replace(
      old,
      defineService({
        capability: other,
        id: 'incoming',
        execution,
        setup: () => ({ echo: (value) => value }),
      }),
    );
    expect(result).toMatchObject({ status: 'skipped', diagnostic: { severity: 'warning' } });
    expect(old.snapshot().status).toBe('ready');
    await expect(available(await runtime.resolve(capability)).api.echo('value')).resolves.toBe(
      'old:value',
    );
    expect(old.snapshot().contributions[0]?.generation).toBe(1);
    expect(diagnostics.at(-1)?.code).toBe('duplicate-registration');
    await runtime.dispose();
  });

  it('keeps a current installation active when replacement preflight rejects', async () => {
    expect.assertions(4);
    const { runtime } = provider();
    const old = admitted(
      await runtime.plugins.install(definePlugin({ id: 'old', services: [echoService()] })),
    );
    const invalid = definePlugin({ id: 'new', services: [echoService('one'), echoService('two')] });
    await expect(runtime.plugins.replace(old, invalid)).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    expect(old.snapshot().status).toBe('ready');
    const binding = available(await runtime.resolve(capability));
    await expect(binding.api.echo('still active')).resolves.toBe('still active');
    expect(old.snapshot().contributions[0]?.generation).toBe(1);
    await runtime.dispose();
  });

  it('reserves successor identities while allowing unrelated installation during cleanup', async () => {
    expect.assertions(8);
    const { runtime } = provider();
    const cleaning = deferred<void>();
    const releaseCleanup = deferred<void>();
    const old = admitted(
      await runtime.services.install(
        defineService({
          capability: capability,
          id: 'old',
          execution,
          setup({ scope }) {
            scope.onDispose(() => {
              cleaning.resolve();
              return releaseCleanup.promise;
            });
            return { echo: (value) => value };
          },
        }),
      ),
    );
    const next = defineCapability({
      id: 'example.next',
      version: 1,
      operations: { echo: operation },
    });
    const setup = vi.fn<() => { echo: (value: string) => string }>(() => ({
      echo: (value) => `next:${value}`,
    }));
    const replacement = runtime.services.replace(
      old,
      defineService({ capability: next, id: 'next', execution, setup }),
    );
    await cleaning.promise;
    expect(old.snapshot().status).toBe('disposing');
    expect(setup).not.toHaveBeenCalled();
    await expect(
      runtime.services.install(
        defineService({ capability: next, id: 'competitor', execution, setup }),
      ),
    ).rejects.toMatchObject({ code: 'duplicate-registration' });
    const independent = defineCapability({
      id: 'example.independent',
      version: 1,
      operations: { echo: operation },
    });
    const installed = admitted(
      await runtime.services.install(
        defineService({
          capability: independent,
          id: 'independent',
          execution,
          setup: () => ({ echo: (value) => value }),
        }),
      ),
    );
    expect(installed.snapshot().status).toBe('ready');
    await expect(available(await runtime.resolve(independent)).api.echo('available')).resolves.toBe(
      'available',
    );
    releaseCleanup.resolve();
    const successor = admitted(await replacement);
    expect(successor.snapshot().status).toBe('ready');
    expect(old.snapshot().status).toBe('disposed');
    await expect(available(await runtime.resolve(next)).api.echo('value')).resolves.toBe(
      'next:value',
    );
    await runtime.dispose();
  });

  it('retains old reservations after cleanup failure and does not repeat disposal', async () => {
    expect.assertions(7);
    const { runtime } = provider();
    const cleanup = vi.fn<() => void>(() => {
      throw new Error('cannot release');
    });
    const old = admitted(
      await runtime.services.install(
        defineService({
          capability: capability,
          id: 'old',
          execution,
          setup({ scope }) {
            scope.onDispose(cleanup);
            return { echo: (value) => value };
          },
        }),
      ),
    );
    await expect(runtime.services.replace(old, echoService('successor'))).rejects.toMatchObject({
      code: 'cleanup-failure',
    });
    expect(old.snapshot().status).toBe('cleanup-blocked');
    expect(cleanup).toHaveBeenCalledTimes(1);
    const first = old.dispose();
    expect(first).toBe(old.dispose());
    await expect(first).rejects.toMatchObject({ code: 'cleanup-failure' });
    await expect(runtime.services.install(echoService('competitor'))).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup-failure' });
  });

  it('rechecks a queued replacement handle after an earlier replacement disposed it', async () => {
    expect.assertions(3);
    const { runtime } = provider();
    const cleaning = deferred<void>();
    const released = deferred<void>();
    const old = admitted(
      await runtime.services.install(
        defineService({
          capability: capability,
          id: 'old',
          execution,
          setup({ scope }) {
            scope.onDispose(() => {
              cleaning.resolve();
              return released.promise;
            });
            return { echo: (value) => value };
          },
        }),
      ),
    );
    const first = runtime.services.replace(old, echoService('first', 'first:'));
    await cleaning.promise;
    const second = runtime.services.replace(old, echoService('second', 'second:'));
    const secondOutcome = second.catch((error: unknown) => error);
    released.resolve();
    expect(admitted(await first).snapshot().status).toBe('ready');
    await expect(secondOutcome).resolves.toMatchObject({ code: 'invalid-definition' });
    await expect(available(await runtime.resolve(capability)).api.echo('value')).resolves.toBe(
      'first:value',
    );
    await runtime.dispose();
  });
});
