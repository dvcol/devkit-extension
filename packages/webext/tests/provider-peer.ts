import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import type { createRpcServer } from 'devframe/rpc/server';
import { createEventEmitter } from 'devframe/utils/events';
import type { RpcClientEvents } from 'devframe/client';
import type { DevframeRpcClientFunctions, DevframeRpcServerFunctions } from 'devframe/types';
import { createPortChannel } from '../src/index.js';
import { createPortPair } from './port-fixture.js';

type ServerGroup = ReturnType<
  typeof createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>
>;

export function createProviderPeer({
  group,
  encoding,
}: {
  group: ServerGroup;
  encoding: 'json' | 'clone';
}) {
  const pair = createPortPair(encoding);
  const events = createEventEmitter<RpcClientEvents>();
  const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
  const rpc = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    client.functions,
    {
      channel: createPortChannel({ port: pair.first.port, onDisconnect: disconnected }),
    },
  );
  const meta = {};
  const channel = { ...createPortChannel({ port: pair.second.port, onDisconnect() {} }), meta };
  group.updateChannels((channels) => {
    channels.push(channel);
  });
  function disconnected(): void {
    rpc.$close();
    events.emit('connection:status', 'disconnected', 'connected');
  }
  const close = () => {
    disconnected();
    group.clients.find((connection) => connection.$meta === meta)?.$close();
    group.updateChannels((channels) => {
      const index = channels.indexOf(channel);
      if (index !== -1) channels.splice(index, 1);
    });
    pair.disconnect();
  };
  return { native: { call: rpc.$call, client, events }, close };
}
