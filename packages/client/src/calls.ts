import type {
  ActionDescriptor,
  BroadcastInvocationOptions,
  BroadcastOutcome,
  CapabilityDescriptor,
  RoutingPolicy,
} from '@devkit/core';
import type { CallOptions } from './dispatch.js';
import { RoutingError } from './errors.js';
import type { ConnectionEntry, ConnectionRegistry } from './registry.js';
import { assertNotCancelled, broadcastRecipients, captureTarget, selectors } from './selection.js';
import type { SelectionRequest } from './selection.js';

export interface RoutedCall extends CallOptions {
  readonly routing?: RoutingPolicy;
}
export interface ActionCall extends RoutedCall {
  readonly action: ActionDescriptor;
  readonly input: unknown;
}
export interface CapabilityCall extends RoutedCall {
  readonly capability: CapabilityDescriptor;
  readonly operation: string;
  readonly input: unknown;
}
export interface BroadcastCall {
  readonly selection: BroadcastInvocationOptions['selection'];
  readonly routing?: never;
}

export function captureRouting(routing: RoutingPolicy | undefined): RoutingPolicy | undefined {
  if (routing === undefined || typeof routing === 'function') return routing;
  const [first, ...remaining] = selectors(routing);
  if (first === undefined)
    throw new RoutingError({ code: 'invalid-routing', message: 'Routing requires a selector' });
  return Object.freeze([first, ...remaining] as const);
}

export function routingOrDefault(
  routing: RoutingPolicy | undefined,
  fallback: RoutingPolicy | undefined,
): RoutingPolicy | undefined {
  if (routing !== undefined) return routing;
  return fallback;
}

export function scopedRequest(
  registry: ConnectionRegistry,
  request: RoutedCall,
  routing?: RoutingPolicy,
): RoutedCall {
  const target = captureTarget(request.target);
  const policy = captureRouting(routing);
  return {
    signal:
      request.signal === undefined
        ? registry.signal
        : AbortSignal.any([registry.signal, request.signal]),
    ...(target === undefined ? {} : { target }),
    ...(policy === undefined ? {} : { routing: policy }),
  };
}

export async function broadcast<Value>(
  registry: ConnectionRegistry,
  request: SelectionRequest,
  selection: unknown,
  work: (entry: ConnectionEntry) => Promise<Value>,
): Promise<readonly BroadcastOutcome<Value>[]> {
  assertNotCancelled(request.signal);
  const recipients = broadcastRecipients(registry, selection);
  const outcomes = await Promise.all(
    recipients.map(async (entry): Promise<BroadcastOutcome<Value>> => {
      try {
        return Object.freeze({
          provider: entry.provider,
          status: 'fulfilled' as const,
          value: await work(entry),
        });
      } catch (reason) {
        return Object.freeze({ provider: entry.provider, status: 'rejected' as const, reason });
      }
    }),
  );
  return Object.freeze(outcomes);
}

export function assertBroadcast(request: { readonly routing?: unknown }): void {
  if (Object.hasOwn(request, 'routing'))
    throw new RoutingError({
      code: 'invalid-routing',
      message: 'Broadcast uses selection, not routing or ordinary-invocation defaults',
    });
}
