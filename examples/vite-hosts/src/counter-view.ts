import { definePlugin } from '@devkit/core';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createCounterView } from '@devkit/example-json-render/view';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';

export const counterViewPlugin = definePlugin({
  id: 'example.counter-view',
  views: [
    createCounterView({
      execution: serverExecution,
      nativeContext: devframeHubContext,
      actionName: increaseCounterAction.id,
    }),
  ],
});

/** This example requires its view at startup; admitted setup failures remain observable. */
export function assertCounterViewReady(provider: ServerProviderHandle): void {
  const view = provider.startup.plugins.find(
    (installation) => installation.snapshot().id === counterViewPlugin.id,
  );
  if (view?.snapshot().status !== 'ready')
    throw new Error('The counter view contribution did not activate');
}
