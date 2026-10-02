export const rejectedScriptConsumers = [
  {
    name: 'an undeclared requirement in script setup',
    source: `
import { defineScript } from '@devkit/core';
import { capability, execution } from './contracts.js';
export const script = defineScript({
  id: 'script', execution, requires: { records: capability },
  setup({ services }) { void services.other; },
});
`,
    diagnostic: `Property 'other' does not exist`,
    code: 'TS2339',
  },
  {
    name: 'a wrong capability payload in script setup',
    source: `
import { defineScript } from '@devkit/core';
import { capability, execution } from './contracts.js';
export const script = defineScript({
  id: 'script', execution, requires: { records: capability },
  async setup({ services }) { await services.records.api.read({ prefix: 2 }); },
});
`,
    diagnostic: `Type 'number' is not assignable to type 'string'`,
    code: 'TS2322',
  },
  {
    name: 'a resource returned from typed script setup',
    source: `
import { defineScript } from '@devkit/core';
import { execution } from './contracts.js';
export const script = defineScript({ id: 'script', execution, setup: () => ({ dispose() {} }) });
`,
    diagnostic: `is not assignable to type 'Awaitable<void>'`,
    code: 'TS2322',
  },
  {
    name: 'a script envelope without requirements and setup in a plugin',
    source: `
import { definePlugin } from '@devkit/core';
import { execution } from './contracts.js';
export const plugin = definePlugin({ id: 'plugin', scripts: [{ id: 'script', kind: 'script', execution }] });
`,
    diagnostic: 'requires, setup',
    code: 'TS2739',
  },
];
