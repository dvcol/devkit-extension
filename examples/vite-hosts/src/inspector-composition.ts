import { definePlugin } from '@devkit/core';
import {
  configureInspectorAction,
  createInspectorActions,
  inspectorCapability,
  markInspectorAction,
  readInspectorAction,
  resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { createInspectorView } from '@devkit/example-json-render/inspector';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { ServerComposition } from '@devkit/server';
import type { createInspectorFeature } from './inspector.js';

/** Development and preview install the same declarations and native RPC exposure. */
export function inspectorComposition(
  feature: ReturnType<typeof createInspectorFeature>,
  host: 'devframe' | 'devtools',
): ServerComposition {
  return {
    providerId: `example.${host}-inspector`,
    services: [feature.service],
    plugins: [
      createInspectorActions({ execution: serverExecution }),
      definePlugin({
        id: 'example.inspector-native',
        scripts: [feature.script],
        transforms: [feature.transform],
        views: [
          createInspectorView({ execution: serverExecution, nativeContext: devframeHubContext }),
        ],
      }),
    ],
    expose: {
      capabilities: [inspectorCapability],
      actions: [
        readInspectorAction,
        configureInspectorAction,
        markInspectorAction,
        resetInspectorAction,
      ],
    },
  };
}
