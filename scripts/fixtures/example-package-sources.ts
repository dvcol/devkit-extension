export const exampleConsumerSource = `
import type { OperationInput, RuntimeDiagnostic } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import {
  counterActionsPlugin, counterNativeAccess, counterService, exampleExecution,
  exampleProvider, MemoryCounter,
} from '@devkit/example-contribution/provider';
import { createProviderLifecycle } from '@devkit/runtime';

const input: OperationInput<typeof increaseCounterAction.operation> = { amount: 3 };
// @ts-expect-error The published action input must preserve the numeric schema.
const invalidInput: OperationInput<typeof increaseCounterAction.operation> = { amount: '3' };
void invalidInput;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkSubscriptions(source: MemoryCounter, expected: number): void {
  check(source.subscriptionCount === expected, 'Packed service subscription count is incorrect');
}

export async function runConsumer(): Promise<string> {
  const source = new MemoryCounter();
  const diagnostics: RuntimeDiagnostic[] = [];
  const provider = createProviderLifecycle({
    provider: { ...exampleProvider, incarnation: crypto.randomUUID() },
    execution: exampleExecution,
    native: counterNativeAccess(source),
    report(diagnostic) { diagnostics.push(diagnostic); },
  });
  try {
    const installed = await provider.startup({
      services: [counterService], plugins: [counterActionsPlugin],
    });
    const service = installed.services[0];
    const plugin = installed.plugins[0];
    check(service !== undefined, 'Packed service was not installed');
    check(plugin !== undefined, 'Packed action plugin was not installed');
    check(service.snapshot().status === 'ready', 'Packed service was not ready');
    check(plugin.snapshot().status === 'ready', 'Packed plugin was not ready');
    checkSubscriptions(source, 1);
    const result = await provider.invoke({ action: increaseCounterAction, input });
    const typedResult: number = result;
    // @ts-expect-error The published action must infer a numeric result.
    const invalidResult: string = result;
    void invalidResult;
    check(typedResult === 3, 'Packed action did not update the counter');
    const resolution = await provider.resolve({ capability: counterCapability });
    check(resolution.status === 'available', 'Packed capability was unavailable');
    source.increase(2);
    const current: number = await resolution.binding.api.read({});
    check(current === 5, 'Packed capability did not observe the source subscription');
    check(diagnostics.length === 0, 'Packed provider emitted an unexpected diagnostic');
  } finally {
    await provider.dispose();
  }
  checkSubscriptions(source, 0);
  source.increase(1);
  checkSubscriptions(source, 0);
  return 'example-consumer-passed';
}
`;

export const contractsConsumerSource = `
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import {
  configureInspectorAction, inspectorCapability, inspectorStateKey, inspectorStateSchema,
  markInspectorAction, readInspectorAction, resetInspectorAction,
} from '@devkit/example-contribution/inspector';

async function checkInspectorContracts(): Promise<void> {
  if (inspectorStateKey !== 'example:response-inspector') throw new Error('Inspector state key missing');
  const configuration = { enabled: true };
  const valid = await inspectorCapability.operations.configure.input['~standard'].validate(configuration);
  if (valid.issues !== undefined) throw new Error('Inspector rejected valid configuration');
  const invalid = await configureInspectorAction.operation.input['~standard'].validate({ enabled: 'true' });
  if (invalid.issues === undefined) throw new Error('Inspector accepted invalid configuration');
  for (const action of [readInspectorAction, markInspectorAction, resetInspectorAction]) {
    const empty = await action.operation.input['~standard'].validate({});
    if (empty.issues !== undefined) throw new Error('Inspector rejected empty operation input');
    const extra = await action.operation.input['~standard'].validate(configuration);
    if (extra.issues === undefined) throw new Error('Inspector accepted unexpected operation input');
  }
  const state = {
    target: null, configuration, modification: { status: 'unavailable', reason: 'Host unsupported' },
    latest: null, marker: false,
  };
  if (!inspectorStateSchema.safeParse(state).success) throw new Error('Inspector state schema missing');
  if (inspectorStateSchema.safeParse({ ...state, configuration: { enabled: 'true' } }).success) {
    throw new Error('Inspector state accepted invalid configuration');
  }
}

export async function runConsumer(): Promise<string> {
  if (counterCapability.id !== 'example.counter') throw new Error('Capability contract missing');
  if (increaseCounterAction.id !== 'example.counter.increase') {
    throw new Error('Action contract missing');
  }
  const valid = await increaseCounterAction.operation.input['~standard'].validate({ amount: 3 });
  if (valid.issues !== undefined) throw new Error('Contract rejected valid input');
  const invalid = await increaseCounterAction.operation.input['~standard'].validate({ amount: -1 });
  if (invalid.issues === undefined) throw new Error('Contract accepted invalid input');
  await checkInspectorContracts();
  return 'contracts-consumer-passed';
}
`;

