import { defineService, isOperationError } from '@devkit/core';
import type { CapabilityImplementation, RuntimeDiagnostic } from '@devkit/core';
import {
  createInspectorActions,
  inspectorCapability,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { createProviderLifecycle } from '@devkit/runtime';
import { vi } from 'vitest';

const inspectorExecution = { id: 'example.inspector-local' };

export function requireOperationFailure(failure: unknown) {
  if (!isOperationError(failure)) throw new Error('Expected a portable operation failure');
  return failure;
}

export function initialInspectorState(
  target: string,
  modification: InspectorState['modification'],
): InspectorState {
  return {
    target,
    configuration: { enabled: false },
    modification,
    latest: { url: target, status: 200, body: 'Original response' },
    marker: false,
  };
}

/** This local implementation exercises shared authoring without claiming native interception. */
export function memoryInspector(
  initialState: InspectorState,
): CapabilityImplementation<typeof inspectorCapability> {
  let state = initialState;
  return {
    read: () => state,
    configure: ({ enabled }) => {
      state = { ...state, configuration: { enabled } };
      return state;
    },
    marker: () => {
      state = { ...state, marker: true };
      return state;
    },
    reset: () => {
      state = initialState;
      return state;
    },
  };
}

export async function createInspectorProvider(
  providerId: string,
  implementation: CapabilityImplementation<typeof inspectorCapability>,
) {
  const report = vi.fn<(diagnostic: RuntimeDiagnostic, cause?: unknown) => void>();
  const provider = createProviderLifecycle({
    provider: { id: providerId, incarnation: crypto.randomUUID(), realm: { id: 'example.local' } },
    execution: inspectorExecution,
    native: { get: vi.fn<() => undefined>() },
    report,
  });
  await provider.startup({
    services: [
      defineService({
        id: 'example.response-inspector-service',
        capability: inspectorCapability,
        execution: inspectorExecution,
        setup: () => implementation,
      }),
    ],
    plugins: [createInspectorActions({ execution: inspectorExecution })],
  });
  return { provider, report };
}
