export const rejectedCleanupConsumers = [
  {
    name: 'an eagerly executed synchronous cleanup during setup',
    source: `
import { defineView } from '@devkit/core';
import { execution } from './contracts.js';
declare const unsubscribe: () => void;
export const view = defineView({
  id: 'example.cleanup', execution,
  setup({ scope }) { scope.onDispose(unsubscribe()); },
});
`,
    diagnostic: `Argument of type 'void' is not assignable`,
    code: 'TS2345',
  },
  {
    name: 'an eagerly executed asynchronous cleanup during setup',
    source: `
import { defineView } from '@devkit/core';
import { execution } from './contracts.js';
declare const closeOwnedResource: () => Promise<void>;
export const view = defineView({
  id: 'example.cleanup', execution,
  setup({ scope }) { scope.onDispose(closeOwnedResource()); },
});
`,
    diagnostic: `Argument of type 'Promise<void>' is not assignable`,
    code: 'TS2345',
  },
];
