import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import type { createJsonRenderView } from '@devframes/json-render/view';
import type { createExampleProvider } from './provider';

/** Management remains available independently of the capability it controls. */
export const managementSpec: DevframeJsonRenderSpec = {
  root: 'management',
  state: { status: 'starting', error: '', storage: 'Ephemeral' },
  elements: {
    management: {
      type: 'Card',
      props: { title: 'Contribution management' },
      children: ['controls'],
    },
    controls: {
      type: 'Stack',
      props: { gap: 3 },
      children: ['status', 'disable', 'enable', 'error', 'storage'],
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
    storage: { type: 'Text', props: { text: { $template: 'Counter storage: ${/storage}' } } },
  },
};

/** The management view follows the background-owned provider, not an individual panel. */
export function observeProvider(options: {
  provider: ReturnType<typeof createExampleProvider>;
  management: ReturnType<typeof createJsonRenderView>;
}): void {
  const { provider, management } = options;
  void provider.then(
    ({ catalog }) =>
      catalog.subscribe((snapshot) => {
        const status = snapshot.capabilities[0]?.status ?? 'unavailable';
        management.patchState([{ op: 'replace', path: '/status', value: status }]);
      }),
    (error: unknown) => {
      console.error('Provider startup failed', error);
    },
  );
}
