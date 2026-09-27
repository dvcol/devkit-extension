import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineAction, defineActionContract, defineOperation, definePlugin } from '../src/index.js';
import type { RouteSelector } from '../src/index.js';

const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });

describe('declarative action routing', () => {
  it('retains custom string identifiers without coercion or normalization', () => {
    expect.assertions(3);
    const source = { realm: 'Example.Custom', provider: 'Provider A' };
    const action = defineActionContract({
      id: 'example.action',
      version: 1,
      operation,
      routing: source,
    });
    source.provider = 'mutated';
    expect(action.routing).toEqual({ realm: 'Example.Custom', provider: 'Provider A' });
    expect(Object.isFrozen(action.routing)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
  });

  it('owns an immutable ordered fallback list without freezing caller values', () => {
    expect.assertions(7);
    const first = { realm: 'devserver', provider: 'frontend' };
    const second = { realm: 'webext' };
    const routing: [RouteSelector, ...RouteSelector[]] = [first, second];
    const action = defineActionContract({ id: 'example.action', version: 1, operation, routing });
    first.provider = 'mutated';
    second.realm = 'mutated';
    routing.reverse();
    expect(action.routing).toEqual([
      { realm: 'devserver', provider: 'frontend' },
      { realm: 'webext' },
    ]);
    expect(Object.isFrozen(action.routing)).toBe(true);
    expect(Object.isFrozen(action.routing[0])).toBe(true);
    expect(Object.isFrozen(action.routing[1])).toBe(true);
    expect(Object.isFrozen(routing)).toBe(false);
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(second)).toBe(false);
  });

  it('preserves routing when structural action declarations enter a plugin', () => {
    expect.assertions(3);
    const routing = { realm: 'custom', provider: 'backend' };
    const contract = {
      kind: 'action-contract' as const,
      id: 'example.action',
      version: 1,
      operation,
      routing,
    };
    const definition = {
      contract,
      id: 'example.handler',
      execution: { id: 'custom.execution' },
      handler: ({ input }: { readonly input: string }) => input,
    };
    const action = defineAction(definition);
    const plugin = definePlugin({
      id: 'example.plugin',
      actions: [{ ...definition, kind: 'action' as const, requires: {} }],
    });
    routing.realm = 'mutated';
    expect(action.contract.routing).toEqual({ realm: 'custom', provider: 'backend' });
    expect(plugin.actions[0]?.contract.routing).toEqual(action.contract.routing);
    expect(Object.isFrozen(plugin.actions[0]?.contract.routing)).toBe(true);
  });

  it.each([
    undefined,
    null,
    'devserver',
    {},
    { provider: 'frontend' },
    { realm: '' },
    { realm: '   ' },
    { realm: 1 },
    { realm: Symbol('devserver') },
    { realm: 'devserver', provider: undefined },
    { realm: 'devserver', provider: '' },
    { realm: 'devserver', provider: 1 },
    { realm: 'devserver', extra: true },
    { realm: 'devserver', [Symbol('extra')]: true },
    [],
    [undefined],
    [{ realm: 'devserver' }, { provider: 'frontend' }],
    [[{ realm: 'devserver' }]],
  ])('rejects malformed routing %j before declaration admission', (routing) => {
    expect.assertions(2);
    const contract = {
      kind: 'action-contract',
      id: 'example.action',
      version: 1,
      operation,
      routing,
    };
    expect(() => {
      Reflect.apply(defineActionContract, undefined, [
        { id: 'example.action', version: 1, operation, routing },
      ]);
    }).toThrow(TypeError);
    expect(() => {
      Reflect.apply(definePlugin, undefined, [
        {
          id: 'example.plugin',
          actions: [
            {
              kind: 'action',
              id: 'example.handler',
              execution: { id: 'server' },
              contract,
              requires: {},
              handler: () => '',
            },
          ],
        },
      ]);
    }).toThrow(TypeError);
  });
});
