import { createClient } from '@devkit/client';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { counterStateKey } from '../src/state-key.js';

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

/** Real native clients; location is the browser global expected by the upstream bootstrap. */
async function connect(server: Awaited<ReturnType<typeof host>>) {
  vi.stubGlobal('location', new URL(server.origin));
  const nativeClient = await connectDevframe({
    baseURL: `${server.origin}/__devkit-remote/`,
    connection: { isolated: true },
    authToken: server.token,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
    callTimeout: 3000,
  });
  cleanup.push(() => nativeClient.close?.());
  const connection = await createDevframeProviderConnection({
    rpc: nativeClient,
    providerId: 'example.remote',
  });
  cleanup.push(() => {
    connection.dispose();
  });
  const client = createClient({ connections: [connection] });
  cleanup.push(() => {
    client.dispose();
  });
  const state = await nativeClient.sharedState.get<{ value: number }>(counterStateKey);
  return {
    nativeClient,
    state,
    provider: connection.provider,
    increase: (amount: number) =>
      client.actions.invoke({ action: increaseCounterAction, input: { amount } }),
    close() {
      client.dispose();
      connection.dispose();
      nativeClient.close?.();
    },
  };
}

describe.each(['devframe', 'devtools'] as const)('%s native shared state', (mode) => {
  it('retains native client mutation semantics without implying command-only authority', async () => {
    expect.assertions(2);
    const server = await host(mode);
    const writer = await connect(server);
    const observer = await connect(server);
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
    const first = await connect(firstHost);
    const peer = await connect(firstHost);
    const independent = await connect(secondHost);
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
    const reconnected = await connect(firstHost);
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
