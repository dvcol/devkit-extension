import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCapability, defineOperation, definePlugin, defineTransform } from '../src/index.js';

describe('transform definitions', () => {
  it('keeps setup inert and snapshots structural requirements without freezing author code', () => {
    expect.assertions(9);
    const execution = { id: 'example.server' };
    const capability = defineCapability({
      id: 'example.source',
      version: 1,
      operations: { read: defineOperation({ input: z.string(), output: z.string() }) },
    });
    const requires = { source: capability };
    const setup = vi.fn<() => void>();
    const transform = defineTransform({ id: 'example.transform', execution, requires, setup });
    const structural = { kind: 'transform' as const, id: 'structural', execution, requires, setup };
    const plugin = definePlugin({ id: 'plugin', transforms: [structural] });
    execution.id = 'changed';
    Reflect.set(
      requires,
      'source',
      defineCapability({ id: capability.id, operations: capability.operations, version: 2 }),
    );
    structural.id = 'changed';

    expect(setup).not.toHaveBeenCalled();
    expect(transform.kind).toBe('transform');
    expect(transform.execution.id).toBe('example.server');
    expect(transform.requires.source.version).toBe(1);
    expect(plugin.transforms[0]).toMatchObject({
      id: 'structural',
      requires: { source: capability },
    });
    expect(Object.isFrozen(transform.requires)).toBe(true);
    expect(Object.isFrozen(requires)).toBe(false);
    expect(Object.isFrozen(setup)).toBe(false);
    expect(defineTransform({ id: 'independent', execution, setup }).requires).toEqual({});
  });

  it.each([
    { name: 'missing setup', definition: { id: 'transform', execution: { id: 'server' } } },
    {
      name: 'non-callable setup',
      definition: { id: 'transform', execution: { id: 'server' }, setup: {} },
    },
    {
      name: 'undefined requirements',
      definition: { id: 'transform', execution: { id: 'server' }, requires: undefined, setup() {} },
    },
    {
      name: 'native callback outside setup',
      definition: { id: 'transform', execution: { id: 'server' }, transform() {}, setup() {} },
    },
    {
      name: 'common pipeline order',
      definition: { id: 'transform', execution: { id: 'server' }, order: 'pre', setup() {} },
    },
  ])('rejects $name before setup', ({ definition }) => {
    expect.assertions(1);
    expect((): unknown => Reflect.apply(defineTransform, undefined, [definition])).toThrow(
      TypeError,
    );
  });

  it('rejects an incomplete structural transform in a plugin', () => {
    expect.assertions(1);
    expect((): unknown =>
      Reflect.apply(definePlugin, undefined, [
        {
          id: 'plugin',
          transforms: [{ kind: 'transform', id: 'transform', execution: { id: 'server' } }],
        },
      ]),
    ).toThrow(TypeError);
  });
});
