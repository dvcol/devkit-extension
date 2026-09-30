import { createJsonRenderView } from '@devframes/json-render/view';
import { increaseCounterAction } from '@devkit/example-contribution';
import { counterStateKey } from '@devkit/example-server-contexts';
import type { createRemoteHost } from '@devkit/example-server-contexts';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;

/** Same native view ID on separate hosts intentionally exercises independent key spaces. */
export async function publishCounterView(host: ServerHost) {
  const state = await host.context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  const view = createJsonRenderView(host.context, {
    id: 'published-counter',
    title: 'Published counter',
    spec: {
      root: 'layout',
      state: { ...state.value(), actionError: '' },
      elements: {
        layout: { type: 'Stack', props: { gap: 2 }, children: ['value', 'increase', 'error'] },
        error: { type: 'Text', props: { text: { $state: '/actionError' } } },
        value: { type: 'Text', props: { text: { $template: 'Remote: ${/value}' } } },
        increase: {
          type: 'Button',
          props: { label: 'Increase published counter' },
          on: {
            press: {
              action: increaseCounterAction.id,
              params: { amount: 1 },
              onError: { set: { '/actionError': 'Action unavailable' } },
            },
          },
        },
      },
    },
  });
  const unsubscribe = state.on('updated', (value) => {
    view.patchState([{ op: 'replace', path: '/value', value: value.value }]);
  });
  return {
    view,
    dispose: () => {
      unsubscribe();
      view.dispose();
    },
  };
}
