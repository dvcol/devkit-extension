import { defineActionContract, defineCapability } from '@devkit/core';
import { describe, expect, it } from 'vitest';

import { invokeExposed } from './exposure-fixtures.js';

import { createDevframeProvider } from '../src/index.js';
import { counterCapability, counterService, incrementAction } from './fixtures.js';
import { createDevframeHost } from './host-fixtures.js';

const catalogName = 'devkit:["example.remote","catalog"]';
const actionMethod = 'devkit:["example.remote","action","example.increment",1]';
const composition = {
  providerId: 'example.remote',
  services: [counterService],
  expose: { actions: [incrementAction] },
};

describe('native exposure startup boundaries', () => {
  it('preflights foreign collisions and duplicate descriptors without publishing a partial list', async () => {
    expect.assertions(5);
    const host = await createDevframeHost();
    const foreign = { name: actionMethod, handler: () => 'foreign' };
    host.context.rpc.register(foreign);
    await expect(createDevframeProvider({ context: host.context, ...composition })).rejects.toThrow(
      /already registered/u,
    );
    expect(host.context.rpc.get(actionMethod)).toBe(foreign);
    expect(host.context.commands.commands.has('example:counter')).toBe(false);
    await expect(
      createDevframeProvider({
        context: host.context,
        ...composition,
        expose: { capabilities: [counterCapability], actions: [incrementAction, incrementAction] },
      }),
    ).rejects.toThrow(/Duplicate exposed/u);
    expect(host.context.rpc.list().filter((name) => name.startsWith('devkit:'))).toEqual([
      actionMethod,
    ]);
  });

  it('requires a new host when replacing the finite exposure contract set', async () => {
    expect.assertions(3);
    const host = await createDevframeHost();
    const provider = await createDevframeProvider({ context: host.context, ...composition });
    await provider.dispose();
    await expect(
      createDevframeProvider({
        context: host.context,
        ...composition,
        expose: { capabilities: [counterCapability] },
      }),
    ).rejects.toThrow(/fixed for this native host/u);
    expect(host.context.rpc.list().filter((name) => name.startsWith('devkit:'))).toEqual([
      catalogName,
      actionMethod,
    ]);
    await expect(
      invokeExposed(host.context, actionMethod, provider.provider.incarnation, 1),
    ).rejects.toThrow(/unavailable/u);
  });

  it('leaves retained native methods unavailable when an observer throws after insertion', async () => {
    expect.assertions(5);
    const host = await createDevframeHost();
    const unsubscribe = host.context.rpc.onChanged(() => {
      throw new Error('observer failed');
    });
    await expect(createDevframeProvider({ context: host.context, ...composition })).rejects.toThrow(
      /retained methods are unavailable/u,
    );
    unsubscribe();
    expect(host.context.rpc.has(catalogName)).toBe(true);
    expect(host.context.commands.commands.has('example:counter')).toBe(false);
    await expect(invokeExposed(host.context, catalogName)).resolves.toBeUndefined();
    await expect(createDevframeProvider({ context: host.context, ...composition })).rejects.toThrow(
      /blocked after registration failure/u,
    );
  });

  it('encodes arbitrary identifiers without delimiter collisions', async () => {
    expect.assertions(2);
    const host = await createDevframeHost();
    const first = defineActionContract({
      id: 'counter:1',
      version: 2,
      operation: incrementAction.operation,
    });
    const second = defineActionContract({
      id: 'counter',
      version: 12,
      operation: incrementAction.operation,
    });
    const provider = await createDevframeProvider({
      context: host.context,
      providerId: 'provider:"/😀',
      expose: { actions: [first, second] },
    });
    const names = host.context.rpc.list().filter((name) => name.startsWith('devkit:'));
    expect(new Set(names).size).toBe(3);
    expect(names.map((name) => JSON.parse(name.slice('devkit:'.length)) as unknown)).toEqual([
      ['provider:"/😀', 'catalog'],
      ['provider:"/😀', 'action', 'counter:1', 2],
      ['provider:"/😀', 'action', 'counter', 12],
    ]);
    await provider.dispose();
  });

  it('keeps catalog ownership fixed even when exposed capabilities have no methods', async () => {
    expect.assertions(2);
    const host = await createDevframeHost();
    const capability = defineCapability({ id: 'empty', version: 1, operations: {} });
    const provider = await createDevframeProvider({
      context: host.context,
      providerId: 'first',
      expose: { capabilities: [capability] },
    });
    await provider.dispose();
    await expect(
      createDevframeProvider({
        context: host.context,
        providerId: 'second',
        expose: { capabilities: [capability] },
      }),
    ).rejects.toThrow(/fixed for this native host/u);
    await expect(
      createDevframeProvider({ context: host.context, providerId: 'first', expose: {} }),
    ).rejects.toThrow(/fixed for this native host/u);
  });
});
