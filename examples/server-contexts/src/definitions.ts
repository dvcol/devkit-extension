import { defineActionContribution, definePlugin, defineService } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { devframeHubContext, serverExecution } from '@devkit/server';

export const counterStateKey = 'example:server-counter';
export const readCounterCommandId = 'example:read-server-counter';

/** Both server hosts expose the same native shared-state and command APIs through the hub. */
export const counterService = defineService(counterCapability, {
  id: 'example.server-counter-service',
  execution: serverExecution,
  async setup({ native, scope }) {
    const context = native.get(devframeHubContext);
    if (context === undefined) throw new Error('A Devframe hub context is required');
    const state = await context.rpc.sharedState.get<{ value: number }>(counterStateKey, {
      initialValue: { value: 0 },
    });
    const command = context.commands.register({
      id: readCounterCommandId,
      title: 'Read the server counter',
      handler: () => state.value().value,
    });
    scope.onDispose(() => {
      command.unregister();
    });
    return {
      read: () => state.value().value,
      increase({ amount }) {
        state.mutate((current) => {
          current.value += amount;
        });
        return state.value().value;
      },
    };
  },
});

export const counterActionsPlugin = definePlugin({
  id: 'example.server-counter-actions',
  actions: [
    defineActionContribution(increaseCounterAction, {
      id: 'example.increase-server-counter',
      execution: serverExecution,
      requires: { counter: counterCapability },
      handler({ input, services, signal }) {
        return services.counter.api.increase(input, { signal });
      },
    }),
  ],
});