export const inspectorConsumerSource = `
import { defineService } from '@devkit/core';
import type { OperationInput, RuntimeDiagnostic } from '@devkit/core';
import {
  configureInspectorAction, createInspectorActions, inspectorCapability,
  markInspectorAction, readInspectorAction, resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import type { InspectorState } from '@devkit/example-contribution/inspector';
import { createProviderLifecycle } from '@devkit/runtime';

const configuration: OperationInput<typeof configureInspectorAction.operation> = { enabled: true };
// @ts-expect-error Packed inspector configuration must remain boolean.
const invalidConfiguration: OperationInput<typeof configureInspectorAction.operation> = { enabled: 'true' };
void invalidConfiguration;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runConsumer(): Promise<string> {
  const initialState: InspectorState = {
    target: null, configuration: { enabled: false },
    modification: { status: 'unavailable', reason: 'Local consumer has no native modification' },
    latest: null, marker: false,
  };
  let state = initialState;
  const execution = { id: 'example.packed-inspector' };
  const diagnostics: RuntimeDiagnostic[] = [];
  const provider = createProviderLifecycle({
    provider: { id: 'packed-inspector', incarnation: crypto.randomUUID(), realm: { id: 'example.local' } },
    execution,
    native: { get: () => undefined },
    report(diagnostic) { diagnostics.push(diagnostic); },
  });
  try {
    await provider.startup({
      services: [defineService({
        id: 'example.packed-inspector-service', capability: inspectorCapability, execution,
        setup: () => ({
          read: () => state,
          configure({ enabled }) { state = { ...state, configuration: { enabled } }; return state; },
          marker() { state = { ...state, marker: true }; return state; },
          reset() { state = initialState; return state; },
        }),
      })],
      plugins: [createInspectorActions({ execution })],
    });
    const initial = await provider.invoke({ action: readInspectorAction, input: {} });
    check(initial.latest === null && !initial.configuration.enabled, 'Packed inspector read changed initial state');
    const configured = await provider.invoke({ action: configureInspectorAction, input: configuration });
    const typedState: InspectorState = configured;
    const enabled: boolean = configured.configuration.enabled;
    // @ts-expect-error Packed action result must preserve boolean configuration inference.
    const invalidEnabled: string = configured.configuration.enabled;
    void invalidEnabled;
    check(enabled && typedState.modification.status === 'unavailable', 'Packed inspector confused request and support');
    const marked = await provider.invoke({ action: markInspectorAction, input: {} });
    check(marked.marker && marked.configuration.enabled, 'Packed marker action lost state');
    const resolution = await provider.resolve({ capability: inspectorCapability });
    check(resolution.status === 'available', 'Packed inspector capability unavailable');
    const current: InspectorState = await resolution.binding.api.read({});
    check(current.marker && current.configuration.enabled, 'Packed capability missed shared action state');
    const reset = await provider.invoke({ action: resetInspectorAction, input: {} });
    check(!reset.marker && !reset.configuration.enabled, 'Packed reset action did not clear state');
    const cleared = await resolution.binding.api.read({});
    check(!cleared.marker && !cleared.configuration.enabled, 'Packed capability missed shared reset');
    check(diagnostics.length === 0, 'Packed inspector emitted an unexpected diagnostic');
  } finally {
    await provider.dispose();
  }
  return 'inspector-consumer-passed';
}
`;
