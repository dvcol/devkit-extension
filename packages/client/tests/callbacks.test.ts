import type { RoutingContext } from '@devkit/core';
import { describe, expect, it } from 'vitest';
import { action, backend, client, deferred, operation } from './fixtures.js';

describe('routing callback lifetime', () => {
  it('uses current readiness within the original candidate set for callback fallback', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const second = await backend({ id: 'B', realm: 'webext' });
    const instance = client({ connections: [first.connection, second.connection] });
    const pending = deferred<void>();
    const invocation = instance.actions.invoke({
      action,
      input: 'fallback',
      routing: async () => {
        await pending.promise;
        return [{ realm: 'devserver' }, { realm: 'webext' }];
      },
    });
    await first.service.disable();
    pending.resolve();
    await expect(invocation).resolves.toBe('B:fallback');
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(['fallback']);
  });

  it('preserves callback failures without dispatching', async () => {
    expect.assertions(2);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const failure = new Error('Provider picker failed');
    await expect(
      instance.actions.invoke({
        action,
        input: 'failed',
        routing: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(first.calls).toEqual([]);
  });

  it('rejects a replaced incarnation from a waiting callback and permits a fresh direct selection', async () => {
    expect.assertions(6);
    const first = await backend({ id: 'A' });
    const instance = client();
    const attachment = instance.providers.attach({ connection: first.connection });
    const waiting = deferred<void>();
    let observed: RoutingContext | undefined;
    const invocation = instance.actions.invoke({
      action,
      input: 'stale',
      routing: async (context) => {
        observed = context;
        await waiting.promise;
        return { realm: 'devserver', provider: 'A' };
      },
    });
    attachment.detach();
    const successor = await backend({ id: 'A', incarnation: 'successor' });
    instance.providers.attach({ connection: successor.connection });
    waiting.resolve();
    await expect(invocation).rejects.toMatchObject({ code: 'stale-selection' });
    expect(observed?.candidates[0]?.provider.incarnation).toBe('A.original');
    expect(Object.isFrozen(observed?.candidates[0]?.provider)).toBe(true);
    expect(first.calls).toEqual([]);
    expect(successor.calls).toEqual([]);
    await expect(instance.actions.invoke({ action, input: 'fresh' })).resolves.toBe('A:fresh');
  });

  it('passes ordinary input to the selector and retains frozen candidates while other providers change', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const wait = deferred<void>();
    let candidatesFrozen = false;
    const invocation = instance.actions.invoke({
      action,
      input: 'A',
      routing: async (context) => {
        candidatesFrozen = Object.isFrozen(context.candidates);
        await wait.promise;
        return { realm: 'devserver', provider: operation.input.parse(context.input) };
      },
    });
    const second = await backend({ id: 'B' });
    instance.providers.attach({ connection: second.connection });
    wait.resolve();
    await expect(invocation).resolves.toBe('A:A');
    expect(candidatesFrozen).toBe(true);
    expect(second.calls).toEqual([]);
  });

  it('cancels a waiting selector promptly and ignores its late completion', async () => {
    expect.assertions(2);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const pending = deferred<void>();
    const cancellation = new AbortController();
    const invocation = instance.actions.invoke({
      action,
      input: 'late',
      signal: cancellation.signal,
      routing: async () => {
        await pending.promise;
        return { realm: 'devserver' };
      },
    });
    cancellation.abort();
    await expect(invocation).rejects.toMatchObject({ code: 'cancelled' });
    pending.resolve();
    await pending.promise;
    expect(first.calls).toEqual([]);
  });

  it('client disposal cancels a waiting callback without disposing backend resources', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const pending = deferred<void>();
    const invocation = instance.actions.invoke({
      action,
      input: 'cancelled',
      routing: async () => {
        await pending.promise;
        return { realm: 'devserver' };
      },
    });
    instance.dispose();
    await expect(invocation).rejects.toMatchObject({ code: 'cancelled' });
    pending.resolve();
    expect(first.runtime.catalog.snapshot().status).toBe('open');
    await expect(first.runtime.invoke({ action, input: 'still-owned' })).resolves.toBe(
      'A:still-owned',
    );
  });

  it('does not deliver a late result or replay when its provider detaches during execution', async () => {
    expect.assertions(3);
    const running = deferred<void>();
    const finish = deferred<string>();
    const first = await backend({
      id: 'A',
      handler: () => {
        running.resolve();
        return finish.promise;
      },
    });
    const second = await backend({ id: 'B', realm: 'webext' });
    const instance = client({ connections: [second.connection] });
    const attachment = instance.providers.attach({ connection: first.connection });
    const invocation = instance.actions.invoke({
      action,
      input: 'side-effect',
      routing: [{ realm: 'devserver' }, { realm: 'webext' }],
    });
    await running.promise;
    attachment.detach();
    finish.resolve('late');
    await expect(invocation).rejects.toMatchObject({ code: 'cancelled' });
    expect(first.calls).toEqual(['side-effect']);
    expect(second.calls).toEqual([]);
  });
});
