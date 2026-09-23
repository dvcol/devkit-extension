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
    check(service?.status === 'admitted', 'Packed service was not admitted');
    check(plugin?.status === 'admitted', 'Packed action plugin was not admitted');
    check(service.handle.snapshot().status === 'ready', 'Packed service was not ready');
    check(plugin.handle.snapshot().status === 'ready', 'Packed plugin was not ready');
    checkSubscriptions(source, 1);
    const result = await provider.invoke(increaseCounterAction, input);
    const typedResult: number = result;
    // @ts-expect-error The published action must infer a numeric result.
    const invalidResult: string = result;
    void invalidResult;
    check(typedResult === 3, 'Packed action did not update the counter');
    const resolution = await provider.resolve(counterCapability);
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

export async function runConsumer(): Promise<string> {
  if (counterCapability.id !== 'example.counter') throw new Error('Capability contract missing');
  if (increaseCounterAction.id !== 'example.counter.increase') {
    throw new Error('Action contract missing');
  }
  const valid = await increaseCounterAction.operation.input['~standard'].validate({ amount: 3 });
  if (valid.issues !== undefined) throw new Error('Contract rejected valid input');
  const invalid = await increaseCounterAction.operation.input['~standard'].validate({ amount: -1 });
  if (invalid.issues === undefined) throw new Error('Contract accepted invalid input');
  return 'contracts-consumer-passed';
}
`;
