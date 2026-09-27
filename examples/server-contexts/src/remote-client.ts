import { createRpcClient } from 'devframe/rpc/client';
import { createWsRpcChannel } from 'devframe/rpc/transports/ws-client';

type RemoteCounterFunctions = {
  'example:counter:increase': (
    incarnation: string,
    input: { amount: number },
  ) => Promise<{ value: number; trusted: boolean }>;
  'example:counter:pending': () => Promise<string>;
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
