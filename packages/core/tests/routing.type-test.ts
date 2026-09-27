/** Compile-only routing declarations and request inference. */
import { z } from 'zod';
import { defineActionContract, defineOperation } from '../src/index.js';
import type { ActionClient, RouteSelector, RoutingDirective } from '../src/index.js';

export const selector: RouteSelector = { realm: 'custom', provider: 'backend' };
export const fallback: RoutingDirective = [selector, { realm: 'webext' }];
export const action = defineActionContract({
  id: 'example.routed',
  version: 1,
  operation: defineOperation({ input: z.string(), output: z.string(), target: 'none' }),
  routing: [{ realm: 'devserver', provider: 'frontend' }, { realm: 'webext' }],
});

action.routing[0].realm satisfies 'devserver';
action.routing[0].provider satisfies 'frontend';

// @ts-expect-error A provider identifier is always scoped by a realm.
export const providerOnly: RouteSelector = { provider: 'frontend' };
// @ts-expect-error Routing IDs are strings, without symbol coercion.
export const symbolRealm: RouteSelector = { realm: Symbol('custom') };
// @ts-expect-error Routing IDs are strings, without number coercion.
export const numericProvider: RouteSelector = { realm: 'custom', provider: 1 };
// @ts-expect-error An empty fallback list cannot select a provider.
export const emptyFallback: RoutingDirective = [];
// @ts-expect-error Bare strings do not identify a selector namespace.
export const bareRealm: RoutingDirective = 'custom';
// @ts-expect-error Present optional identifiers must contain a value.
export const undefinedProvider: RouteSelector = { realm: 'custom', provider: undefined };

export async function invoke(actions: ActionClient): Promise<void> {
  (await actions.invoke({ action, input: 'value', routing: selector })) satisfies string;
  (await actions.invoke({ action, input: 'value', routing: fallback })) satisfies string;
  // @ts-expect-error A route does not widen the selected action input.
  await actions.invoke({ action, input: 1, routing: selector });
}
