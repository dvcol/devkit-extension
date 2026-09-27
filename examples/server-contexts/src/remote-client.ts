import { createRpcClient } from 'devframe/rpc/client';
import { createWsRpcChannel } from 'devframe/rpc/transports/ws-client';

export const counterActionMethod =
  'devkit:["example.remote","action","example.counter.increase",1]';
export const counterIncreaseMethod =
  'devkit:["example.remote","capability","example.counter",1,"increase"]';
export const counterReadMethod =
  'devkit:["example.remote","capability","example.counter",1,"read"]';

type RemoteCounterFunctions = {
  [counterActionMethod]: (incarnation: string, input: { amount: number }) => Promise<number>;
  [counterIncreaseMethod]: (incarnation: string, input: { amount: number }) => Promise<number>;
  [counterReadMethod]: (incarnation: string, input: Record<string, never>) => Promise<number>;
  'example:counter:pending': () => Promise<string>;
  'example:counter:trusted': () => Promise<boolean>;
};

/** Node's native WebSocket exercises the published channel without browser globals or mocks. */
export function connectRemoteCounter(
  url: string,
  token: string,
): {
  readonly client: ReturnType<typeof createRpcClient<RemoteCounterFunctions>>;
  readonly close: () => Promise<void>;
} {
  const disconnected = Promise.withResolvers<void>();
  const channel = createWsRpcChannel({
    url,
    authToken: token,
    onDisconnected() {
      client.$close();
      disconnected.resolve();
    },
    onError(error) {
      client.$close(error);
    },
  });
  const client = createRpcClient<RemoteCounterFunctions>(
    {},
    {
      channel,
      rpcOptions: { timeout: 5000 },
    },
  );
  return {
    client,
    async close() {
      client.$close();
      channel.close();
      await disconnected.promise;
    },
  };
}
