import type { AvailabilityReason } from './runtime-types.js';
import type {
  Awaitable,
  InvocationOptions,
  ProviderDescriptor,
  RouteSelector,
  RoutingDirective,
} from './types.js';

export interface RoutingCandidate {
  readonly provider: ProviderDescriptor;
  readonly availability:
    | { readonly status: 'available' }
    | { readonly status: 'unavailable'; readonly reason: AvailabilityReason | 'catalog-unknown' };
}

/** The callback runs locally; UI choices may be captured by its closure or supplied as input. */
export interface RoutingContext {
  readonly candidates: readonly RoutingCandidate[];
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export type RoutingCallback = (context: RoutingContext) => Awaitable<RoutingDirective>;
export type RoutingPolicy = RoutingDirective | RoutingCallback;

export interface BroadcastInvocationOptions extends InvocationOptions {
  /** Union of recipients. Every selector must match; each provider incarnation runs at most once. */
  readonly selection: readonly [RouteSelector, ...RouteSelector[]];
  readonly routing?: never;
}

export type BroadcastOutcome<Value> =
  | { readonly provider: ProviderDescriptor; readonly status: 'fulfilled'; readonly value: Value }
  | {
      readonly provider: ProviderDescriptor;
      readonly status: 'rejected';
      readonly reason: unknown;
    };
