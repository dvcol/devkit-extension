import { defineAction, definePlugin, defineService } from '@devkit/core';
import type { ProviderDescriptor } from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { invokeLocalOperation } from '../src/invocation.js';
import type { LocalOperationContext } from '../src/invocation.js';
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

function identity(incarnation: string) {
  return { id: 'example.provider', incarnation, realm: { id: 'example.custom-realm' } };
}

describe('provider backend identity', () => {
  it.each([undefined, null, 1, '', '  '])(
    'rejects a missing or invalid incarnation %j',
    (incarnation) => {
      expect.assertions(1);
      const descriptor = identity('original');
      Reflect.set(descriptor, 'incarnation', incarnation);
      expect(() => provider({ provider: descriptor })).toThrow(
        'Provider incarnation must be a non-empty string',
      );
    },
  );

  it('snapshots caller identity for setup, bindings and actions without rotating it on reactivation', async () => {
    expect.assertions(11);
    const descriptor = identity('opaque backend lifetime');
    const expected = identity(descriptor.incarnation);
    const contexts: ProviderDescriptor[] = [];
    const { runtime } = provider({ provider: descriptor });
    descriptor.id = 'mutated-provider';
    descriptor.incarnation = 'mutated-incarnation';
    descriptor.realm.id = 'mutated-realm';
    const service = defineService({
      capability: capability,
      id: 'echo',
      execution,
      setup(context) {
        contexts.push(context.provider);
        return {
          echo(_input, operationContext) {
            contexts.push(operationContext.provider);
            return operationContext.provider.incarnation;
          },
        };
      },
    });
    const actionDefinition = defineAction({
      contract: action,
      id: 'echo-action',
      execution,
      requires: { echo: capability },
      handler(context) {
        contexts.push(context.provider, context.services.echo.context.provider);
        return context.services.echo.api.echo(context.input);
      },
    });
    try {
      const installed = await runtime.startup({
        services: [service],
        plugins: [definePlugin({ id: 'actions', actions: [actionDefinition] })],
      });
      const serviceHandle = admitted(installed.services[0]);
      const binding = available(await runtime.resolve({ capability: capability }));
      expect(binding.context.provider).toEqual(expected);
      expect(Object.isFrozen(binding.context.provider)).toBe(true);
      expect(Object.isFrozen(binding.context.provider.realm)).toBe(true);
      expect(Object.isFrozen(descriptor)).toBe(false);
      expect(Object.isFrozen(descriptor.realm)).toBe(false);
      await expect(binding.api.echo('')).resolves.toBe(expected.incarnation);
      await expect(runtime.invoke({ action: action, input: '' })).resolves.toBe(
        expected.incarnation,
      );
      await serviceHandle.disable();
      await serviceHandle.enable();
      expect(serviceHandle.snapshot().contributions[0]?.generation).toBe(2);
      await expect(binding.api.echo('')).resolves.toBe(expected.incarnation);
      expect(contexts.every((context) => context.incarnation === expected.incarnation)).toBe(true);
      expect(contexts.every((context) => Object.isFrozen(context))).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it('keeps a binding on its original backend when another incarnation uses the same configured ID', async () => {
    expect.assertions(8);
    const { runtime: previous } = provider({ provider: identity('previous-lifetime') });
    const { runtime: successor } = provider({ provider: identity('successor-lifetime') });
    const successorHandler = vi.fn<(value: string) => string>((value) => `successor:${value}`);
    try {
      await previous.services.install(
        defineService({
          capability: capability,
          id: 'echo',
          execution,
          setup: () => ({ echo: (value) => `previous:${value}` }),
        }),
      );
      const previousBinding = available(await previous.resolve({ capability: capability }));
      await successor.services.install(
        defineService({
          capability: capability,
          id: 'echo',
          execution,
          setup: () => ({ echo: successorHandler }),
        }),
      );
      const successorBinding = available(await successor.resolve({ capability: capability }));
      expect(previousBinding.context.provider.id).toBe(successorBinding.context.provider.id);
      expect(previousBinding.context.provider.incarnation).not.toBe(
        successorBinding.context.provider.incarnation,
      );
      expect(previousBinding.context.provider.incarnation).toBe('previous-lifetime');
      await expect(previousBinding.api.echo('first')).resolves.toBe('previous:first');
      await expect(successorBinding.api.echo('first')).resolves.toBe('successor:first');
      await previous.dispose();
      await expect(previousBinding.api.echo('stale')).rejects.toMatchObject({
        code: 'unavailable-capability',
      });
      expect(successorHandler).toHaveBeenCalledExactlyOnceWith('first', expect.any(Object));
      await expect(successorBinding.api.echo('second')).resolves.toBe('successor:second');
    } finally {
      await previous.dispose();
      await successor.dispose();
    }
  });

  it('captures identity before asynchronous input validation', async () => {
    expect.assertions(4);
    const validation = deferred<void>();
    const descriptor = identity('original-lifetime');
    const handler = vi.fn<(_value: unknown, context: LocalOperationContext) => string>(
      (_value, context) => context.provider.incarnation,
    );
    const result = invokeLocalOperation({
      operation: {
        ...operation,
        input: z.string().refine(async () => {
          await validation.promise;
          return true;
        }),
      },
      input: 'input',
      options: {},
      context: {
        provider: descriptor,
        execution,
        contributionId: 'echo',
        native: { get: vi.fn<() => undefined>() },
      },
      activationSignal: new AbortController().signal,
      handler,
    });
    descriptor.incarnation = 'successor-lifetime';
    descriptor.realm.id = 'mutated-realm';
    validation.resolve();
    await expect(result).resolves.toBe('original-lifetime');
    const observed = handler.mock.calls[0]?.[1].provider;
    expect(observed).toEqual(identity('original-lifetime'));
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed?.realm)).toBe(true);
  });
});
