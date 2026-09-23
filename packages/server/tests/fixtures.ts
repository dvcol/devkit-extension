import {
  defineAction,
  defineActionContribution,
  defineCapability,
  defineOperation,
  definePlugin,
  defineService,
} from '@devkit/core';
import type {
  BindingContext,
  CapabilityDescriptor,
  CapabilityResolution,
  InstallationResult,
  NativeContextAccess,
} from '@devkit/core';
import { z } from 'zod';

import { devframeHubContext, serverExecution } from '../src/index.js';

const increment = defineOperation({ input: z.number(), output: z.number(), target: 'none' });
export const counterCapability = defineCapability({
  id: 'example.counter',
  version: 1,
  operations: { increment },
});
export const incrementAction = defineAction({
  id: 'example.increment',
  version: 1,
  operation: increment,
});
export const counterService = defineService(counterCapability, {
  id: 'example.counter-service',
  execution: serverExecution,
  async setup({ native, scope }) {
    const context = native.get(devframeHubContext);
    if (context === undefined) throw new Error('Hub context is absent');
    const state = await context.rpc.sharedState.get<{ value: number }>('example:counter', {
      initialValue: { value: 0 },
    });
    const command = context.commands.register({
      id: 'example:counter',
      title: 'Read counter',
      handler: () => state.value().value,
    });
    scope.onDispose(() => {
      command.unregister();
    });
    return {
      increment(amount) {
        state.mutate((current) => {
          current.value += amount;
        });
        return state.value().value;
      },
    };
  },
});
export const counterPlugin = definePlugin({
  id: 'example.counter-plugin',
  actions: [
    defineActionContribution(incrementAction, {
      id: 'example.increment-contribution',
      execution: serverExecution,
      requires: { counter: counterCapability },
      handler: ({ input, services, signal }) => services.counter.api.increment(input, { signal }),
    }),
  ],
});

export function admitted(result: InstallationResult | undefined) {
  if (result?.status !== 'admitted') throw new Error('Expected admitted installation');
  return result.handle;
}

export function available<Capability extends CapabilityDescriptor>(
  resolution: CapabilityResolution<Capability>,
) {
  if (resolution.status !== 'available') throw new Error('Expected available capability');
  return resolution.binding;
}

export function localContext(context: BindingContext) {
  if (context.access !== 'local') throw new Error('Expected local binding');
  return context;
}

export function requireHub(native: NativeContextAccess) {
  const context = native.get(devframeHubContext);
  if (context === undefined) throw new Error('Missing hub');
  return context;
}

export function deferred() {
  let complete: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  if (complete === undefined) throw new Error('Missing resolver');
  return { promise, resolve: complete };
}
