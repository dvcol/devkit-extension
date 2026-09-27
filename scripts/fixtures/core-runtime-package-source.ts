export const consumerSource = `
import {
  defineActionContract, defineCapability, defineExecution, defineOperation, definePlugin,
  defineRealm, defineService,
} from '@devkit/core';
import type { OperationInput, ProviderCatalogSnapshot, RoutingDirective } from '@devkit/core';
import {
  createActivationScope, createAdmissionRegistry, createProviderLifecycle, invokeLocalOperation,
} from '@devkit/runtime';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createClient, RoutingError } from '@devkit/client';

const stringSchema: StandardSchemaV1<string> = {
  '~standard': {
    version: 1,
    vendor: 'artifact-consumer',
    validate(value) {
      if (typeof value === 'string') return { value };
      return { issues: [{ message: 'Expected string' }] };
    },
  },
};
const operation = defineOperation({ input: stringSchema, output: stringSchema, target: 'none' });
const action = defineActionContract({
  id: 'consumer.action', version: 1, operation,
  routing: [{ realm: 'devserver', provider: 'frontend' }, { realm: 'webext' }],
});
action.routing[0].provider satisfies 'frontend';
action.routing satisfies RoutingDirective;
// @ts-expect-error Packed routing declarations must require a realm.
const invalidRouting: RoutingDirective = { provider: 'frontend' };
void invalidRouting;
const input: OperationInput<typeof operation> = 'artifact';
// @ts-expect-error A packed declaration must preserve the operation input type.
const invalidInput: OperationInput<typeof operation> = 42;
void invalidInput;
const execution = defineExecution({ id: 'consumer.server' });
const capability = defineCapability({ id: 'consumer.echo', version: 1, operations: { echo: operation } });
const service = defineService({ capability: capability,
  id: 'consumer.service', execution, setup: () => ({ echo: (value) => value }),
});
const plugin = definePlugin({ id: 'consumer.plugin', services: [service] });

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runConsumer(): Promise<string> {
  const provider = createProviderLifecycle({
    provider: { id: 'consumer', incarnation: 'consumer.lifetime', realm: { id: 'custom' } },
    execution, native: { get: () => undefined }, report() {},
  });
  const catalogs: ProviderCatalogSnapshot[] = [];
  const unsubscribe = provider.catalog.subscribe((snapshot) => { catalogs.push(snapshot); });
  await provider.startup({ services: [service] });
  check(provider.catalog.snapshot().capabilities[0]?.id === capability.id, 'Packed catalog lost the contract');
  check(catalogs.some((snapshot) => snapshot.capabilities[0]?.status === 'active'), 'Packed catalog did not publish activation');
  const client = createClient({ connections: [{
    provider: provider.catalog.snapshot().provider,
    catalog: provider.catalog, resolve: provider.resolve.bind(provider), invoke: provider.invoke.bind(provider),
  }] });
  const returnedByClient: string = await client.capabilities.invoke({
    capability, operation: 'echo', input: 'routed', routing: () => ({ realm: 'custom' }),
  });
  check(returnedByClient === 'routed', 'Packed client lost typed callback dispatch');
  const outcomes = await client.capabilities.broadcast({
    capability, operation: 'echo', input: 'broadcast', selection: [{ realm: 'custom' }],
  });
  check(outcomes[0]?.status === 'fulfilled' && outcomes[0].value === 'broadcast', 'Packed broadcast failed');
  try {
    await client.capabilities.broadcast({
      capability, operation: 'echo', input: 'missing', selection: [{ realm: 'missing' }],
    });
    throw new Error('Missing recipient accepted');
  } catch (error) {
    check(error instanceof RoutingError && error.code === 'unmatched-selection', 'Missing selector diagnostic was lost');
  }
  client.dispose();
  check(provider.catalog.snapshot().status === 'open', 'Client disposed the adapter owner');
  unsubscribe();
  await provider.dispose();
  check(provider.catalog.snapshot().status === 'disposed', 'Packed catalog did not finish disposal');
  const registry = createAdmissionRegistry({ providerId: 'consumer' });
  const admission = registry.reserve({ plugins: [plugin] })[0];
  check(admission?.status === 'reserved', 'Packed plugin was not admitted');
  check(admission.reservation.services.length === 1, 'Service was lost from packed plugin');
  registry.release(admission.reservation);
  check(registry.reserve({ plugins: [plugin] })[0]?.status === 'reserved', 'Ownership was not released');
  const activation = createActivationScope();
  const disposed: string[] = [];
  activation.scope.onDispose(() => { disposed.push('disposed'); });
  const returned = await invokeLocalOperation({
    operation, input, options: {},
    context: {
      provider: { id: 'consumer', incarnation: 'consumer.backend-lifetime', realm: defineRealm({ id: 'custom' }) },
      execution, contributionId: 'consumer.service', native: { get: () => undefined },
    },
    activationSignal: activation.scope.signal,
    handler: (value) => value,
  });
  check(returned === 'artifact', 'Packed operation failed to return validated original input');
  await activation.dispose();
  check(activation.scope.signal.aborted, 'Packed activation was not cancelled');
  check(disposed.join(',') === 'disposed', 'Packed activation did not clean up');
  return 'artifact-consumer-passed';
}
`;
