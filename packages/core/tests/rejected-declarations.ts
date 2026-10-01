export const rejectedConsumers = [
  {
    name: 'an unknown capability operation',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
void client.invoke({ capability, operation: 'missing', input: 2 });
`,
    diagnostic: `Type '"missing"' is not assignable`,
    code: 'TS2322',
  },
  {
    name: 'another capability operation payload',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
void client.invoke({ capability, operation: 'read', input: 2 });
`,
    diagnostic: `Type 'number' is not assignable`,
    code: 'TS2322',
  },
  {
    name: 'an uncorrelated dynamic operation and payload',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
declare const operation: 'read' | 'count';
void client.invoke({ capability, operation, input: 2 });
`,
    diagnostic: `Argument of type`,
    code: 'TS2345',
  },
  {
    name: 'a discriminated request result narrowed to one operation',
    source: `
import type { CapabilityClient, CapabilityInvocationRequest } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
declare const request: CapabilityInvocationRequest<typeof capability>;
export const result: string = await client.invoke(request);
`,
    diagnostic: `Type 'string | number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'an action payload that widens its contract',
    source: `
import type { ActionClient } from '@devkit/core';
import { action } from './contracts.js';
declare const client: ActionClient;
void client.invoke({ action, input: { prefix: 2 } });
`,
    diagnostic: `Type 'number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'a capability result with the wrong type',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
export const result: string = await client.invoke({ capability, operation: 'count', input: 2 });
`,
    diagnostic: `Type 'number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'broadcast without explicit selection',
    source: `
import type { ActionClient } from '@devkit/core';
import { action } from './contracts.js';
declare const client: ActionClient;
void client.broadcast({ action, input: { prefix: '' } });
`,
    diagnostic: `Property 'selection' is missing`,
    code: 'TS2345',
  },
  {
    name: 'an empty broadcast selection',
    source: `
import type { ActionClient } from '@devkit/core';
import { action } from './contracts.js';
declare const client: ActionClient;
void client.broadcast({ action, input: { prefix: '' }, selection: [] });
`,
    diagnostic: 'Source has 0 element(s) but target requires 1',
    code: 'TS2322',
  },
  {
    name: 'ordinary routing on a broadcast request',
    source: `
import type { ActionClient } from '@devkit/core';
import { action } from './contracts.js';
declare const client: ActionClient;
void client.broadcast({
  action, input: { prefix: '' }, selection: [{ realm: 'devserver' }],
  routing: { realm: 'devserver' },
});
`,
    diagnostic: `is not assignable to type 'never'`,
    code: 'TS2322',
  },
  {
    name: 'a broadcast payload from another capability operation',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { capability } from './contracts.js';
declare const client: CapabilityClient;
void client.broadcast({ capability, operation: 'count', input: '2', selection: [{ realm: 'webext' }] });
`,
    diagnostic: `Type 'string' is not assignable to type 'number'`,
    code: 'TS2322',
  },
  {
    name: 'a broadcast action result with the wrong type',
    source: `
import type { ActionClient, BroadcastOutcome } from '@devkit/core';
import { action } from './contracts.js';
declare const client: ActionClient;
export const result: readonly BroadcastOutcome<number>[] = await client.broadcast({
  action, input: { prefix: '' }, selection: [{ realm: 'webext' }],
});
`,
    diagnostic: `Type 'string' is not assignable to type 'number'`,
    code: 'TS2322',
  },
  {
    name: 'a broadcast value before narrowing its outcome status',
    source: `
import type { BroadcastOutcome } from '@devkit/core';
declare const outcome: BroadcastOutcome<string>;
void outcome.value;
`,
    diagnostic: `Property 'value' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'transformed output as operation input',
    source: `
import type { CapabilityClient } from '@devkit/core';
import { transformed } from './contracts.js';
declare const client: CapabilityClient;
void client.invoke({ capability: transformed, operation: 'normalize', input: 12 });
`,
    diagnostic: `Type 'number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'transformed output as a service result',
    source: `
import { defineService } from '@devkit/core';
import { execution, transformed } from './contracts.js';
export const service = defineService({
  id: 'example.invalid', capability: transformed, execution,
  setup: () => ({ normalize: () => 12 }),
});
`,
    diagnostic: `Type 'number' is not assignable to type 'Awaitable<string>'`,
    code: 'TS2322',
  },
  {
    name: 'transformed output as an action result',
    source: `
import { defineAction } from '@devkit/core';
import { execution, transformedAction } from './contracts.js';
export const handler = defineAction({
  id: 'example.invalid', contract: transformedAction, execution, handler: () => 12,
});
`,
    diagnostic: `Type 'number' is not assignable to type 'Awaitable<string>'`,
    code: 'TS2322',
  },
  {
    name: 'an undeclared service dependency during setup',
    source: `
import { defineService } from '@devkit/core';
import { capability, execution } from './contracts.js';
export const service = defineService({
  id: 'example.invalid', capability, execution, requires: { records: capability },
  setup({ services }) {
    void services.other;
    return { read: () => '', count: () => 0 };
  },
});
`,
    diagnostic: `Property 'other' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'an undeclared operation on an action dependency',
    source: `
import { defineAction } from '@devkit/core';
import { capability, action, execution } from './contracts.js';
export const handler = defineAction({
  id: 'example.invalid', contract: action, execution, requires: { records: capability },
  handler({ services }) { void services.records.api.missing; return ''; },
});
`,
    diagnostic: `Property 'missing' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'native primitives on a remote binding context',
    source: `
import type { BindingContext } from '@devkit/core';
export function verify(context: BindingContext): void {
  if (context.access === 'remote') void context.native;
}
`,
    diagnostic: `Property 'native' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'an unknown property from a typed native lookup',
    source: `
import type { NativeContextAccess } from '@devkit/core';
import { nativeContext } from './contracts.js';
export function verify(native: NativeContextAccess): void {
  void native.get(nativeContext)?.missing;
}
`,
    diagnostic: `Property 'missing' does not exist`,
    code: 'TS2339',
  },
];
