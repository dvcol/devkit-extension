import {
  defineAction,
  defineExecution,
  defineNativeContext,
  definePlugin,
  defineRealm,
  defineService,
} from '@devkit/core';
import type { NativeContextAccess, NativeContextDescriptor } from '@devkit/core';

import { counterCapability, increaseCounterAction } from './contracts.js';
import type { MemoryCounter } from './counter-source.js';

export { MemoryCounter } from './counter-source.js';

export const exampleExecution = defineExecution({ id: 'example.local-provider' });
/** Stable host configuration; each backend owner supplies its own incarnation at startup. */
export const exampleProvider = {
  id: 'example.provider',
  realm: defineRealm({ id: 'example.local' }),
};
export const counterSourceContext = defineNativeContext<MemoryCounter>({
  id: 'example.counter-source',
});

/** The local registry pairs this imported descriptor with its declared resource type. */
export function counterNativeAccess(source: MemoryCounter): NativeContextAccess {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    if (descriptor.id === counterSourceContext.id) return source;
    return undefined;
  }
  return { get };
}

export const counterService = defineService({
  capability: counterCapability,
  id: 'example.counter-service',
  execution: exampleExecution,
  setup({ native, scope }) {
    const source = native.get(counterSourceContext);
    if (source === undefined) throw new Error('Counter source is unavailable in this execution');
    let currentValue = source.read();
    scope.onDispose(
      source.subscribe((value) => {
        currentValue = value;
      }),
    );
    return {
      read: () => currentValue,
      increase: ({ amount }) => source.increase(amount),
    };
  },
});

export const counterActionsPlugin = definePlugin({
  id: 'example.counter-actions',
  actions: [
    defineAction({
      contract: increaseCounterAction,
      id: 'example.increase-counter',
      execution: exampleExecution,
      requires: { counter: counterCapability },
      handler({ input, services, signal }) {
        return services.counter.api.increase(input, { signal });
      },
    }),
  ],
});
