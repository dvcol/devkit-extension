import { createRemoteHost } from '@devkit/example-server-contexts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectState } from './state-fixtures.js';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
  vi.unstubAllGlobals();
});

async function host(mode: 'devframe' | 'devtools') {
  const instance = await createRemoteHost(mode);
  cleanup.push(instance.close);
  return instance;
}

describe.each(['devframe', 'devtools'] as const)('%s native shared state', (mode) => {
  it('preserves host state and native observers across portable-provider replacement', async () => {
    expect.assertions(10);
    const server = await host(mode);
    const original = await connectState(server, cleanup);
    const observer = await connectState(server, cleanup);
    await expect(original.increase(3)).resolves.toBe(3);
    await expect.poll(() => observer.state.value().value).toBe(3);

    await server.provider.dispose();
    original.state.mutate((value) => {
      value.value = 7;
    });
    await expect.poll(() => observer.state.value().value).toBe(7);
    const successor = await server.replace();
    expect(successor.provider.incarnation).not.toBe(original.provider.incarnation);
    await expect(original.increase(1)).rejects.toThrow(
      /No currently available provider|unavailable|incarnation/u,
    );

    const reattached = await connectState(server, cleanup);
    expect(reattached.provider.incarnation).toBe(successor.provider.incarnation);
    expect(reattached.state.value().value).toBe(7);
    await expect(reattached.increase(1)).resolves.toBe(8);
    await expect.poll(() => observer.state.value().value).toBe(8);

    const freshHost = await host(mode);
    const freshClient = await connectState(freshHost, cleanup);
    expect(freshClient.state.value().value).toBe(0);
  });

  it('retains native client mutation semantics without implying command-only authority', async () => {
    expect.assertions(2);
    const server = await host(mode);
    const writer = await connectState(server, cleanup);
    const observer = await connectState(server, cleanup);
    writer.state.mutate((value) => {
      value.value = 42;
    });
    await expect.poll(() => observer.state.value().value).toBe(42);
    await expect(observer.increase(1)).resolves.toBe(43);
  });

  it('updates peers, isolates hosts and reads a fresh snapshot on a new connection', async () => {
    expect.assertions(17);
    const firstHost = await host(mode);
    const secondHost = await host(mode);
    const first = await connectState(firstHost, cleanup);
    const peer = await connectState(firstHost, cleanup);
    const independent = await connectState(secondHost, cleanup);
    expect([
      first.state.value().value,
      peer.state.value().value,
      independent.state.value().value,
    ]).toEqual([0, 0, 0]);
    const updates: number[] = [];
    const unsubscribe = peer.state.on('updated', (value) => {
      updates.push(value.value);
    });
    cleanup.push(unsubscribe);
    await expect(first.increase(1)).resolves.toBe(1);
    await expect.poll(() => updates).toEqual([1]);
    await expect.poll(() => first.state.value().value).toBe(1);
    expect(independent.state.value().value).toBe(0);
    unsubscribe();
    await expect(first.increase(2)).resolves.toBe(3);
    await expect.poll(() => peer.state.value().value).toBe(3);
    expect(updates).toEqual([1]);
    peer.close();
    await expect.poll(() => peer.nativeClient.status).not.toBe('connected');
    await expect(first.increase(4)).resolves.toBe(7);
    const reconnected = await connectState(firstHost, cleanup);
    expect(reconnected.state.value().value).toBe(7);
    expect(peer.state.value().value).toBe(3);
    expect(reconnected.provider.incarnation).toBe(first.provider.incarnation);
    await expect(reconnected.increase(1)).resolves.toBe(8);
    await expect.poll(() => first.state.value().value).toBe(8);
    first.close();
    await expect(reconnected.increase(1)).resolves.toBe(9);
    expect(independent.state.value().value).toBe(0);
  });
});
