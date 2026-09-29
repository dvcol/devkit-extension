import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import type { JsonRenderDockRenderer } from '@devframes/json-render/hub';
import type { SharedState } from 'devframe/utils/shared-state';
import { DomView } from './view.js';

/** A framework-free replacement registered through the native dock renderer contract. */
export const domRenderer: JsonRenderDockRenderer = async ({ entry, container, context }) => {
  using cleanup = new DisposableStack();
  const view = new DomView(context.rpc);
  cleanup.defer(() => {
    view.dispose();
  });
  let state: SharedState<DevframeJsonRenderSpec> | undefined;
  if ('stateKey' in entry.view)
    state = await context.rpc.sharedState.get<DevframeJsonRenderSpec>(entry.view.stateKey);
  const spec = 'spec' in entry.view ? entry.view.spec : state?.value();
  if (spec === undefined) throw new Error('JSON view is unavailable');
  view.render(spec);
  if (state !== undefined)
    cleanup.defer(
      state.on('updated', (snapshot) => {
        view.update(snapshot);
      }),
    );
  /** A previous renderer can leave a shadow root that would hide newly appended light DOM. */
  (container.shadowRoot ?? container).append(view.root);
  const resources = cleanup.move();
  return {
    dispose: () => {
      resources.dispose();
    },
  };
};
