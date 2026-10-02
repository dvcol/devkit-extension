import { createJsonRenderView } from '@devframes/json-render/view';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import { counterStateKey } from '@devkit/example-contribution';
import { counterSpec } from './spec.js';

export interface CounterViewOptions {
  readonly context: JsonRenderViewContext;
  readonly actionName?: string;
  readonly scope?: string;
  readonly spec?: DevframeJsonRenderSpec;
}

/** Own the native view and state projection; the host supplies its action binding. */
export async function publishCounterView(options: CounterViewOptions) {
  using cleanup = new DisposableStack();
  const state = await options.context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  const spec =
    options.spec ??
    counterSpec({
      value: state.value().value,
      ...(options.actionName === undefined ? {} : { actionName: options.actionName }),
    });
  const initialSpec: DevframeJsonRenderSpec = {
    ...spec,
    state: { ...spec.state, value: state.value().value },
  };
  const view = createJsonRenderView(options.context, {
    id: 'counter',
    scope: options.scope ?? 'example',
    title: 'Shared counter',
    spec: initialSpec,
  });
  cleanup.defer(view.dispose);
  cleanup.defer(
    state.on('updated', (value) => {
      view.patchState([{ op: 'replace', path: '/value', value: value.value }]);
    }),
  );
  const lifetime = cleanup.move();
  return {
    view,
    dispose: () => {
      lifetime.dispose();
    },
  };
}
