export const rejectedTransformConsumers = [
  {
    name: 'an undeclared requirement in transform setup',
    source: `
import { defineTransform } from '@devkit/core';
import { capability, execution } from './contracts.js';
export const transform = defineTransform({
  id: 'transform', execution, requires: { records: capability },
  setup({ services }) { void services.other; },
});
`,
    diagnostic: `Property 'other' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'a wrong capability payload in transform setup',
    source: `
import { defineTransform } from '@devkit/core';
import { capability, execution } from './contracts.js';
export const transform = defineTransform({
  id: 'transform', execution, requires: { records: capability },
  async setup({ services }) { await services.records.api.read({ prefix: 2 }); },
});
`,
    diagnostic: `Type 'number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'a resource returned from typed transform setup',
    source: `
import { defineTransform } from '@devkit/core';
import { execution } from './contracts.js';
export const transform = defineTransform({ id: 'transform', execution, setup: () => ({ dispose() {} }) });
`,
    diagnostic: `is not assignable to type 'Awaitable<void>'`,
    code: 'TS2322',
  },
  {
    name: 'a transform envelope without requirements and setup in a plugin',
    source: `
import { definePlugin } from '@devkit/core';
import { execution } from './contracts.js';
export const plugin = definePlugin({ id: 'plugin', transforms: [{ id: 'transform', kind: 'transform', execution }] });
`,
    diagnostic: 'requires, setup',
    code: 'TS2739',
  },
  {
    name: 'native transform options outside setup',
    source: `
import { defineTransform } from '@devkit/core';
import { execution } from './contracts.js';
export const transform = defineTransform({ id: 'transform', execution, order: 'pre', setup() {} });
`,
    diagnostic: `'order' does not exist`,
    code: 'TS2353',
  },
];
