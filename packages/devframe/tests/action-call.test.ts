import { createClient } from '@devkit/client';
import { defineAction, defineActionContract, defineOperation, definePlugin } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createRpcClient } from 'devframe/rpc/client';
import type { DevframeRpcClientFunctions, DevframeRpcServerFunctions } from 'devframe/types';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { createActionCall } from '../src/client/index.js';
import type { ActionBinding } from '../src/client/index.js';

const action = defineActionContract({
  id: 'test.matching',
  version: 1,
  operation: defineOperation({ input: z.string(), output: z.string() }),
});
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

async function backend(
  id: string,
  realm: string,
  handler: (input: string) => string | Promise<string>,
) {
  const execution = { id: 'test.local' };
  const runtime = createProviderLifecycle({
    provider: { id, realm: { id: realm }, incarnation: `${id}.1` },
    execution,
    native: { get(): undefined {} },
    report() {},
  });
  cleanup.push(() => runtime.dispose());
  await runtime.plugins.install(
    definePlugin({
      id: 'test.actions',
      actions: [
        defineAction({
          id: 'test.handler',
          execution,
          contract: action,
          handler: ({ input }) => handler(input),
        }),
      ],
    }),
  );
  return {
    provider: runtime.catalog.snapshot().provider,
    catalog: runtime.catalog,
    invoke: runtime.invoke.bind(runtime),
    resolve: runtime.resolve.bind(runtime),
  };
}

function nativeRpc() {
  const channel = new MessageChannel();
  const functions = { 'test:native': (first: string, second: number) => `${first}:${second}` };
  const server = createRpcClient<object, typeof functions>(functions, {
    channel: {
      post: (message: unknown) => {
        channel.port1.postMessage(message);
      },
      on: (listener) => {
        channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
          listener(event.data);
        });
        channel.port1.start();
      },
    },
  });
  const client = createRpcClient<DevframeRpcServerFunctions, DevframeRpcClientFunctions>(
    new RpcFunctionsCollectorBase<DevframeRpcClientFunctions, undefined>(undefined).functions,
    {
      channel: {
        post: (message: unknown) => {
          channel.port2.postMessage(message);
        },
        on: (listener) => {
          channel.port2.addEventListener('message', (event: MessageEvent<unknown>) => {
            listener(event.data);
          });
          channel.port2.start();
        },
      },
    },
  );
  cleanup.push(() => {
    client.$close();
    server.$close();
    channel.port1.close();
    channel.port2.close();
  });
  return { call: client.$call };
}

async function callUnknown(
  call: ReturnType<typeof createActionCall>,
  method: string,
  ...parameters: readonly unknown[]
): Promise<unknown> {
  const value: unknown = await Reflect.apply(call, undefined, [method, ...parameters]);
  return value;
}

it('broadcasts through the router while each provider owns applicability and failures', async () => {
  expect.assertions(4);
  const calls: string[] = [];
  const first = await backend('first', 'devserver', (input) => {
    calls.push(`first:${input}`);
    return 'applied';
  });
  const second = await backend('second', 'devserver', () => 'not-applicable');
  const third = await backend('third', 'devserver', () => {
    throw new Error('Provider failure');
  });
  const excluded = await backend('excluded', 'webext', (input) => {
    calls.push(`excluded:${input}`);
    return 'unexpected';
  });
  const client = createClient({ connections: [first, second, third, excluded] });
  cleanup.push(() => {
    client.dispose();
  });
  const call = createActionCall({
    rpc: nativeRpc(),
    actions: client.actions,
    bindings: [{ action, selection: [{ realm: 'devserver' }] }],
  });
  await expect(callUnknown(call, action.id, 'app.example.test')).resolves.toMatchObject([
    { provider: { id: 'first' }, status: 'fulfilled', value: 'applied' },
    { provider: { id: 'second' }, status: 'fulfilled', value: 'not-applicable' },
    { provider: { id: 'third' }, status: 'rejected', reason: { code: 'operation-failed' } },
  ]);
  expect(calls).toEqual(['first:app.example.test']);
  await expect(callUnknown(call, action.id, 42)).resolves.toMatchObject([
    { status: 'rejected' },
    { status: 'rejected' },
    { status: 'rejected' },
  ]);
  expect(calls).toEqual(['first:app.example.test']);
});

it('preserves native calls and arguments while invoking a selected portable action', async () => {
  expect.assertions(3);
  const connection = await backend('only', 'webext', (input) => input);
  const client = createClient({ connections: [connection] });
  cleanup.push(() => {
    client.dispose();
  });
  const call = createActionCall({
    rpc: nativeRpc(),
    actions: client.actions,
    bindings: [{ action, routing: { realm: 'webext', provider: 'only' } }],
  });
  await expect(callUnknown(call, 'test:native', 'native', 42)).resolves.toBe('native:42');
  await expect(callUnknown(call, action.id, 'portable')).resolves.toBe('portable');
  await expect(callUnknown(call, 'missing:method', {})).rejects.toThrow(/not found/u);
});

