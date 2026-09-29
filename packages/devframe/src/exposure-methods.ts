import { defineActionContract, defineCapability } from '@devkit/core';
import type { OperationDefinition } from '@devkit/core';

import type { RpcProviderComposition, RpcProviderHandle } from './types.js';
import { actionMethod, capabilityMethod } from './rpc-contract.js';

export type ExposedProvider = Pick<
  RpcProviderHandle<boolean>,
  'provider' | 'catalog' | 'invoke' | 'resolve'
>;

export interface ExposedMethod {
  readonly name: string;
  readonly operation: OperationDefinition;
  invoke(provider: ExposedProvider, input: unknown): Promise<unknown>;
}

/** Includes empty capabilities, which advertise a contract without creating operation methods. */
export function exposureIdentity(
  composition: RpcProviderComposition<boolean>,
  methods: readonly ExposedMethod[],
): string {
  return JSON.stringify([
    composition.providerId,
    methods.map(({ name }) => name).toSorted(),
    (composition.expose?.capabilities ?? [])
      .map(({ id, version }) => JSON.stringify([id, version]))
      .toSorted(),
  ]);
}

/** A native method name encodes a tuple so arbitrary contract identifiers cannot collide. */
export function exposureMethods(
  composition: RpcProviderComposition<boolean>,
): readonly ExposedMethod[] {
  const methods: ExposedMethod[] = [];
  const capabilities = new Set<string>();
  for (const descriptor of composition.expose?.actions ?? []) {
    const action = defineActionContract({
      id: descriptor.id,
      version: descriptor.version,
      operation: descriptor.operation,
    });
    methods.push({
      name: actionMethod(composition.providerId, action.id, action.version),
      operation: action.operation,
      invoke: (provider, input) => provider.invoke({ action, input }),
    });
  }
  for (const descriptor of composition.expose?.capabilities ?? []) {
    const capability = defineCapability({
      id: descriptor.id,
      version: descriptor.version,
      operations: descriptor.operations,
    });
    const identity = JSON.stringify([capability.id, capability.version]);
    if (capabilities.has(identity))
      throw new TypeError(`Duplicate exposed capability: ${identity}`);
    capabilities.add(identity);
    for (const [operationName, operation] of Object.entries(capability.operations)) {
      methods.push({
        name: capabilityMethod(composition.providerId, capability, operationName),
        operation,
        async invoke(provider, input) {
          const resolution = await provider.resolve({ capability });
          if (resolution.status !== 'available')
            throw new Error(
              `Capability ${capability.id}@${capability.version} is unavailable: ${resolution.reason}`,
            );
          const handler = resolution.binding.api[operationName];
          if (handler === undefined)
            throw new Error(`Missing capability operation ${operationName}`);
          return handler(input);
        },
      });
    }
  }
  validateMethods(methods);
  return methods;
}

function validateMethods(methods: readonly ExposedMethod[]): void {
  const names = new Set<string>();
  for (const method of methods) {
    if (names.has(method.name)) throw new TypeError(`Duplicate exposed contract: ${method.name}`);
    names.add(method.name);
  }
}

/** Native RPC validates the incarnation separately from the unchanged business schema. */
export const incarnationSchema = {
  '~standard': {
    version: 1,
    vendor: '@devkit/server',
    validate(value: unknown) {
      if (typeof value === 'string' && value.trim().length > 0) return { value };
      return { issues: [{ message: 'Expected a non-empty provider incarnation' }] };
    },
  },
} as const;
