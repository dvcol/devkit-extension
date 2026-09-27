import type {
  CapabilityBinding,
  CapabilityDescriptor,
  InvocationOptions,
  TargetReference,
} from '@devkit/core';
import { RoutingError } from './errors.js';
import { assertAvailable, assertNotCancelled, captureTarget } from './selection.js';
import type { SelectionRequest } from './selection.js';
import type { ConnectionEntry, ConnectionRegistry } from './registry.js';

export interface CallOptions extends InvocationOptions {
  readonly target?: TargetReference;
}

export function callOptions(
  entry: ConnectionEntry,
  options: CallOptions,
): CallOptions & { readonly signal: AbortSignal } {
  const target = captureTarget(options.target);
  const signal =
    options.signal === undefined
      ? entry.cancellation.signal
      : AbortSignal.any([options.signal, entry.cancellation.signal]);
  return { signal, ...(target === undefined ? {} : { target }) };
}

export async function dispatched<Value>(
  registry: ConnectionRegistry,
  entry: ConnectionEntry,
  request: SelectionRequest,
  work: () => Promise<Value>,
): Promise<Value> {
  assertAvailable(registry, entry, request);
  const result = await work();
  registry.assertCurrent(entry);
  assertNotCancelled(request.signal);
  return result;
}

export async function callMethod(
  binding: CapabilityBinding<CapabilityDescriptor>,
  operation: string,
  input: unknown,
  options: CallOptions,
): Promise<unknown> {
  if (!Object.hasOwn(binding.api, operation))
    throw new RoutingError({
      code: 'invalid-connection',
      message: `Selected capability binding has no operation ${operation}`,
    });
  const method: unknown = Reflect.get(binding.api, operation);
  if (typeof method !== 'function')
    throw new RoutingError({
      code: 'invalid-connection',
      message: `Selected capability operation ${operation} is not callable`,
    });
  const result: unknown = await Reflect.apply(method, binding.api, [input, options]);
  return result;
}

export function pinnedBinding<Capability extends CapabilityDescriptor>(
  registry: ConnectionRegistry,
  entry: ConnectionEntry,
  capability: Capability,
  binding: CapabilityBinding<Capability>,
): CapabilityBinding<Capability>;
export function pinnedBinding(
  registry: ConnectionRegistry,
  entry: ConnectionEntry,
  capability: CapabilityDescriptor,
  binding: CapabilityBinding<CapabilityDescriptor>,
): CapabilityBinding<CapabilityDescriptor> {
  const actual = binding.context.provider;
  if (
    actual.id !== entry.provider.id ||
    actual.realm.id !== entry.provider.realm.id ||
    actual.incarnation !== entry.provider.incarnation
  )
    throw new RoutingError({
      code: 'invalid-connection',
      message: 'Resolved binding belongs to a different provider incarnation',
    });
  const api: Record<string, (input: unknown, options?: CallOptions) => Promise<unknown>> = {};
  for (const operation of Object.keys(capability.operations)) {
    Object.defineProperty(api, operation, {
      enumerable: true,
      value: (input: unknown, options: CallOptions = {}) => {
        const scoped = callOptions(entry, options);
        const request = {
          kind: 'capability' as const,
          id: capability.id,
          version: capability.version,
          operation,
          ...scoped,
        };
        return dispatched(registry, entry, request, () =>
          callMethod(binding, operation, input, scoped),
        );
      },
    });
  }
  return Object.freeze({ api: Object.freeze(api), context: binding.context });
}
