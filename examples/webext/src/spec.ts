import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import { createJsonRenderView } from '@devframes/json-render/view';
import type { RpcSharedStateHost } from 'devframe/types';
import { createSharedState } from 'devframe/utils/shared-state';
import { counterStateKey, increaseCounterAction, increaseMatchingCounterAction } from './contracts';
import { managementSpec } from './management-spec';

declare module 'devframe/types' {
  interface DevframeRpcServerFunctions {
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
  state: { value: 0, domain: 'shared.example.test', actionError: '' },
  elements: {
    counter: { type: 'Card', props: { title: 'Native extension counter' }, children: ['layout'] },
    layout: {
      type: 'Stack',
      props: { gap: 3 },
      children: ['value', 'increase', 'domain', 'matching', 'action-error'],
    },
    value: { type: 'Text', props: { text: { $template: 'Counter: ${/value}' } } },
    increase: {
      type: 'Button',
      props: { label: 'Increase counter' },
      on: {
        press: {
          action: increaseCounterAction.id,
          params: { amount: 1 },
          onSuccess: { set: { '/actionError': '' } },
          onError: { set: { '/actionError': 'Counter action unavailable.' } },
        },
      },
    },
    domain: { type: 'TextInput', props: { label: 'Domain', value: { $bindState: '/domain' } } },
    matching: {
      type: 'Button',
      props: { label: 'Increase matching domain' },
      on: {
        press: {
          action: increaseMatchingCounterAction.id,
          params: { domain: { $state: '/domain' }, amount: 1 },
          onSuccess: { set: { '/actionError': '' } },
          onError: { set: { '/actionError': 'Dispatch failed. See action results.' } },
        },
      },
    },
    'action-error': { type: 'Text', props: { text: { $state: '/actionError' } } },
  },
};

/** Business state and management outlive the capability-dependent counter publication. */
export function createBackgroundState(sharedState: RpcSharedStateHost) {
  const counter = createSharedState({ initialValue: { value: 0 } });
  const registration = sharedState.get(counterStateKey, { sharedState: counter });
  const viewContext = { rpc: { sharedState } };
  const management = createJsonRenderView(viewContext, { id: 'management', spec: managementSpec });
  return { counter, registration, viewContext, management };
}
