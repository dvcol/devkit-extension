export const inspectorNativeConsumer = `
import assert from 'node:assert/strict';
import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { DevframeJsonRenderSpec, JsonRenderIndex } from '@devframes/json-render';
import { definePlugin, defineService } from '@devkit/core';
import {
  configureInspectorAction, createInspectorActions, inspectorCapability, inspectorStateKey,
  markInspectorAction, readInspectorAction, resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { createInspectorView } from '@devkit/example-json-render/inspector';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';

const initialState: InspectorState = {
  target: null, configuration: { enabled: false },
  modification: { status: 'unavailable', reason: 'Packed consumer does not intercept responses' },
  latest: null, marker: false,
};

/** Native shared-state implementation; HTTP effects and browser mounting are separate proofs. */
const inspectorService = defineService({
  id: 'consumer.native-inspector', capability: inspectorCapability, execution: serverExecution,
  async setup({ native }) {
    const context = native.get(devframeHubContext);
    assert.ok(context, 'Packed inspector has no native context');
    const state = await context.rpc.sharedState.get<InspectorState>(inspectorStateKey, {
      initialValue: structuredClone(initialState),
    });
    return {
      read: () => state.value(),
      configure({ enabled }) {
        state.mutate((current) => { current.configuration.enabled = enabled; });
        return state.value();
      },
      marker() {
        state.mutate((current) => { current.marker = true; });
        return state.value();
      },
      reset() {
        state.patch([{ op: 'replace', path: [], value: structuredClone(initialState) }]);
        return state.value();
      },
    };
  },
});

export async function checkInspectorComposition(provider: ServerProviderHandle): Promise<void> {
  const service = await provider.services.install(inspectorService);
  const actions = await provider.plugins.install(createInspectorActions({ execution: serverExecution }));
  const view = await provider.plugins.install(definePlugin({
    id: 'consumer.inspector-view',
    views: [createInspectorView({ execution: serverExecution, nativeContext: devframeHubContext, scope: 'packed-inspector' })],
  }));
  assert.equal(service.snapshot().status, 'ready');
  assert.equal(actions.snapshot().status, 'ready');
  assert.equal(view.snapshot().status, 'ready');
  const resolution = await provider.resolve({ capability: inspectorCapability });
  assert.equal(resolution.status, 'available');
  assert.ok(resolution.status === 'available' && resolution.binding.context.access === 'local');
  const context = resolution.binding.context.native.get(devframeHubContext);
  assert.ok(context);
  const sharedState = context.rpc.sharedState;
  const business = await sharedState.get<InspectorState>(inspectorStateKey);
  const index = await sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  const publication = Object.values(index.value()).find((entry) => entry.id === 'response-inspector');
  assert.ok(publication, 'Packed inspector did not publish a native JSON document');
  const document = await sharedState.get<DevframeJsonRenderSpec>(publication.stateKey);
  assert.equal(document.value().root, 'inspector');
  assert.equal(document.value().state?.['configuration'], 'false');
  assert.partialDeepStrictEqual(document.value().elements['inspect']?.on?.['press'], { action: readInspectorAction.id, params: {} });
  assert.partialDeepStrictEqual(document.value().elements['enable-modification']?.on?.['press'], { action: configureInspectorAction.id, params: { enabled: true } });
  assert.partialDeepStrictEqual(document.value().elements['install-marker']?.on?.['press'], { action: markInspectorAction.id, params: {} });
  assert.partialDeepStrictEqual(document.value().elements['reset']?.on?.['press'], { action: resetInspectorAction.id, params: {} });
  assert.deepEqual(await provider.invoke({ action: readInspectorAction, input: {} }), initialState);
  const configured: InspectorState = await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
  assert.equal(configured.configuration.enabled, true);
  assert.equal(document.value().state?.['configuration'], 'true');
  assert.equal(document.value().state?.['modification'], initialState.modification.reason);
  await provider.invoke({ action: markInspectorAction, input: {} });
  assert.equal(document.value().state?.['marker'], 'true');
  await provider.invoke({ action: resetInspectorAction, input: {} });
  assert.equal(document.value().state?.['configuration'], 'false');
  assert.equal(document.value().state?.['marker'], 'false');
  const lastPublished = structuredClone(document.value());
  await view.dispose();
  assert.equal(Object.hasOwn(index.value(), publication.stateKey), false);
  assert.equal(sharedState.keys().includes(publication.stateKey), false);
  await provider.invoke({ action: configureInspectorAction, input: { enabled: true } });
  assert.equal(business.value().configuration.enabled, true);
  assert.deepEqual(document.value(), lastPublished, 'Disposed inspector still received state updates');
  await service.dispose();
  assert.equal((await provider.resolve({ capability: inspectorCapability })).status, 'unavailable');
  assert.ok(actions.snapshot().contributions.every((contribution) => contribution.status === 'waiting'));
  await actions.dispose();
  assert.equal(view.snapshot().status, 'disposed');
  assert.equal(actions.snapshot().status, 'disposed');
}
`;
