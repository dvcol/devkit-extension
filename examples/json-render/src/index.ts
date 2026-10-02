import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { DevframeJsonRenderSpec, JsonRenderIndex } from '@devframes/json-render';
import type { DevframeJsonRenderDockEntry } from '@devframes/json-render/hub';
import { jsonRenderUiRenderer } from '@devframes/json-render-ui/hub';
import { definePlugin } from '@devkit/core';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { devframeHubContext, serverExecution } from '@devkit/server';
import { createCounterView } from './view.js';
import { counterActionName } from './spec.js';

export { publishCounterView } from './publish.js';
export type { CounterViewOptions } from './publish.js';

/** Native view and RPC publication in the same genuine host used by the other examples. */
export async function createJsonRenderExample(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const host = await createRemoteHost(mode, { renderers: [jsonRenderUiRenderer()] });
  cleanup.defer(host.close);
  const viewPlugin = await host.provider.plugins.install(
    definePlugin({
      id: 'example.counter-view',
      views: [createCounterView({ execution: serverExecution, nativeContext: devframeHubContext })],
    }),
  );
  if (viewPlugin.snapshot().status !== 'ready')
    throw new Error('The counter view contribution did not activate');
  const index = await host.context.rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  const published = Object.values(index.value()).find((candidate) => candidate.id === 'counter');
  if (published === undefined) throw new Error('The counter view failed to publish');
  const view = await host.context.rpc.sharedState.get<DevframeJsonRenderSpec>(published.stateKey);
  const entry: DevframeJsonRenderDockEntry = {
    id: 'example:counter',
    title: 'Shared counter',
    icon: 'ph:plus',
    type: 'json-render',
    view: { stateKey: published.stateKey },
  };
  /** Native dock registrations and RPC definitions live until this example host closes. */
  host.context.docks.register(entry);
  /** The renderer's native action bridge sends one params object. The host owns this method. */
  host.context.rpc.register({
    name: counterActionName,
    type: 'action',
    args: [increaseCounterAction.operation.input] as const,
    returns: increaseCounterAction.operation.output,
    handler: (input: { amount: number }) =>
      host.provider.invoke({ action: increaseCounterAction, input }),
  });
  const lifetime = cleanup.move();
  return {
    host,
    view,
    viewPlugin,
    stateKey: published.stateKey,
    entry,
    close: () => lifetime.disposeAsync(),
  };
}
