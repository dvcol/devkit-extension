import {
  defineAction,
  defineActionContract,
  defineExecution,
  defineOperation,
  definePlugin,
  defineRealm,
} from '@devkit/core';
import { RpcFunctionsCollectorBase, getRpcHandler } from 'devframe/rpc';
import type {
  DevframeRpcClientFunctions,
  DevframeRpcServerFunctions,
  RpcFunctionsHost,
} from 'devframe/types';
import type { RpcClientEvents } from 'devframe/client';
import { createRpcClient } from 'devframe/rpc/client';
import { createEventEmitter } from 'devframe/utils/events';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createRpcProvider } from '../src/index.js';
import type { ProviderRpc } from '../src/index.js';
import type { ProviderRpcClient } from '../src/client/index.js';

const execution = defineExecution({ id: 'test.worker' });
const broadcast: RpcFunctionsHost['broadcast'] = async () => {};
const contract = defineActionContract({
  id: 'test.increment',
  version: 1,
  operation: defineOperation({ input: z.number().int(), output: z.number().int() }),
});

it('uses the native collector for schemas, finite exposure and provider incarnation', async () => {
  expect.assertions(8);
  const collector = new RpcFunctionsCollectorBase<DevframeRpcServerFunctions, undefined>(undefined);
  const rpc: ProviderRpc<undefined> = {
    register: collector.register.bind(collector),
    has: collector.has.bind(collector),
    broadcast,
  };
  const context = {
    rpc,
    realm: defineRealm({ id: 'webext' }),
    execution,
    native: { get(): undefined {} },
  };
  const action = defineAction({
    id: 'test.action',
    contract,
    execution,
    handler: ({ input }) => input + 1,
  });
  const options = {
    context,
    providerId: 'test.worker',
    plugins: [definePlugin({ id: 'test.plugin', actions: [action] })],
    expose: { actions: [contract] },
  };
  const provider = await createRpcProvider(options);
  const definition = collector.get('devkit:["test.worker","action","test.increment",1]')!;
  const handler = await getRpcHandler(definition, collector.context);
  expect(provider.provider.realm.id).toBe('webext');
  await expect(handler(provider.provider.incarnation, 2)).resolves.toBe(3);
  await expect(handler(provider.provider.incarnation, 'invalid')).rejects.toThrow(
    /invalid argument/u,
  );
  await expect(handler('stale', 2)).rejects.toThrow(/incarnation/u);
  await expect(createRpcProvider(options)).rejects.toThrow(/already owns/u);
  await provider.dispose();
  await expect(handler(provider.provider.incarnation, 2)).rejects.toThrow(/unavailable/u);
  const replacement = await createRpcProvider(options);
  expect(replacement.provider.incarnation).not.toBe(provider.provider.incarnation);
  await expect(handler(replacement.provider.incarnation, 2)).resolves.toBe(3);
  await replacement.dispose();
});

it('accepts raw native client members without inventing a full server client', () => {
  expect.assertions(1);
  const client = new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined);
  const rpc = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    client.functions,
    { channel: { post() {}, on() {} } },
  );
  const native: ProviderRpcClient<undefined> = {
    call: rpc.$call,
    client,
    events: createEventEmitter<RpcClientEvents>(),
  };
  expect(native.call).toBe(rpc.$call);
  rpc.$close();
});
