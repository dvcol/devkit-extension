/** Consumer files resolve package exports, without source aliases or suppressed diagnostics. */
export const contractsSource = `
import { z } from 'zod';
import {
  defineActionContract, defineCapability, defineExecution, defineNativeContext, defineOperation,
} from '@devkit/core';

export const execution = defineExecution({ id: 'example.server' });
export const nativeContext = defineNativeContext<{ readonly title: string }>({ id: 'example.native' });
export const capability = defineCapability({
  id: 'example.records', version: 1,
  operations: {
    read: defineOperation({ input: z.object({ prefix: z.string() }), output: z.string() }),
    count: defineOperation({ input: z.number(), output: z.number() }),
  },
});
export const action = defineActionContract({
  id: 'example.read', version: 1, operation: capability.operations.read,
});
export const transformed = defineCapability({
  id: 'example.transformed', version: 1,
  operations: {
    normalize: defineOperation({
      input: z.string().transform(Number), output: z.string().transform(Number),
    }),
  },
});
export const transformedAction = defineActionContract({
  id: 'example.normalize', version: 1, operation: transformed.operations.normalize,
});
`;

export const acceptedConsumers = [
  {
    name: 'transform setup requirements native context and explicit scope cleanup',
    source: `
import { definePlugin, defineTransform } from '@devkit/core';
import type { TransformDeclaration, TransformDefinition } from '@devkit/core';
import { capability, execution, nativeContext } from './contracts.js';

export const transform: TransformDefinition<{ readonly records: typeof capability }> = defineTransform({
  id: 'example.transform', execution, requires: { records: capability },
  async setup({ services, native, scope }) {
    (await services.records.api.read({ prefix: '' })) satisfies string;
    native.get(nativeContext)?.title satisfies string | undefined;
    scope.signal satisfies AbortSignal;
    scope.onDispose(() => Promise.resolve());
  },
});
export const declaration: TransformDeclaration = transform;
export const plugin = definePlugin({ id: 'example.transform-plugin', transforms: [transform] });
export const independent = defineTransform({ id: 'example.independent', execution, setup() {} });
`,
  },
  {
    name: 'script setup requirements native context and explicit scope cleanup',
    source: `
import { definePlugin, defineScript } from '@devkit/core';
import type { ScriptDeclaration, ScriptDefinition } from '@devkit/core';
import { capability, execution, nativeContext } from './contracts.js';

export const script: ScriptDefinition<{ readonly records: typeof capability }> = defineScript({
  id: 'example.script', execution, requires: { records: capability },
  async setup({ services, native, scope }) {
    (await services.records.api.read({ prefix: '' })) satisfies string;
    native.get(nativeContext)?.title satisfies string | undefined;
    scope.signal satisfies AbortSignal;
    scope.onDispose(() => Promise.resolve());
  },
});
export const declaration: ScriptDeclaration = script;
export const plugin = definePlugin({ id: 'example.script-plugin', scripts: [script] });
export const independent = defineScript({ id: 'example.independent', execution, setup() {} });
`,
  },
  {
    name: 'view setup requirements native context and explicit scope cleanup',
    source: `
import { definePlugin, defineView } from '@devkit/core';
import type { ViewDeclaration, ViewDefinition } from '@devkit/core';
import { capability, execution, nativeContext } from './contracts.js';

export const view: ViewDefinition<{ readonly records: typeof capability }> = defineView({
  id: 'example.view', execution, requires: { records: capability },
  async setup({ services, native, scope }) {
    (await services.records.api.read({ prefix: '' })) satisfies string;
    native.get(nativeContext)?.title satisfies string | undefined;
    scope.signal satisfies AbortSignal;
    scope.onDispose(() => Promise.resolve());
  },
});
export const declaration: ViewDeclaration = view;
export const plugin = definePlugin({ id: 'example.view-plugin', views: [view] });
export const independent = defineView({ id: 'example.independent', execution, setup() {} });
`,
  },
  {
    name: 'operation input and output correlation including discriminated requests',
    source: `
import type {
  ActionClient, ActionInvocationRequest, CapabilityClient, CapabilityInvocationRequest,
  OperationInput, OperationValue,
} from '@devkit/core';
import { capability, action } from './contracts.js';

export const input: OperationInput<typeof capability.operations.read> = { prefix: 'Title: ' };
export const actionRequest: ActionInvocationRequest<typeof action> = { action, input };
export const output: OperationValue<typeof capability.operations.read> = 'Title: Example';

export function request(operation: 'read' | 'count'): CapabilityInvocationRequest<typeof capability> {
  if (operation === 'read') return { capability, operation, input };
  return { capability, operation, input: 2 };
}

export async function verify(capabilities: CapabilityClient, actions: ActionClient): Promise<void> {
  (await capabilities.invoke({ capability, operation: 'read', input })) satisfies string;
  (await capabilities.invoke({ capability, operation: 'count', input: 2 })) satisfies number;
  (await capabilities.invoke(request('read'))) satisfies string | number;
  (await actions.invoke(actionRequest)) satisfies string;
  const selected = await capabilities.resolve({ capability });
  if (selected.status === 'available') {
    (await selected.binding.api.read(input)) satisfies string;
    (await selected.binding.api.count(2)) satisfies number;
  }
}
`,
  },
  {
    name: 'broadcast result inference and outcome narrowing',
    source: `
import type { ActionClient, CapabilityClient, BroadcastOutcome } from '@devkit/core';
import { capability, action } from './contracts.js';

export async function verify(capabilities: CapabilityClient, actions: ActionClient): Promise<void> {
  const selection = [{ realm: 'devserver', provider: 'example' }] as const;
  const results = await actions.broadcast({ action, input: { prefix: '' }, selection });
  results satisfies readonly BroadcastOutcome<string>[];
  const counts = await capabilities.broadcast({ capability, operation: 'count', input: 2, selection });
  counts satisfies readonly BroadcastOutcome<number>[];
  for (const result of results) {
    result.provider.incarnation satisfies string;
    if (result.status === 'fulfilled') result.value satisfies string;
    else result.reason satisfies unknown;
  }
}
`,
  },
  {
    name: 'guard-only schema input and result types in services actions and clients',
    source: `
import { defineAction, defineService } from '@devkit/core';
import type { ActionClient, CapabilityClient, OperationInput, OperationValue } from '@devkit/core';
import { execution, transformed, transformedAction } from './contracts.js';

export const input: OperationInput<typeof transformed.operations.normalize> = '12';
export const result: OperationValue<typeof transformed.operations.normalize> = '12';
export const service = defineService({
  id: 'example.transform-service', capability: transformed, execution,
  setup: () => ({ normalize(value) { value satisfies string; return value; } }),
});
export const handler = defineAction({
  id: 'example.transform-action', contract: transformedAction, execution,
  handler({ input }) { input satisfies string; return input; },
});
export async function verify(capabilities: CapabilityClient, actions: ActionClient): Promise<void> {
  (await capabilities.invoke({ capability: transformed, operation: 'normalize', input })) satisfies string;
  (await actions.invoke({ action: transformedAction, input })) satisfies string;
}
`,
  },
  {
    name: 'named service requirements and action handler inference',
    source: `
import { defineAction, defineService } from '@devkit/core';
import { capability, action, execution, nativeContext } from './contracts.js';

export const service = defineService({
  id: 'example.dependent-service', capability, execution, requires: { records: capability },
  setup({ services, native, scope }) {
    native.get(nativeContext)?.title satisfies string | undefined;
    scope.signal satisfies AbortSignal;
    scope.onDispose(() => Promise.resolve());
    return {
      read(input, context) {
        input.prefix satisfies string;
        context.signal satisfies AbortSignal;
        return services.records.api.read(input, { signal: context.signal });
      },
      count: (input) => services.records.api.count(input),
    };
  },
});
export const handler = defineAction({
  id: 'example.dependent-action', contract: action, execution, requires: { records: capability },
  handler({ input, services, signal }) {
    input.prefix satisfies string;
    return services.records.api.read(input, { signal });
  },
});
`,
  },
  {
    name: 'local and remote binding contexts with typed native lookup',
    source: `
import type { BindingContext, NativeContextAccess } from '@devkit/core';
import { nativeContext } from './contracts.js';

export function verify(context: BindingContext, native: NativeContextAccess): void {
  native.get(nativeContext)?.title satisfies string | undefined;
  context.provider.incarnation satisfies string;
  context.execution.id satisfies string;
  if (context.access === 'local') {
    context.native.get(nativeContext)?.title satisfies string | undefined;
  } else {
    context.access satisfies 'remote';
  }
}
`,
  },
];
