export const rejectedAvailabilityConsumers = [
  {
    name: 'a capability binding before narrowing availability',
    source: `
import type { CapabilityResolution } from '@devkit/core';
import { capability } from './contracts.js';
declare const resolution: CapabilityResolution<typeof capability>;
void resolution.binding;
`,
    diagnostic: `Property 'binding' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'a capability binding after narrowing to unavailable',
    source: `
import type { CapabilityResolution } from '@devkit/core';
import { capability } from './contracts.js';
export function verify(resolution: CapabilityResolution<typeof capability>): void {
  if (resolution.status === 'unavailable') void resolution.binding;
}
`,
    diagnostic: `Property 'binding' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'an unavailable reason on an available capability',
    source: `
import type { CapabilityResolution } from '@devkit/core';
import { capability } from './contracts.js';
export function verify(resolution: CapabilityResolution<typeof capability>): void {
  if (resolution.status === 'available') void resolution.reason;
}
`,
    diagnostic: `Property 'reason' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'an undeclared capability availability reason',
    source: `
import type { CapabilityResolution } from '@devkit/core';
import { capability } from './contracts.js';
export const resolution: CapabilityResolution<typeof capability> = {
  status: 'unavailable', reason: 'retry-later',
};
`,
    diagnostic: `Type '"retry-later"' is not assignable to type 'AvailabilityReason'`,
    code: 'TS2322',
  },
  {
    name: 'an unavailable capability diagnostic without checking its presence',
    source: `
import type { CapabilityResolution } from '@devkit/core';
import { capability } from './contracts.js';
export function verify(resolution: CapabilityResolution<typeof capability>): void {
  if (resolution.status === 'unavailable') void resolution.diagnostic.message;
}
`,
    diagnostic: `'resolution.diagnostic' is possibly 'undefined'`,
    code: 'TS18048',
  },
];
