import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCapability, defineOperation, definePlugin, defineScript } from '../src/index.js';

describe('script definitions', () => {
  it('keeps setup inert and snapshots requirements and execution without adopting packaged code or native registrations', () => {
    expect.assertions(12);
    const execution = { id: 'example.server' };
    const capability = defineCapability({
      id: 'example.counter',
      version: 1,
      operations: { read: defineOperation({ input: z.object({}), output: z.number() }) },
    });
    const requires = { counter: capability };
    const setup = vi.fn<() => void>();
    const script = defineScript({ id: 'example.script', execution, requires, setup });
    const structural = {
      kind: 'script' as const,
      id: 'example.structural',
      execution,
      requires,
      setup,
    };
    const plugin = definePlugin({ id: 'example.plugin', scripts: [structural] });
    execution.id = 'changed';
    Reflect.set(
      requires,
      'counter',
      defineCapability({
        id: capability.id,
        operations: capability.operations,
        version: 2,
      }),
    );
    structural.id = 'changed';

    expect(setup).not.toHaveBeenCalled();
    expect(script.kind).toBe('script');
    expect(script).toHaveProperty('setup', setup);
    expect(script.execution.id).toBe('example.server');
    expect(script.requires.counter.version).toBe(1);
    expect(plugin.scripts[0]?.id).toBe('example.structural');
    expect(plugin.scripts[0]?.requires.counter.version).toBe(1);
    expect(Object.isFrozen(script)).toBe(true);
    expect(Object.isFrozen(script.requires)).toBe(true);
    expect(Object.isFrozen(requires)).toBe(false);
    expect(Object.isFrozen(setup)).toBe(false);
    expect(defineScript({ id: 'without-requirements', execution, setup }).requires).toEqual({});
  });

  it.each([
    { name: 'missing setup', definition: { id: 'script', execution: { id: 'server' } } },
    {
      name: 'non-callable setup',
      definition: { id: 'script', execution: { id: 'server' }, setup: {} },
    },
    {
      name: 'undefined requirements',
      definition: { id: 'script', execution: { id: 'server' }, requires: undefined, setup() {} },
    },
    {
      name: 'source discovery outside setup',
      definition: {
        id: 'script',
        execution: { id: 'server' },
        entry: './bootstrap.ts',
        setup() {},
      },
    },
  ])('rejects $name before setup', ({ definition }) => {
    expect.assertions(1);
    expect((): unknown => Reflect.apply(defineScript, undefined, [definition])).toThrow(TypeError);
  });

  it('rejects an incomplete structural script in a plugin', () => {
    expect.assertions(1);
    expect((): unknown =>
      Reflect.apply(definePlugin, undefined, [
        { id: 'plugin', scripts: [{ kind: 'script', id: 'script', execution: { id: 'server' } }] },
      ]),
    ).toThrow(TypeError);
  });
});
