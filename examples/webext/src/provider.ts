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
import type { createJsonRenderView } from '@devframes/json-render/view';
import { counterCapability, increaseCounterAction, providerId, realm } from './contracts';

const execution = defineExecution({ id: 'example.background' });
const counterView = defineNativeContext<ReturnType<typeof createJsonRenderView>>({
  id: 'example.counter-view',
});

const counterService = defineService({
  id: 'example.extension.counter',
  capability: counterCapability,
  execution,
  setup({ native }) {
    const view = native.get(counterView);
    if (view === undefined) throw new Error('The native counter view is required');
    return {
      read: () => Number(view.value().state?.value),
      increase({ amount }) {
        const value = Number(view.value().state?.value) + amount;
        view.patchState([{ op: 'replace', path: '/value', value }]);
        return value;
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
  view: ReturnType<typeof createJsonRenderView>;
}) {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    if (descriptor.id === counterView.id) return options.view;
    return undefined;
  }
  return createRpcProvider({
    context: { rpc: options.rpc, realm, execution, native: { get } },
    providerId,
    services: [counterService],
    plugins: [counterPlugin],
    expose: { actions: [increaseCounterAction], capabilities: [counterCapability] },
  });
}
