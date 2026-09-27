import type { RouteSelector, RoutingCandidate } from '@devkit/core';

export type RoutingErrorCode =
  | 'invalid-routing'
  | 'duplicate-provider'
  | 'invalid-connection'
  | 'client-disposed'
  | 'unavailable-provider'
  | 'ambiguous-provider'
  | 'stale-selection'
  | 'unmatched-selection'
  | 'cancelled'
  | 'listener-failed';

/** Selection failures have no single provider owner; do not fabricate an OperationError provider ID. */
export class RoutingError extends Error {
  override readonly name = 'RoutingError';
  readonly code: RoutingErrorCode;
  readonly candidates: readonly RoutingCandidate[];
  readonly selectors: readonly RouteSelector[];

  constructor(options: {
    readonly code: RoutingErrorCode;
    readonly message: string;
    readonly candidates?: readonly RoutingCandidate[];
    readonly selectors?: readonly RouteSelector[];
    readonly cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.code = options.code;
    this.candidates = Object.freeze([...(options.candidates ?? [])]);
    this.selectors = Object.freeze(
      (options.selectors ?? []).map((selector) => Object.freeze({ ...selector })),
    );
  }
}
