import type { RpcClientEvents } from 'devframe/client';
import type {
  DevframeRpcClientFunctions,
  DevframeRpcServerFunctions,
  RpcFunctionsHost,
} from 'devframe/types';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import { createRpcServer } from 'devframe/rpc/server';
import {
  createRpcSharedStateClientHost,
  createRpcSharedStateServerHost,
} from 'devframe/rpc/shared-state';
import { createEventEmitter } from 'devframe/utils/events';
import { expect, it } from 'vitest';
import { createPortChannel } from '../src/index';
import { createPortPair } from './port-fixture';

it('keeps native shared-state subscriptions separate across Port peers', async () => {
  expect.assertions(9);
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const group = createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>(
    collector.functions,
  );
  const broadcast: RpcFunctionsHost['broadcast'] = async (options) => {
    const { filter } = options;
    await Promise.all(
      group.clients
        .filter((connection) => filter?.(connection) !== false)
        .map((connection) => connection.$callRaw({ ...options, optional: true, event: true })),
    );
  };
  const state = createRpcSharedStateServerHost({
    register: collector.register.bind(collector),
    broadcast,
  });
  const counter = await state.get('counter', { initialValue: { value: 0 } });
  const peers = [0, 1].map((id) => {
    const pair = createPortPair('json');
    const meta = { id, subscribedStates: new Set<string>() };
    const channel = {
      ...createPortChannel({ port: pair.second.port, onDisconnect: closeServing }),
      meta,
    };
    group.updateChannels((channels) => {
      channels.push(channel);
    });
    const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
    const connection = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
      client.functions,
      {
        channel: createPortChannel({
          port: pair.first.port,
          onDisconnect: () => {
            connection.$close();
          },
        }),
      },
    );
    const sharedState = createRpcSharedStateClientHost({
      call: connection.$call,
      callEvent: connection.$callEvent,
      client,
      events: createEventEmitter<RpcClientEvents>(),
      isTrusted: true,
      connectionMeta: { backend: 'none' },
    });
    function closeServing() {
      group.clients.find((peer) => peer.$meta === meta)?.$close();
      group.updateChannels((channels) => {
        channels.splice(channels.indexOf(channel), 1);
      });
    }
    return { pair, meta, connection, sharedState };
  });
  const first = peers[0]!;
  const second = peers[1]!;
  try {
    const firstCounter = await first.sharedState.get<{ value: number }>('counter');
    expect(first.meta.subscribedStates.has('counter')).toBe(true);
    expect(second.meta.subscribedStates.has('counter')).toBe(false);
    const secondCounter = await second.sharedState.get<{ value: number }>('counter');
    expect(second.meta.subscribedStates.has('counter')).toBe(true);
    firstCounter.mutate((draft) => {
      draft.value = 2;
    });
    await expect.poll(() => counter.value().value).toBe(2);
    await expect.poll(() => secondCounter.value().value).toBe(2);
    first.pair.disconnect();
    secondCounter.mutate((draft) => {
      draft.value = 3;
    });
    await expect.poll(() => counter.value().value).toBe(3);
    expect(firstCounter.value().value).toBe(2);
    expect(group.clients).toHaveLength(1);
    expect(first.pair.first.listenerCount()).toBe(0);
  } finally {
    for (const peer of peers) {
      for (const key of peer.sharedState.keys()) peer.sharedState.delete(key);
      peer.connection.$close();
      peer.pair.disconnect();
    }
    for (const key of state.keys()) state.delete(key);
  }
});

it('rejects an initial state request when its native connection closes', async () => {
  expect.assertions(1);
  const pair = createPortPair('json');
  const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
  const connection = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    client.functions,
    {
      channel: createPortChannel({
        port: pair.first.port,
        onDisconnect: () => {
          connection.$close();
        },
      }),
    },
  );
  const state = createRpcSharedStateClientHost({
    call: connection.$call,
    callEvent: connection.$callEvent,
    client,
    events: createEventEmitter<RpcClientEvents>(),
    isTrusted: true,
    connectionMeta: { backend: 'none' },
  });
  const pending = state.get('pending');
  pair.disconnect();
  await expect(pending).rejects.toThrow('closed');
});
