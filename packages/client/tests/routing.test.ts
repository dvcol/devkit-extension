import { describe, expect, it } from 'vitest';
import { RoutingError } from '../src/index.js';
import { action, backend, capability, client, requireBinding } from './fixtures.js';

describe('ordinary provider routing', () => {
  it('executes real actions and capabilities and exposes provider identity', async () => {
    expect.assertions(4);
    const first = await backend({ id: 'A' });
    const instance = client({ connections: [first.connection] });
    await expect(instance.actions.invoke({ action, input: 'action' })).resolves.toBe('A:action');
    await expect(
      instance.capabilities.invoke({ capability, operation: 'echo', input: 'capability' }),
    ).resolves.toBe('A:capability');
    expect(instance.providers.snapshot()).toEqual([
      { provider: first.connection.provider, status: 'open' },
    ]);
    expect(first.calls).toEqual(['action', 'capability']);
  });

  it('replaces host and action defaults with per-call routing without inherited fallback', async () => {
    expect.assertions(4);
    const first = await backend({ id: 'A', routing: { realm: 'devserver', provider: 'A' } });
    const second = await backend({ id: 'B' });
    const instance = client({
      connections: [first.connection, second.connection],
      routing: { realm: 'devserver', provider: 'B' },
    });
    await expect(instance.actions.invoke({ action, input: 'host' })).resolves.toBe('B:host');
    await expect(instance.actions.invoke({ action: first.action, input: 'default' })).resolves.toBe(
      'A:default',
    );
    await expect(
      instance.actions.invoke({
        action: first.action,
        input: 'override',
        routing: { realm: 'devserver', provider: 'B' },
      }),
    ).resolves.toBe('B:override');
    await expect(
      instance.actions.invoke({
        action: first.action,
        input: 'missing',
        routing: { realm: 'devserver', provider: 'absent' },
      }),
    ).rejects.toMatchObject({ code: 'unavailable-provider' });
  });

  it('uses ordered fallback at dispatch and stops on ambiguous preferred groups', async () => {
    expect.assertions(10);
    const first = await backend({ id: 'A' });
    const second = await backend({ id: 'B', realm: 'webext' });
    const instance = client({ connections: [first.connection, second.connection] });
    const routing = [{ realm: 'devserver' }, { realm: 'webext' }] as const;
    await first.service.disable();
    await expect(instance.actions.invoke({ action, input: 'fallback', routing })).resolves.toBe(
      'B:fallback',
    );
    await first.service.enable();
    await expect(instance.actions.invoke({ action, input: 'restored', routing })).resolves.toBe(
      'A:restored',
    );
    const third = await backend({ id: 'C' });
    instance.providers.attach({ connection: third.connection });
    const error = requireRoutingError(
      await instance.actions
        .invoke({ action, input: 'ambiguous', routing })
        .catch((failure: unknown) => failure),
    );
    expect(error).toBeInstanceOf(RoutingError);
    expect(error).toMatchObject({
      name: 'RoutingError',
      code: 'ambiguous-provider',
      message: expect.stringContaining('retry with a realm and provider discriminant') as unknown,
      candidates: [
        { provider: first.connection.provider, availability: { status: 'available' } },
        { provider: third.connection.provider, availability: { status: 'available' } },
      ],
    });
    expect(Object.isFrozen(error.candidates)).toBe(true);
    await first.service.disable();
    expect(error.candidates[0]?.availability).toEqual({ status: 'available' });
    const selected = error.candidates[1]!.provider;
    await expect(
      instance.actions.invoke({
        action,
        input: 'picked',
        routing: { realm: selected.realm.id, provider: selected.id },
      }),
    ).resolves.toBe('C:picked');
    expect(first.calls).toEqual(['restored']);
    expect(second.calls).toEqual(['fallback']);
    expect(third.calls).toEqual(['picked']);
  });

  it('never retries a dispatched failure on a fallback provider', async () => {
    expect.assertions(3);
    const first = await backend({
      id: 'A',
      handler() {
        throw new Error('mutation already started');
      },
    });
    const second = await backend({ id: 'B', realm: 'webext' });
    const instance = client({ connections: [first.connection, second.connection] });
    await expect(
      instance.actions.invoke({
        action,
        input: 'mutation',
        routing: [{ realm: 'devserver' }, { realm: 'webext' }],
      }),
    ).rejects.toMatchObject({ code: 'operation-failed' });
    expect(first.calls).toEqual(['mutation']);
    expect(second.calls).toEqual([]);
  });

  it('keeps resolved bindings pinned after connection replacement', async () => {
    expect.assertions(4);
    const first = await backend({ id: 'A' });
    const instance = client();
    const attachment = instance.providers.attach({ connection: first.connection });
    const resolved = await instance.capabilities.resolve({ capability });
    const binding = requireBinding(resolved);
    expect(binding.context.provider).toEqual(first.connection.provider);
    attachment.detach();
    const successor = await backend({ id: 'A', incarnation: 'replacement' });
    instance.providers.attach({ connection: successor.connection });
    await expect(binding.api.echo('old')).rejects.toMatchObject({
      code: 'stale-selection',
    });
    await expect(
      instance.capabilities.invoke({ capability, operation: 'echo', input: 'new' }),
    ).resolves.toBe('A:new');
    expect(first.calls).toEqual([]);
  });
});

function requireRoutingError(value: unknown): RoutingError {
  if (value instanceof RoutingError) return value;
  throw new Error('Expected the public routing error');
}
