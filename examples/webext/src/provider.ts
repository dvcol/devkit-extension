import {
  defineAction,
  defineExecution,
  defineNativeContext,
  definePlugin,
  defineService,
} from '@devkit/core';
import type { NativeContextDescriptor } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import type { ProviderRpc } from '@devkit/devframe';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import { createMatchingCounterPlugin } from '@devkit/example-contribution/provider';
import { createCounterView } from '@devkit/example-json-render/view';
import { spec } from './spec';
import { registerScriptControls } from './script-contribution';
import { registerHeaderControls } from './header-contribution';
import { registerRedirectControls } from './redirect-contribution';
import {
  counterCapability,
  counterStateKey,
  increaseCounterAction,
  increaseMatchingCounterAction,
  providerId,
  realm,
} from './contracts';

const execution = defineExecution({ id: 'example.background' });
const viewContext = defineNativeContext<JsonRenderViewContext>({
  id: 'example.extension.view-context',
});

const counterService = defineService({
  id: 'example.extension.counter',
  capability: counterCapability,
  execution,
  async setup({ native }) {
    const context = native.get(viewContext);
    if (context === undefined) throw new Error('The native shared-state context is required');
    const state = await context.rpc.sharedState.get<{ value: number }>(counterStateKey);
    return {
      read: () => state.value().value,
      increase({ amount }) {
        state.mutate((counter) => {
          counter.value += amount;
        });
        return state.value().value;
      },
    };
  },
});
const counterPlugin = definePlugin({
  id: 'example.extension.actions',
  actions: [
    defineAction({
      id: 'example.extension.increase',
      contract: increaseCounterAction,
      execution,
      requires: { counter: counterCapability },
      handler: ({ input, services, signal }) => services.counter.api.increase(input, { signal }),
    }),
  ],
});

export function createExampleProvider(options: {
  rpc: ProviderRpc<undefined>;
  viewContext: JsonRenderViewContext;
}) {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    if (descriptor.id === viewContext.id) return options.viewContext;
    return undefined;
  }
  const provider = createRpcProvider({
    context: { rpc: options.rpc, realm, execution, native: { get } },
    providerId,
    services: [counterService],
    plugins: [
      counterPlugin,
      createMatchingCounterPlugin({
        execution,
        domains: ['shared.example.test', 'deployed.example.test'],
      }),
      definePlugin({
        id: 'example.extension.views',
        views: [
          createCounterView({ execution, nativeContext: viewContext, scope: 'global', spec }),
        ],
      }),
    ],
    expose: {
      actions: [increaseCounterAction, increaseMatchingCounterAction],
      capabilities: [counterCapability],
    },
  });
  registerScriptControls({ rpc: options.rpc, provider });
  registerHeaderControls({ rpc: options.rpc, provider });
  registerRedirectControls({ rpc: options.rpc, provider });
  return provider;
}
