import {
  defineAction,
  defineExecution,
  definePlugin,
  defineRealm,
  defineService,
} from '@devkit/core';
import type { RealmDescriptor } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import { createRpcProviderConnection } from '@devkit/devframe/client';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcServer } from 'devframe/rpc/server';
import type {
  DevframeRpcClientFunctions,
  DevframeRpcServerFunctions,
  RpcFunctionsHost,
} from 'devframe/types';
import { createProviderPeer } from './provider-peer.js';

const execution = defineExecution({ id: 'test.worker' });
const realm = defineRealm({ id: 'webext' });
const plugin = definePlugin({
  id: 'test.actions',
  actions: [
    defineAction({
      id: 'test.counter-action',
      contract: increaseCounterAction,
      execution,
      requires: { counter: counterCapability },
      handler: ({ input, services, signal }) => services.counter.api.increase(input, { signal }),
    }),
  ],
});

function createHost() {
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const group = createRpcServer<DevframeRpcClientFunctions, DevframeRpcServerFunctions>(
    collector.functions,
  );
  const broadcast: RpcFunctionsHost['broadcast'] = async (options) => {
    await Promise.all(
      group.clients.map((client) => client.$callRaw({ ...options, event: true, optional: true })),
    );
  };
  return {
    group,
    rpc: {
      register: collector.register.bind(collector),
      has: collector.has.bind(collector),
      broadcast,
    },
  };
}

function createCounterService() {
  let value = 0;
  return defineService({
    id: 'test.counter-service',
    capability: counterCapability,
    execution,
    setup: () => ({
      read: () => value,
      increase: ({ amount }) => {
        value += amount;
        return value;
      },
    }),
  });
}

export async function createProviderFixture(providerId: string) {
  const host = createHost();
  const options = {
    context: { rpc: host.rpc, realm, execution, native: { get(): undefined {} } },
    providerId,
    services: [createCounterService()],
    plugins: [plugin],
    expose: { capabilities: [counterCapability], actions: [increaseCounterAction] },
  };
  const provider = await createRpcProvider(options);
  const cleanup: (() => void)[] = [];
  async function connect(encoding: 'json' | 'clone', expectedRealm: RealmDescriptor = realm) {
    const peer = createProviderPeer({ group: host.group, encoding });
    cleanup.push(peer.close);
    const connection = await createRpcProviderConnection({
      rpc: peer.native,
      realm: expectedRealm,
      providerId,
      report() {},
    });
    cleanup.push(() => {
      connection.dispose();
    });
    return { connection, ...peer };
  }
  return {
    provider,
    connect,
    options,
    dispose: async () => {
      for (const release of cleanup.toReversed()) release();
      await provider.dispose();
    },
  };
}
