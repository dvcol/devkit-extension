import { createJsonRenderView } from '@devframes/json-render/view';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import { counterStateKey } from '@devkit/example-server-contexts';
import { counterSpec } from './spec.js';

export interface CounterViewOptions {
  readonly context: JsonRenderViewContext;
  readonly actionName?: string;
}

/** Own the native view and state projection; the host supplies its action binding. */
export async function publishCounterView(options: CounterViewOptions) {
  using cleanup = new DisposableStack();
  const state = await options.context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  const view = createJsonRenderView(options.context, {
    id: 'counter',
    scope: 'example',
    title: 'Shared counter',
    spec: counterSpec({
      value: state.value().value,
      ...(options.actionName === undefined ? {} : { actionName: options.actionName }),
    }),
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
