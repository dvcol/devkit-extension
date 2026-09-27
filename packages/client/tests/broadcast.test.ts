import { describe, expect, it } from 'vitest';
import { action, backend, capability, client } from './fixtures.js';

describe('broadcast recipient preflight', () => {
  it('reports every unmatched selector before any recipient runs', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const selection = [
      { realm: 'devserver', provider: 'A' },
      { realm: 'webext', provider: 'B' },
      { realm: 'other' },
    ] as const;
    await expect(
      instance.actions.broadcast({ action, input: 'mutation', selection }),
    ).rejects.toMatchObject({
      code: 'unmatched-selection',
      selectors: selection.slice(1),
      message: expect.stringContaining('Broadcast was not dispatched') as unknown,
    });
    await expect(
      instance.capabilities.broadcast({
        capability,
        operation: 'echo',
        input: 'mutation',
        selection,
      }),
    ).rejects.toMatchObject({
      code: 'unmatched-selection',
      message: expect.stringContaining('"provider":"B"') as unknown,
    });
    expect(first.calls).toEqual([]);
  });

  it('deduplicates overlapping selectors and ignores ordinary routing defaults', async () => {
    expect.assertions(4);
    const first = await backend({ id: 'A', routing: { realm: 'missing' } });
    const second = await backend({ id: 'B' });
    const instance = client({
      connections: [first.connection, second.connection],
      routing: { realm: 'also-missing' },
    });
    const results = await instance.actions.broadcast({
      action: first.action,
      input: 'union',
      selection: [{ realm: 'devserver' }, { realm: 'devserver', provider: 'A' }],
    });
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(results.map((result) => result.provider.id)).toEqual(['A', 'B']);
    expect(first.calls).toEqual(['union']);
    expect(second.calls).toEqual(['union']);
  });

  it('preserves successful siblings alongside known unavailability and handler failure', async () => {
    expect.assertions(5);
    const first = await backend({ id: 'A' });
    const unavailable = await backend({ id: 'B' });
    const failed = await backend({
      id: 'C',
      handler() {
        throw new Error('failed');
      },
    });
    await unavailable.service.disable();
    const instance = client({
      connections: [first.connection, unavailable.connection, failed.connection],
    });
    const results = await instance.capabilities.broadcast({
      capability,
      operation: 'echo',
      input: 'broadcast',
      selection: [{ realm: 'devserver' }],
    });
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 'A:broadcast' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'unavailable-provider' },
    });
    expect(results[2]).toMatchObject({ status: 'rejected', reason: { code: 'operation-failed' } });
    expect(unavailable.calls).toEqual([]);
    expect(failed.calls).toEqual(['broadcast']);
  });

  it('rejects empty selection and pre-cancelled requests without side effects', async () => {
    expect.assertions(3);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    const result: unknown = Reflect.apply(
      instance.actions.broadcast.bind(instance.actions),
      instance.actions,
      [{ action, input: 'empty', selection: [] }],
    );
    await expect(result).rejects.toMatchObject({ code: 'invalid-routing' });
    await expect(
      instance.actions.broadcast({
        action,
        input: 'cancelled',
        selection: [{ realm: 'devserver' }],
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(first.calls).toEqual([]);
  });
});
