import type { ProviderConnection } from '@devkit/client';
import { defineActionContract, defineCapability, defineOperation } from '@devkit/core';
import type { ActionClient } from '@devkit/core';
import { createActionCall, createRpcProviderConnection } from '@devkit/devframe/client';
import type {
  ActionBinding,
  ActionCallOptions,
  ProviderRpcClient,
  RpcProviderConnection,
  RpcProviderConnectionOptions,
} from '@devkit/devframe/client';
import type { DevframeRpcClient } from 'devframe/client';
import { z } from 'zod';

const increment = defineOperation({ input: z.number().int(), output: z.number().int() });
const incrementAction = defineActionContract({
  id: 'example.increment',
  version: 1,
  operation: increment,
});
const counterCapability = defineCapability({
  id: 'example.counter',
  version: 1,
  operations: { increment },
});

export function actionBindingTypes(rpc: DevframeRpcClient, actions: ActionClient): void {
  const ordinary: ActionBinding = { action: incrementAction };
  const routed: ActionBinding = {
    action: incrementAction,
    routing: { realm: 'webext', provider: 'example.extension' },
  };
  const broadcast: ActionBinding = {
    action: incrementAction,
    selection: [{ realm: 'devserver' }],
  };
  const options: ActionCallOptions = {
    rpc,
    actions,
    bindings: [ordinary],
    signal: new AbortController().signal,
  };
  createActionCall(options) satisfies DevframeRpcClient['call'];
  createActionCall({ ...options, bindings: [routed] }) satisfies DevframeRpcClient['call'];
  createActionCall({ ...options, bindings: [broadcast] }) satisfies DevframeRpcClient['call'];
  // @ts-expect-error A binding cannot combine ordinary routing with broadcast selection.
  const conflicting: ActionBinding = { ...routed, selection: [{ realm: 'devserver' }] };
  void conflicting;
  const wrongKind: ActionBinding = {
    // @ts-expect-error Bindings require an action contract, not an executable action declaration.
    action: { ...incrementAction, kind: 'action' },
  };
  void wrongKind;
  // @ts-expect-error Action binding dispatch requires the portable action client.
  createActionCall({ rpc, bindings: [ordinary] });
}

export function nativeClientTypes(native: DevframeRpcClient): void {
  native satisfies ProviderRpcClient;
  const minimal: ProviderRpcClient = {
    call: native.call,
    client: native.client,
    events: native.events,
  };
  const options: RpcProviderConnectionOptions = {
    rpc: minimal,
    providerId: 'example.server',
    realm: { id: 'devserver' },
    signal: new AbortController().signal,
  };
  void options;
  // @ts-expect-error A provider client must accept native catalog event registrations.
  const missingCollector: ProviderRpcClient = { call: native.call, events: native.events };
  void missingCollector;
  // @ts-expect-error Connection identity requires a realm as well as a provider ID.
  const missingRealm: RpcProviderConnectionOptions = { rpc: minimal, providerId: 'example' };
  void missingRealm;
}

export async function providerConnectionTypes(native: ProviderRpcClient): Promise<void> {
  const connection: RpcProviderConnection = await createRpcProviderConnection({
    rpc: native,
    providerId: 'example.server',
    realm: { id: 'devserver' },
  });
  connection satisfies ProviderConnection;
  (await connection.invoke({ action: incrementAction, input: 1 })) satisfies number;
  // @ts-expect-error A connection preserves the imported action's numeric input.
  await connection.invoke({ action: incrementAction, input: '1' });
  // @ts-expect-error A connection preserves the imported action's numeric result.
  (await connection.invoke({ action: incrementAction, input: 1 })) satisfies string;
  const resolution = await connection.resolve({ capability: counterCapability });
  if (resolution.status === 'available') {
    (await resolution.binding.api.increment(1)) satisfies number;
    // @ts-expect-error Resolved capability methods preserve their imported input schema.
    await resolution.binding.api.increment('1');
  }
  connection.dispose();
}
