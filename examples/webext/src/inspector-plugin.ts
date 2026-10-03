import { definePlugin } from '@devkit/core';
import type { ExecutionDescriptor, NativeContextDescriptor } from '@devkit/core';
import type { JsonRenderViewContext } from '@devframes/json-render/view';
import { createInspectorActions } from '@devkit/example-contribution/inspector';
import { createInspectorView } from '@devkit/example-json-render/inspector';
import { createInspectorFeature } from './inspector';

/** The host composes shared action/view declarations with its native capability implementation. */
export function createInspectorPlugin(options: {
  readonly execution: ExecutionDescriptor;
  readonly nativeContext: NativeContextDescriptor<JsonRenderViewContext>;
}) {
  const feature = createInspectorFeature(options);
  return definePlugin({
    id: 'example.extension.inspector',
    services: [feature.service],
    actions: createInspectorActions(options).actions,
    views: [createInspectorView(options)],
  });
}
