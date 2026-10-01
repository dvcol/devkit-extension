import type { DevframeJsonRenderSpec } from '@devframes/json-render';

/** Management remains available independently of the capability it controls. */
export const managementSpec: DevframeJsonRenderSpec = {
  root: 'management',
  state: { status: 'starting', error: '' },
  elements: {
    management: {
      type: 'Card',
      props: { title: 'Contribution management' },
      children: ['controls'],
    },
    controls: {
      type: 'Stack',
      props: { gap: 3 },
      children: ['status', 'disable', 'enable', 'error'],
    },
    status: { type: 'Text', props: { text: { $template: 'Counter service: ${/status}' } } },
    disable: {
      type: 'Button',
      props: { label: 'Disable service' },
      on: {
        press: {
          action: 'probe:disable-service',
          params: {},
          onSuccess: { set: { '/error': '' } },
          onError: { set: { '/error': 'Unable to disable the service.' } },
        },
      },
    },
    enable: {
      type: 'Button',
      props: { label: 'Enable service' },
      on: {
        press: {
          action: 'probe:enable-service',
          params: {},
          onSuccess: { set: { '/error': '' } },
          onError: { set: { '/error': 'Unable to enable the service.' } },
        },
      },
    },
    error: { type: 'Text', props: { text: { $state: '/error' } } },
  },
};
