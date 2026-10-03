import {
  defineAction,
  defineActionContract,
  defineCapability,
  defineOperation,
  definePlugin,
} from '@devkit/core';
import type { ExecutionDescriptor } from '@devkit/core';
import { z } from 'zod';

export const inspectorStateKey = 'example:response-inspector';

/** Requested configuration and observed native support remain separate host-owned facts. */
export const inspectorStateSchema = z.strictObject({
  target: z.string().nullable(),
  configuration: z.strictObject({ enabled: z.boolean() }),
  modification: z.strictObject({
    status: z.enum(['available', 'unavailable']),
    reason: z.string().optional(),
  }),
  latest: z.strictObject({ url: z.string(), status: z.number(), body: z.string() }).nullable(),
  marker: z.boolean(),
});

export type InspectorState = z.infer<typeof inspectorStateSchema>;

const emptyInspectorInput = z.strictObject({});

export const inspectorCapability = defineCapability({
  id: 'example.response-inspector',
  version: 1,
  operations: {
    read: defineOperation({ input: emptyInspectorInput, output: inspectorStateSchema }),
    configure: defineOperation({
      input: z.strictObject({ enabled: z.boolean() }),
      output: inspectorStateSchema,
    }),
    marker: defineOperation({ input: emptyInspectorInput, output: inspectorStateSchema }),
    reset: defineOperation({ input: emptyInspectorInput, output: inspectorStateSchema }),
  },
});

export const readInspectorAction = defineActionContract({
  id: 'example.response-inspector.read',
  version: 1,
  operation: inspectorCapability.operations.read,
});
export const configureInspectorAction = defineActionContract({
  id: 'example.response-inspector.configure',
  version: 1,
  operation: inspectorCapability.operations.configure,
});
export const markInspectorAction = defineActionContract({
  id: 'example.response-inspector.marker',
  version: 1,
  operation: inspectorCapability.operations.marker,
});
export const resetInspectorAction = defineActionContract({
  id: 'example.response-inspector.reset',
  version: 1,
  operation: inspectorCapability.operations.reset,
});

/** Each host installs these handlers beside its own implementation of the shared capability. */
export function createInspectorActions(options: { readonly execution: ExecutionDescriptor }) {
  return definePlugin({
    id: 'example.response-inspector-actions',
    actions: [
      defineAction({
        id: 'example.response-inspector.read-handler',
        contract: readInspectorAction,
        execution: options.execution,
        requires: { inspector: inspectorCapability },
        handler: ({ input, services, signal }) => services.inspector.api.read(input, { signal }),
      }),
      defineAction({
        id: 'example.response-inspector.configure-handler',
        contract: configureInspectorAction,
        execution: options.execution,
        requires: { inspector: inspectorCapability },
        handler: ({ input, services, signal }) =>
          services.inspector.api.configure(input, { signal }),
      }),
      defineAction({
        id: 'example.response-inspector.marker-handler',
        contract: markInspectorAction,
        execution: options.execution,
        requires: { inspector: inspectorCapability },
        handler: ({ input, services, signal }) => services.inspector.api.marker(input, { signal }),
      }),
      defineAction({
        id: 'example.response-inspector.reset-handler',
        contract: resetInspectorAction,
        execution: options.execution,
        requires: { inspector: inspectorCapability },
        handler: ({ input, services, signal }) => services.inspector.api.reset(input, { signal }),
      }),
    ],
  });
}
