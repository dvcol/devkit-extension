import type {
  RouteSelector,
  RoutingCandidate,
  RoutingDirective,
  RoutingPolicy,
} from '@devkit/core';
import { RoutingError } from './errors.js';
import { readCatalog } from './registry.js';
import type { ConnectionEntry, ConnectionRegistry } from './registry.js';

export interface SelectionRequest {
  readonly kind: 'capability' | 'action';
  readonly id: string;
  readonly version: number;
  readonly operation?: string;
  readonly input?: unknown;
  readonly signal?: AbortSignal;
  readonly routing?: RoutingPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Own route metadata before asynchronous callbacks or adapter work can observe caller mutations. */
export function selectors(value: unknown): readonly RouteSelector[] {
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (values.length === 0)
    throw new RoutingError({
      code: 'invalid-routing',
      message: 'Selection must contain at least one realm selector',
    });
  return Object.freeze(
    values.map((selector) => {
      if (
        !isRecord(selector) ||
        !identifier(selector.realm) ||
        (Object.hasOwn(selector, 'provider') && !identifier(selector.provider)) ||
        Reflect.ownKeys(selector).some((name) => name !== 'realm' && name !== 'provider')
      )
        throw new RoutingError({
          code: 'invalid-routing',
          message:
            'Each selector requires a non-empty string realm and an optional non-empty string provider',
        });
      if (typeof selector.provider === 'string')
        return Object.freeze({ realm: selector.realm, provider: selector.provider });
      return Object.freeze({ realm: selector.realm });
    }),
  );
}

export function availability(
  entry: ConnectionEntry,
  request: SelectionRequest,
): RoutingCandidate['availability'] {
  const catalog = readCatalog(entry);
  if (catalog === undefined)
    return Object.freeze({ status: 'unavailable', reason: 'catalog-unknown' });
  if (catalog.status !== 'open')
    return Object.freeze({ status: 'unavailable', reason: 'disconnected' });
  const contracts = request.kind === 'capability' ? catalog.capabilities : catalog.actions;
  const contract = contracts.find(
    (candidate) => candidate.id === request.id && candidate.version === request.version,
  );
  if (contract === undefined)
    return Object.freeze({
      status: 'unavailable',
      reason: contracts.some((candidate) => candidate.id === request.id)
        ? 'incompatible-contract'
        : 'unsupported',
    });
  if (contract.status !== 'active')
    return Object.freeze({
      status: 'unavailable',
      reason: contract.reason ?? 'dependency-unavailable',
    });
  if (
    request.operation !== undefined &&
    !catalog.capabilities.some(
      (capability) =>
        capability.id === contract.id &&
        capability.version === contract.version &&
        capability.operations.some((operation) => operation.name === request.operation),
    )
  )
    return Object.freeze({ status: 'unavailable', reason: 'unsupported' });
  return Object.freeze({ status: 'available' });
}

function candidates(
  entries: readonly ConnectionEntry[],
  request: SelectionRequest,
): readonly RoutingCandidate[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({ provider: entry.provider, availability: availability(entry, request) }),
    ),
  );
}

function matches(provider: RoutingCandidate['provider'], selector: RouteSelector): boolean {
  return (
    provider.realm.id === selector.realm &&
    (selector.provider === undefined || selector.provider === provider.id)
  );
}

function choose(
  entries: readonly ConnectionEntry[],
  descriptions: readonly RoutingCandidate[],
  directive?: readonly RouteSelector[],
): ConnectionEntry {
  const alternatives = directive ?? [undefined];
  for (const selector of alternatives) {
    const eligible = descriptions.filter(
      (candidate) =>
        candidate.availability.status === 'available' &&
        (selector === undefined || matches(candidate.provider, selector)),
    );
    if (eligible.length > 1)
      throw new RoutingError({
        code: 'ambiguous-provider',
        message:
          'Several providers satisfy the preferred route; retry with a realm and provider discriminant',
        candidates: eligible,
      });
    const selected = eligible[0];
    if (selected === undefined) continue;
    const entry = entries.find((candidate) => candidate.provider === selected.provider);
    if (entry !== undefined) return entry;
  }
  throw new RoutingError({
    code: 'unavailable-provider',
    message:
      'No currently available provider satisfies the requested contract and routing constraints',
    candidates: descriptions,
  });
}

