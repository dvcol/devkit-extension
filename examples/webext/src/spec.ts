import type { DevframeJsonRenderSpec } from '@devframes/json-render';

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
    'probe:increase': () => Promise<number>;
    'probe:disable-service': () => Promise<void>;
    'probe:enable-service': () => Promise<void>;
    'probe:identity': () => Promise<{ id: number; url: string }>;
    'probe:echo': (value: unknown) => unknown;
    'probe:wait': () => Promise<void>;
    'probe:release': () => void;
    'probe:disconnect': () => void;
  }
}

export const spec: DevframeJsonRenderSpec = {
  root: 'counter',
  state: { value: 0 },
  elements: {
    counter: { type: 'Card', props: { title: 'Native extension counter' }, children: ['layout'] },
    layout: { type: 'Stack', props: { gap: 3 }, children: ['value', 'increase'] },
    value: { type: 'Text', props: { text: { $template: 'Counter: ${/value}' } } },
    increase: {
      type: 'Button',
      props: { label: 'Increase counter' },
      on: { press: { action: 'probe:increase' } },
    },
  },
};
