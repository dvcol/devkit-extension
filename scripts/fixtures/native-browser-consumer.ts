export const nativeBrowserConsumer = `
import { defineAction, defineActionContract, defineExecution, defineOperation, definePlugin, defineRealm } from '@devkit/core';
import { createClient } from '@devkit/client';
import { createRpcProvider } from '@devkit/devframe';
import type { ProviderRpc } from '@devkit/devframe';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { createPortChannel } from '@devkit/webext';
import type { RuntimePort } from '@devkit/webext';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import { createRpcServer } from 'devframe/rpc/server';
import type { DevframeRpcClientFunctions, DevframeRpcServerFunctions, RpcFunctionsHost } from 'devframe/types';
import type { RpcClientEvents } from 'devframe/client';
import { createEventEmitter } from 'devframe/utils/events';
import { z } from 'zod';

const realm = defineRealm({ id: 'webext' });
const execution = defineExecution({ id: 'consumer.worker' });
export const action = defineActionContract({
  id: 'consumer.increment', version: 1,
  operation: defineOperation({ input: z.number().int(), output: z.number().int() }),
});

/** Adapt an actual MessagePort; production Port serialization still runs on both peers. */
function runtimePort(messagePort: MessagePort): RuntimePort {
  const listeners = new Map<(message: unknown) => void, (event: MessageEvent<unknown>) => void>();
  messagePort.start();
  return {
    postMessage: (message) => messagePort.postMessage(message),
    onMessage: {
      addListener(listener) {
        const receive = (event: MessageEvent<unknown>) => listener(event.data);
        listeners.set(listener, receive);
        messagePort.addEventListener('message', receive);
      },
      removeListener(listener) {
        const receive = listeners.get(listener);
        if (receive !== undefined) messagePort.removeEventListener('message', receive);
        listeners.delete(listener);
      },
    },
    onDisconnect: { addListener() {}, removeListener() {} },
  };
}

export async function runConsumer(): Promise<number> {
  if (typeof createDevframeProviderConnection !== 'function') throw new Error('Missing server client export');
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const group = createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>(collector.functions);
  const broadcast: RpcFunctionsHost['broadcast'] = async (options) => {
    await Promise.all(group.clients.map((client) => client.$callRaw({ ...options, optional: true, event: true })));
  };
  const host: ProviderRpc<undefined> = {
    register: collector.register.bind(collector), has: collector.has.bind(collector), broadcast,
  };
  const provider = await createRpcProvider({
    context: { rpc: host, realm, execution, native: { get(): undefined {} } },
    providerId: 'consumer.worker',
    plugins: [definePlugin({ id: 'consumer.plugin', actions: [defineAction({
      id: 'consumer.action', contract: action, execution, handler: ({ input }) => input + 1,
    })] })],
    expose: { actions: [action] },
  });
  const messages = new MessageChannel();
  const clientCollector = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
  const events = createEventEmitter<RpcClientEvents>();
  const rpc = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(clientCollector.functions, {
    channel: createPortChannel({ port: runtimePort(messages.port1), onDisconnect() {} }),
  });
  group.updateChannels((channels) => channels.push({
    ...createPortChannel({ port: runtimePort(messages.port2), onDisconnect() {} }), meta: {},
  }));
  try {
    const connection = await createRpcProviderConnection({
      rpc: { call: rpc.$call, client: clientCollector, events }, realm, providerId: provider.provider.id,
    });
    const client = createClient({ connections: [connection] });
    try {
      const value: number = await client.actions.invoke({ action, input: 41, routing: { realm: realm.id } });
      const outcomes = await client.actions.broadcast({ action, input: 0, selection: [{ realm: realm.id }] });
      if (outcomes.length !== 1 || outcomes[0]?.status !== 'fulfilled' || outcomes[0].value !== 1)
        throw new Error('Packed native broadcast failed');
      return value;
    } finally {
      client.dispose();
      connection.dispose();
    }
  } finally {
    rpc.$close();
    for (const peer of group.clients) peer.$close();
    messages.port1.close();
    messages.port2.close();
    await provider.dispose();
  }
}

export function negativeTypes(client: ReturnType<typeof createClient>): void {
  // @ts-expect-error The packed contract must preserve numeric action input.
  void client.actions.invoke({ action, input: 'invalid' });
  // @ts-expect-error Route selectors must keep the mandatory realm.
  void client.actions.invoke({ action, input: 1, routing: { provider: 'consumer.worker' } });
}
`;