export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true)
    throw new RoutingError({
      code: 'cancelled',
      message: 'The invocation was cancelled before completion',
      cause: signal.reason,
    });
}

export function assertAvailable(
  registry: ConnectionRegistry,
  entry: ConnectionEntry,
  request: SelectionRequest,
): void {
  registry.assertCurrent(entry);
  assertNotCancelled(request.signal);
  const current = Object.freeze({
    provider: entry.provider,
    availability: availability(entry, request),
  });
  if (current.availability.status === 'unavailable')
    throw new RoutingError({
      code: 'unavailable-provider',
      message: `Selected provider ${JSON.stringify([entry.provider.realm.id, entry.provider.id])} is ${current.availability.reason}`,
      candidates: [current],
    });
}

async function callbackSelection(
  registry: ConnectionRegistry,
  request: SelectionRequest,
): Promise<ConnectionEntry> {
  if (typeof request.routing !== 'function') throw new Error('Expected routing callback');
  const entries = registry.list();
  const descriptions = candidates(entries, request);
  const signal = request.signal ?? new AbortController().signal;
  assertNotCancelled(signal);
  const result = request.routing(
    Object.freeze({
      candidates: descriptions,
      input: request.input,
      signal,
    }),
  );
  const directive = await waitForSelection(result, signal);
  const currentEntries = registry.list();
  const currentDescriptions = descriptions.map((candidate, index) => {
    const entry = entries[index];
    if (entry === undefined || !currentEntries.includes(entry)) return candidate;
    return Object.freeze({ provider: entry.provider, availability: availability(entry, request) });
  });
  const selected = choose(entries, currentDescriptions, selectors(directive));
  assertAvailable(registry, selected, request);
  return selected;
}

async function waitForSelection(
  result: RoutingDirective | Promise<RoutingDirective>,
  signal: AbortSignal,
): Promise<RoutingDirective> {
  let cancel: (() => void) | undefined;
  try {
    return await new Promise<RoutingDirective>((resolve, reject) => {
      cancel = () => {
        reject(
          new RoutingError({
            code: 'cancelled',
            message: 'Routing selection was cancelled',
            cause: signal.reason,
          }),
        );
      };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      Promise.resolve(result).then(resolve, reject);
    });
  } finally {
    if (cancel !== undefined) signal.removeEventListener('abort', cancel);
  }
}

/** Direct selection and dispatch share a synchronous boundary. Callback selection rechecks its original owner. */
export async function withSelection<Value>(
  registry: ConnectionRegistry,
  request: SelectionRequest,
  work: (entry: ConnectionEntry) => Promise<Value>,
): Promise<Value> {
  assertNotCancelled(request.signal);
  if (typeof request.routing === 'function') {
    const selected = await callbackSelection(registry, request);
    assertAvailable(registry, selected, request);
    return work(selected);
  }
  const entries = registry.list();
  let directive: readonly RouteSelector[] | undefined;
  if (request.routing !== undefined) directive = selectors(request.routing);
  return work(choose(entries, candidates(entries, request), directive));
}

/** Complete the recipient preflight before calling any provider. Missing recipients never silently disappear. */
export function broadcastRecipients(
  registry: ConnectionRegistry,
  selection: unknown,
): readonly ConnectionEntry[] {
  if (!Array.isArray(selection))
    throw new RoutingError({
      code: 'invalid-routing',
      message: 'Broadcast requires a non-empty selection list',
    });
  const requested = selectors(selection);
  const entries = registry.list();
  const unmatched = requested.filter(
    (selector) => !entries.some((entry) => matches(entry.provider, selector)),
  );
  if (unmatched.length > 0)
    throw new RoutingError({
      code: 'unmatched-selection',
      message: `Broadcast was not dispatched: no known provider matches ${JSON.stringify(unmatched)}. Refresh discovery or correct selection and retry.`,
      selectors: unmatched,
    });
  return Object.freeze(
    entries.filter((entry) => requested.some((selector) => matches(entry.provider, selector))),
  );
}
