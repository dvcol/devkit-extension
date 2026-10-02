import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCapability, defineOperation, definePlugin, defineView } from '../src/index.js';

describe('view definitions', () => {
  it('keeps setup inert and snapshots requirements and execution without adopting native resources', () => {
    expect.assertions(12);
    const execution = { id: 'example.server' };
    const capability = defineCapability({
      id: 'example.counter',
      version: 1,
      operations: { read: defineOperation({ input: z.object({}), output: z.number() }) },
    });
    const requires = { counter: capability };
    const setup = vi.fn<() => void>();
    const view = defineView({ id: 'example.view', execution, requires, setup });
    const structural = {
      kind: 'view' as const,
      id: 'example.structural',
      execution,
      requires,
      setup,
    };
    const plugin = definePlugin({ id: 'example.plugin', views: [structural] });
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
    expect(view.kind).toBe('view');
    expect(view).toHaveProperty('setup', setup);
    expect(view.execution.id).toBe('example.server');
    expect(view.requires.counter.version).toBe(1);
    expect(plugin.views[0]?.id).toBe('example.structural');
    expect(plugin.views[0]?.requires.counter.version).toBe(1);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.requires)).toBe(true);
    expect(Object.isFrozen(requires)).toBe(false);
    expect(Object.isFrozen(setup)).toBe(false);
    expect(defineView({ id: 'without-requirements', execution, setup }).requires).toEqual({});
  });

  it.each([
    { name: 'missing setup', definition: { id: 'view', execution: { id: 'server' } } },
    {
      name: 'non-callable setup',
      definition: { id: 'view', execution: { id: 'server' }, setup: {} },
    },
    {
      name: 'undefined requirements',
      definition: { id: 'view', execution: { id: 'server' }, requires: undefined, setup() {} },
    },
    {
      name: 'renderer fields outside setup',
      definition: { id: 'view', execution: { id: 'server' }, renderer: 'custom', setup() {} },
    },
  ])('rejects $name before setup', ({ definition }) => {
    expect.assertions(1);
    expect((): unknown => Reflect.apply(defineView, undefined, [definition])).toThrow(TypeError);
  });

  it('rejects an incomplete structural view in a plugin', () => {
    expect.assertions(1);
    expect((): unknown =>
      Reflect.apply(definePlugin, undefined, [
        { id: 'plugin', views: [{ kind: 'view', id: 'view', execution: { id: 'server' } }] },
      ]),
    ).toThrow(TypeError);
  });
});
