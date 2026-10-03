import { defineView } from '@devkit/core';
import type { ExecutionDescriptor, NativeContextDescriptor, ViewDefinition } from '@devkit/core';
import { createJsonRenderView } from '@devframes/json-render/view';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import type { DevframeJsonRenderSpec } from '@devframes/json-render';
import {
  configureInspectorAction,
  inspectorCapability,
  inspectorStateKey,
  inspectorStateSchema,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';

/** Presentation derives from provider-owned data; it does not combine different providers' state. */
function projectInspector(state: InspectorState) {
  const current = inspectorStateSchema.parse(state);
  let modification = 'Available';
  if (current.modification.status === 'unavailable')
    modification = current.modification.reason ?? 'Unavailable';
  return {
    target: current.target ?? 'No response inspected',
    configuration: String(current.configuration.enabled),
    modification,
    body: current.latest?.body ?? 'No response inspected',
    responseStatus: current.latest?.status ?? 'No response inspected',
    marker: String(current.marker),
  };
}

/** Shared native JSON declarations; action bindings and business state belong to each host. */
const inspectorElements: DevframeJsonRenderSpec['elements'] = {
  inspector: {
    type: 'Card',
    props: { title: 'Response inspector' },
    children: ['inspector-layout'],
  },
  'inspector-layout': {
    type: 'Stack',
    props: { gap: 3 },
    children: [
      'target',
      'modification',
      'configuration',
      'response-status',
      'body',
      'marker',
      'inspect',
      'enable-modification',
      'disable-modification',
      'install-marker',
      'reset',
      'outcome',
    ],
  },
  target: { type: 'Text', props: { text: { $template: 'Target: ${/target}' } } },
  modification: {
    type: 'Text',
    props: { text: { $template: 'Response modification: ${/modification}' } },
  },
  configuration: {
    type: 'Text',
    props: { text: { $template: 'Modification enabled: ${/configuration}' } },
  },
  'response-status': {
    type: 'Text',
    props: { text: { $template: 'Response status: ${/responseStatus}' } },
  },
  body: { type: 'Text', props: { text: { $template: 'Response body: ${/body}' } } },
  marker: { type: 'Text', props: { text: { $template: 'Marker installed: ${/marker}' } } },
  inspect: {
    type: 'Button',
    props: { label: 'Inspect response' },
    on: {
      press: {
        action: readInspectorAction.id,
        params: {},
        onSuccess: { set: { '/outcome': 'Inspection dispatch complete' } },
        onError: { set: { '/outcome': 'Inspection failed' } },
      },
    },
  },
  'enable-modification': {
    type: 'Button',
    props: { label: 'Enable response modification' },
    on: {
      press: {
        action: configureInspectorAction.id,
        params: { enabled: true },
        onSuccess: { set: { '/outcome': 'Configuration dispatch complete' } },
        onError: { set: { '/outcome': 'Response modification unavailable' } },
      },
    },
  },
  'disable-modification': {
    type: 'Button',
    props: { label: 'Disable response modification' },
    on: {
      press: {
        action: configureInspectorAction.id,
        params: { enabled: false },
        onSuccess: { set: { '/outcome': 'Configuration dispatch complete' } },
        onError: { set: { '/outcome': 'Configuration failed' } },
      },
    },
  },
  'install-marker': {
    type: 'Button',
    props: { label: 'Install page marker' },
    on: {
      press: {
        action: markInspectorAction.id,
        params: {},
        onSuccess: { set: { '/outcome': 'Marker dispatch complete' } },
        onError: { set: { '/outcome': 'Marker installation failed' } },
      },
    },
  },
  reset: {
    type: 'Button',
    props: { label: 'Reset inspector' },
    on: {
      press: {
        action: resetInspectorAction.id,
        params: {},
        onSuccess: { set: { '/outcome': 'Reset dispatch complete' } },
        onError: { set: { '/outcome': 'Reset failed' } },
      },
    },
  },
  outcome: { type: 'Text', props: { text: { $state: '/outcome' } } },
};

/** Each publication gets its own state while using the same authored elements. */
export function inspectorSpec(state: InspectorState): DevframeJsonRenderSpec {
  return {
    root: 'inspector',
    state: { ...projectInspector(state), outcome: '' },
    elements: inspectorElements,
  };
}

/** The same publication recipe owns only its native view and business-state projection. */
export function createInspectorView(options: {
  readonly execution: ExecutionDescriptor;
  readonly nativeContext: NativeContextDescriptor<JsonRenderViewContext>;
  readonly scope?: string;
}): ViewDefinition<{ inspector: typeof inspectorCapability }> {
  return defineView({
    id: 'example.response-inspector-view',
    execution: options.execution,
    requires: { inspector: inspectorCapability },
    async setup({ native, scope }) {
      const context = native.get(options.nativeContext);
      if (context === undefined) throw new Error('The native JSON view context is required');
      const state = await context.rpc.sharedState.get<InspectorState>(inspectorStateKey);
      const view = createJsonRenderView(context, {
        id: 'response-inspector',
        scope: options.scope ?? 'response-inspector',
        title: 'Response inspector',
        spec: inspectorSpec(state.value()),
      });
      scope.onDispose(view.dispose);
      scope.onDispose(
        state.on('updated', (current) => {
          view.patchState(
            Object.entries(projectInspector(current)).map(([name, value]) => ({
              op: 'replace',
              path: `/${name}`,
              value,
            })),
          );
        }),
      );
    },
  });
}
