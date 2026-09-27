import { defineCapability, defineOperation, defineService } from '@devkit/core';
import { describe, expect, it } from 'vitest';
import {
  action,
  backend,
  capability,
  client,
  deferred,
  operation,
  requireBinding,
} from './fixtures.js';

describe('routing request boundaries', () => {
  it.each([null, [], '', { provider: 'A' }])(
    'rejects malformed explicit routing %j instead of using a default',
    async (routing) => {
      expect.assertions(3);
      const first = await backend({ id: 'A' });
      const instance = client({ connections: [first.connection], routing: { realm: 'devserver' } });
      const actionResult: unknown = Reflect.apply(
        instance.actions.invoke.bind(instance.actions),
        instance.actions,
        [{ action, input: 'bad', routing }],
      );
      const capabilityResult: unknown = Reflect.apply(
        instance.capabilities.resolve.bind(instance.capabilities),
        instance.capabilities,
        [{ capability, routing }],
      );
      await expect(actionResult).rejects.toMatchObject({ code: 'invalid-routing' });
      await expect(capabilityResult).rejects.toMatchObject({ code: 'invalid-routing' });
      expect(first.calls).toEqual([]);
    },
  );

  it.each([undefined, null, [], 'devserver'])(
    'rejects malformed callback results %j',
    async (result) => {
      expect.assertions(2);
      const first = await backend({ id: 'A' });
      const instance = client({ connections: [first.connection] });
      const invocation: unknown = Reflect.apply(
        instance.actions.invoke.bind(instance.actions),
        instance.actions,
        [{ action, input: 'bad', routing: () => result }],
      );
      await expect(invocation).rejects.toMatchObject({ code: 'invalid-routing' });
      expect(first.calls).toEqual([]);
    },
  );

  it('rechecks readiness when a callback selects the same live incarnation', async () => {
    expect.assertions(1);
    const first = await backend({ id: 'A' });
    await first.service.disable();
    const instance = client({ connections: [first.connection] });
    const pending = deferred<void>();
    const invocation = instance.actions.invoke({
      action,
      input: 'restored',
      routing: async () => {
        await pending.promise;
        return { realm: 'devserver', provider: 'A' };
      },
    });
    await first.service.enable();
    pending.resolve();
    await expect(invocation).resolves.toBe('A:restored');
  });

  it('captures a bound operation target before asynchronous dispatch', async () => {
    expect.assertions(2);
    const first = await backend({ id: 'A' });
    const targeted = defineCapability({
      id: 'example.targeted',
      version: 1,
      operations: {
        read: defineOperation({
          input: operation.input,
          output: operation.output,
          target: 'required',
        }),
      },
    });
    await first.runtime.services.install(
      defineService({
        capability: targeted,
        id: 'targeted',
        execution: { id: 'example.local' },
        setup: () => ({ read: (_input, context) => context.target.generation }),
      }),
    );
    const instance = client({ connections: [first.connection] });
    const binding = requireBinding(await instance.capabilities.resolve({ capability: targeted }));
    const target = { kind: 'document', id: 'page', generation: 'original' };
    const invocation = binding.api.read('input', { target });
    target.generation = 'mutated';
    await expect(invocation).resolves.toBe('original');
    expect(target.generation).toBe('mutated');
  });
});
