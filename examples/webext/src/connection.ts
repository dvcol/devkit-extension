import type { RpcClientEvents } from 'devframe/client';
import type { DevframeRpcClientFunctions, DevframeRpcServerFunctions } from 'devframe/types';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import { createRpcSharedStateClientHost } from 'devframe/rpc/shared-state';
import { createEventEmitter } from 'devframe/utils/events';
import { createPortChannel } from '@devkit/webext';

/** The page owns its native Port, RPC client, event emitter and shared-state subscriptions. */
export function createExampleConnection(onDisconnect: () => void) {
  const port = chrome.runtime.connect({ name: 'devkit-native-port-example' });
  const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
  const events = createEventEmitter<RpcClientEvents>();
  const rpc = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    client.functions,
    { channel: createPortChannel({ port, onDisconnect }) },
  );
  const sharedState = createRpcSharedStateClientHost({
    call: rpc.$call,
    callEvent: rpc.$callEvent,
    client,
    events,
    isTrusted: true,
    connectionMeta: { backend: 'none' },
  });

  return { port, client, events, rpc, sharedState };
}
