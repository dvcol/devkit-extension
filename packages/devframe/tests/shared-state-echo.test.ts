import { MessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
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
import { createSharedState } from 'devframe/utils/shared-state';
import type { SharedState } from 'devframe/utils/shared-state';
import { expect, it } from 'vitest';

function createChannel(port: MessagePort) {
  return {
    post: (message: unknown) => {
      port.postMessage(message);
    },
    on: (listener: (message: unknown) => void) => port.on('message', listener),
    off: (listener: (message: unknown) => void) => port.off('message', listener),
  };
}

/** Delay genuine native writes at the MessagePort boundary until same-key republication. */
function createConnection() {
  const ports = new MessageChannel();
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const group = createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>(
    collector.functions,
  );
  const serverChannel = {
    ...createChannel(ports.port2),
    meta: { subscribedStates: new Set<string>() },
  };
  group.updateChannels((channels) => {
    channels.push(serverChannel);
  });
  const broadcast: RpcFunctionsHost['broadcast'] = async (options) => {
    const { filter } = options;
    await Promise.all(
      group.clients
        .filter((connection) => filter?.(connection) !== false)
        .map((connection) => connection.$callRaw({ ...options, optional: true, event: true })),
    );
  };
  const server = createRpcSharedStateServerHost({
    register: collector.register.bind(collector),
    broadcast,
  });
  const pendingWrites: unknown[] = [];
  let holdWrites = false;
  const clientFunctions = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(
    undefined,
  );
  const connection = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    clientFunctions.functions,
    {
      channel: {
        ...createChannel(ports.port1),
        post: (message: unknown) => {
          if (holdWrites) {
            pendingWrites.push(message);
            return;
          }
          ports.port1.postMessage(message);
        },
      },
    },
  );
  const client = createRpcSharedStateClientHost({
    call: connection.$call,
    callEvent: connection.$callEvent,
    client: clientFunctions,
    events: createEventEmitter<RpcClientEvents>(),
    isTrusted: true,
    connectionMeta: { backend: 'none' },
  });
  return {
    server,
    client,
    holdWrites() {
      holdWrites = true;
    },
    resumeWrites() {
      holdWrites = false;
    },
    async flushWrites() {
      for (const message of pendingWrites.splice(0)) ports.port1.postMessage(message);
      /** The request follows all released writes on the same ordered MessagePort. */
      const snapshot: unknown = await connection.$call('devframe:rpc:server-state:get', 'counter');
      return snapshot;
    },
    dispose() {
      for (const key of client.keys()) client.delete(key);
      for (const key of server.keys()) server.delete(key);
      connection.$close();
      for (const peer of group.clients) peer.$close();
      ports.port1.close();
      ports.port2.close();
    },
  };
}

function writeDuringUpdate(state: SharedState<{ count: number }>) {
  const stop = state.on('updated', (snapshot) => {
    if (snapshot.count !== 8) return;
    stop();
    state.mutate((draft) => {
      draft.count = 9;
    });
  });
}

for (const { name, enablePatches } of [
  { name: 'full snapshots', enablePatches: false },
  { name: 'patches', enablePatches: true },
]) {
  it(`does not echo native ${name} into a replacement state across delayed I/O`, async () => {
    expect.assertions(8);
    const connection = createConnection();
    try {
      const original = await connection.server.get('counter', {
        sharedState: createSharedState({ initialValue: { count: 0 }, enablePatches }),
      });
      const initialClient = await connection.client.get<{ count: number }>('counter');
      connection.holdWrites();
      original.mutate((draft) => {
        draft.count = 5;
      });
      await expect.poll(() => initialClient.value()).toEqual({ count: 5 });
      connection.resumeWrites();
      connection.server.delete('counter');
      connection.client.delete('counter');
      const replacement = await connection.server.get('counter', {
        sharedState: createSharedState({ initialValue: { count: 6 }, enablePatches }),
      });
      const client = await connection.client.get<{ count: number }>('counter');
      expect(replacement.value()).toEqual({ count: 6 });
      expect(await connection.flushWrites()).toEqual({ count: 6 });
      expect(replacement.value()).toEqual({ count: 6 });
      expect(client.value()).toEqual({ count: 6 });

      client.mutate((draft) => {
        draft.count = 7;
      });
      await expect.poll(() => replacement.value()).toEqual({ count: 7 });
      writeDuringUpdate(client);
      replacement.mutate((draft) => {
        draft.count = 8;
      });
      await expect.poll(() => client.value()).toEqual({ count: 9 });
      await expect.poll(() => replacement.value()).toEqual({ count: 9 });
    } finally {
      connection.dispose();
    }
  });
}

it('propagates a native callback write to another key with the received sync ID', async () => {
  expect.assertions(3);
  const connection = createConnection();
  try {
    const original = await connection.server.get('source', { initialValue: { count: 0 } });
    const derived = await connection.server.get('derived', { initialValue: { count: 0 } });
    const sourceClient = await connection.client.get<{ count: number }>('source');
    const derivedClient = await connection.client.get<{ count: number }>('derived');
    sourceClient.on('updated', (snapshot, _patches, syncId) => {
      derivedClient.mutate((draft) => {
        draft.count = snapshot.count;
      }, syncId);
    });
    original.mutate((draft) => {
      draft.count = 5;
    });
    await expect.poll(() => derivedClient.value()).toEqual({ count: 5 });
    await expect.poll(() => derived.value()).toEqual({ count: 5 });
    expect(original.value()).toEqual({ count: 5 });
  } finally {
    connection.dispose();
  }
});
