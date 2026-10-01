import type { DevframeJsonRenderSpec } from '@devframes/json-render';

export const counterActionName = 'example:json-render:increase';

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    [counterActionName]: (input: { amount: number }) => Promise<number>;
  }
}

/** Native JSON model only; authoring imports no frontend framework. */
export function counterSpec(options: {
  readonly value: number;
  readonly actionName?: string;
}): DevframeJsonRenderSpec {
  const actionName = options.actionName ?? counterActionName;
  return {
    root: 'counter',
    state: { value: options.value },
    elements: {
      counter: {
        type: 'Card',
        props: { title: 'Shared counter' },
        children: ['layout'],
      },
      layout: {
        type: 'Stack',
        props: { gap: 3 },
        children: ['value', 'increase', 'invalid'],
      },
      value: { type: 'Text', props: { text: { $template: 'Counter: ${/value}' } } },
      increase: {
        type: 'Button',
        props: { label: 'Increase counter' },
        on: { press: { action: actionName, params: { amount: 1 } } },
      },
      invalid: {
        type: 'Button',
        props: { label: 'Try invalid input', variant: 'secondary' },
        on: { press: { action: actionName, params: { amount: 'invalid' } } },
      },
    },
  };
}
