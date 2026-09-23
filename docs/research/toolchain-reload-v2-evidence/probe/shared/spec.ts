import type { Spec } from '@devframes/json-render';
export const spec = {
  root: 'root',
  elements: {
    root: { type: 'Stack', props: { direction: 'column' }, children: ['label', 'increment', 'failure'] },
    label: { type: 'Text', props: { text: { $state: '/countLabel' } } },
    increment: { type: 'Button', props: { label: 'Increment' }, on: { press: { action: 'fixture.increment' } } },
    failure: { type: 'Button', props: { label: 'Fail action' }, on: { press: { action: 'fixture.fail' } } },
  },
  state: { countLabel: '0' },
} satisfies Spec;