it('uses contract routing defaults, binding overrides and independent broadcast selection', async () => {
  expect.assertions(5);
  const extensionFirst = await backend('first', 'webext', (input) => `webext:first:${input}`);
  const extensionSecond = await backend('second', 'webext', (input) => `webext:second:${input}`);
  const serverFirst = await backend('first', 'devserver', (input) => `devserver:first:${input}`);
  const serverSecond = await backend('second', 'devserver', (input) => `devserver:second:${input}`);
  const client = createClient({
    connections: [extensionFirst, extensionSecond, serverFirst, serverSecond],
    routing: { realm: 'devserver', provider: 'second' },
  });
  cleanup.push(() => {
    client.dispose();
  });
  const routed = defineActionContract({
    id: action.id,
    version: action.version,
    operation: action.operation,
    routing: { realm: 'webext', provider: 'first' },
  });
  const options = { rpc: nativeRpc(), actions: client.actions };
  const defaultCall = createActionCall({ ...options, bindings: [{ action: routed }] });
  await expect(callUnknown(defaultCall, action.id, 'default')).resolves.toBe(
    'webext:first:default',
  );
  await expect(callUnknown(defaultCall, 'test:native', 'native', 42)).resolves.toBe('native:42');
  const overrideCall = createActionCall({
    ...options,
    bindings: [{ action: routed, routing: { realm: 'devserver', provider: 'second' } }],
  });
  await expect(callUnknown(overrideCall, action.id, 'override')).resolves.toBe(
    'devserver:second:override',
  );
  const broadcastCall = createActionCall({
    ...options,
    bindings: [{ action: routed, selection: [{ realm: 'devserver' }] }],
  });
  await expect(callUnknown(broadcastCall, action.id, 'broadcast')).resolves.toMatchObject([
    { provider: { id: 'first' }, status: 'fulfilled', value: 'devserver:first:broadcast' },
    { provider: { id: 'second' }, status: 'fulfilled', value: 'devserver:second:broadcast' },
  ]);
  const unavailableCall = createActionCall({
    ...options,
    bindings: [{ action: routed, routing: { realm: 'webext', provider: 'missing' } }],
  });
  await expect(callUnknown(unavailableCall, action.id, 'unavailable')).rejects.toMatchObject({
    code: 'unavailable-provider',
  });
});

it('rejects duplicate IDs, wrong argument counts and unavailable contract versions', async () => {
  expect.assertions(5);
  const connection = await backend('only', 'webext', (input) => input);
  const client = createClient({ connections: [connection] });
  cleanup.push(() => {
    client.dispose();
  });
  const options = { rpc: nativeRpc(), actions: client.actions };
  const successor = defineActionContract({
    id: action.id,
    operation: action.operation,
    version: 2,
  });
  expect(() =>
    createActionCall({ ...options, bindings: [{ action }, { action: successor }] }),
  ).toThrow('Duplicate action binding');
  const call = createActionCall({ ...options, bindings: [{ action }] });
  await expect(callUnknown(call, action.id)).rejects.toThrow('exactly one input');
  await expect(callUnknown(call, action.id, 'one', 'two')).rejects.toThrow('exactly one input');
  const newer = createActionCall({ ...options, bindings: [{ action: successor }] });
  await expect(callUnknown(newer, action.id, 'input')).rejects.toThrow(/available provider/u);
  // @ts-expect-error Broadcast cannot also configure ordinary invocation routing.
  const invalid: ActionBinding = {
    action,
    selection: [{ realm: 'webext' }],
    routing: { realm: 'webext' },
  };
  expect(() => createActionCall({ ...options, bindings: [invalid] })).toThrow(
    'cannot combine selection and routing',
  );
});

it('forwards unmount cancellation without replaying or owning native RPC', async () => {
  expect.assertions(6);
  const started = deferred<void>();
  const released = deferred<string>();
  let executions = 0;
  const connection = await backend('pending', 'webext', () => {
    executions += 1;
    started.resolve();
    return released.promise;
  });
  const client = createClient({ connections: [connection] });
  cleanup.push(() => {
    client.dispose();
  });
  const lifetime = new AbortController();
  const call = createActionCall({
    rpc: nativeRpc(),
    actions: client.actions,
    bindings: [{ action }],
    signal: lifetime.signal,
  });
  const pending = callUnknown(call, action.id, 'input');
  await started.promise;
  lifetime.abort(new Error('View unmounted'));
  released.resolve('completed');
  await expect(pending).rejects.toThrow(/cancel|abort/iu);
  expect(await released.promise).toBe('completed');
  await expect(callUnknown(call, action.id, 'retry')).rejects.toThrow('View unmounted');
  expect(executions).toBe(1);
  await expect(callUnknown(call, 'test:native', 'still alive', 1)).resolves.toBe('still alive:1');
  client.dispose();
  expect(executions).toBe(1);
});

function deferred<Value>() {
  let complete: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  if (complete === undefined) throw new Error('Missing resolver');
  return { promise, resolve: complete };
}
