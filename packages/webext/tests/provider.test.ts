import { createClient } from '@devkit/client';
import type { CapabilityResolution } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderFixture } from './provider-fixture.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

describe.each(['json', 'clone'] as const)('portable provider through %s Ports', (encoding) => {
  it('routes shared contracts, follows catalog lifecycle and retains independent client ownership', async () => {
    expect.assertions(12);
    const first = await createProviderFixture('first');
    const second = await createProviderFixture('second');
    cleanup.push(first.dispose, second.dispose);
    const firstPeer = await first.connect(encoding);
    const secondPeer = await second.connect(encoding);
    const independentPeer = await first.connect(encoding);
    const client = createClient({ connections: [firstPeer.connection, secondPeer.connection] });
    cleanup.push(() => {
      client.dispose();
    });
    await expect(
      client.actions.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    ).rejects.toMatchObject({ code: 'ambiguous-provider' });
    await expect(
      client.actions.invoke({
        action: increaseCounterAction,
        input: { amount: 2 },
        routing: { realm: 'webext', provider: 'first' },
      }),
    ).resolves.toBe(2);
    const outcomes = await client.actions.broadcast({
      action: increaseCounterAction,
      input: { amount: 3 },
      selection: [{ realm: 'webext' }],
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const resolved = await independentPeer.connection.resolve({ capability: counterCapability });
    expect(resolved.status).toBe('available');
    const binding = available(resolved);
    expect(binding.context.access).toBe('remote');
    expect('native' in binding.context).toBe(false);
    await expect(binding.api.read({})).resolves.toBe(5);
    await first.provider.startup.services[0]!.disable();
    await vi.waitUntil(
      () => firstPeer.connection.catalog.snapshot()?.capabilities[0]?.status === 'disabled',
    );
    await expect(binding.api.increase({ amount: 1 })).rejects.toThrow(/unavailable/u);
    await first.provider.startup.services[0]!.enable();
    await vi.waitUntil(
      () => independentPeer.connection.catalog.snapshot()?.capabilities[0]?.status === 'active',
    );
    firstPeer.close();
    expect(firstPeer.connection.catalog.snapshot()).toBeUndefined();
    await expect(binding.api.increase({ amount: 1 })).resolves.toBe(6);
    client.dispose();
    const fresh = await first.connect(encoding);
    expect(fresh.connection.provider).toEqual(independentPeer.connection.provider);
    await expect(
      fresh.connection.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    ).resolves.toBe(7);
  });

  it('rejects the wrong realm and invalidates old attachments on provider replacement', async () => {
    expect.assertions(5);
    const host = await createProviderFixture('worker');
    cleanup.push(host.dispose);
    await expect(host.connect(encoding, { id: 'other' })).rejects.toThrow(/different provider/u);
    const old = await host.connect(encoding);
    await host.provider.dispose();
    const successor = await createRpcProvider(host.options);
    cleanup.push(() => successor.dispose());
    await vi.waitUntil(() => old.connection.catalog.snapshot() === undefined);
    await expect(
      old.connection.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    ).rejects.toThrow(/unavailable|incarnation/u);
    const fresh = await host.connect(encoding);
    expect(fresh.connection.provider.incarnation).not.toBe(old.connection.provider.incarnation);
    await expect(
      fresh.connection.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    ).resolves.toBe(1);
    expect(fresh.connection.provider.realm.id).toBe('webext');
  });
});

function available(resolution: CapabilityResolution<typeof counterCapability>) {
  if (resolution.status !== 'available') throw new Error('Counter should be available');
  return resolution.binding;
}
