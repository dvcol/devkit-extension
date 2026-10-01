import { toJsonRenderDockEntry } from '@devframes/json-render/hub';
import { jsonRenderUiRenderer } from '@devframes/json-render-ui/hub';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { publishCounterView } from './publish.js';
import { counterActionName } from './spec.js';

export { publishCounterView } from './publish.js';
export type { CounterViewOptions } from './publish.js';

/** Native view and RPC publication in the same genuine host used by the other examples. */
export async function createJsonRenderExample(mode: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  const host = await createRemoteHost(mode, { renderers: [jsonRenderUiRenderer()] });
  cleanup.defer(host.close);
  const published = await publishCounterView({ context: host.context });
  cleanup.defer(published.dispose);
  const { view } = published;
  const entry = toJsonRenderDockEntry(view, {
    id: 'example:counter',
    title: 'Shared counter',
    icon: 'ph:plus',
  });
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
  return { host, view, entry, close: () => lifetime.disposeAsync() };
}
