/** Compile-only fixtures exercise the shipped declaration API. Never execute this module. */
import { z } from 'zod';
import {
  defineAction,
  defineActionContribution,
  defineCapability,
  defineContributionKind,
  defineExecution,
  defineExtension,
  defineNativeContext,
  defineOperation,
  definePlugin,
  defineRealm,
  defineService,
  isOperationError,
} from '../src/index.js';
import type {
  ActionClient,
  BindingContext,
  CapabilityClient,
  ContextMetadata,
  NativeContextAccess,
  ProviderDescriptor,
  TargetReference,
} from '../src/index.js';

const serverRealm = defineRealm({ id: 'example.custom-server' });
const serverExecution = defineExecution({ id: 'example.server' });
const serverContext = defineNativeContext<{ readonly serverName: string }>({
  id: 'example.server-context',
});

const titleCapability = defineCapability({
  id: 'example.title',
  version: 1,
  operations: {
    read: defineOperation({
      input: z.object({ prefix: z.string() }),
      output: z.string(),
      target: 'required',
    }),
    status: defineOperation({ input: z.object({}), output: z.boolean(), target: 'none' }),
    normalize: defineOperation({
      input: z.string().transform(Number),
      output: z.string().transform(Number),
      target: 'none',
    }),
  },
});

export const titleService = defineService(titleCapability, {
  id: 'example.title-service',
  execution: serverExecution,
  setup({ native, services, scope }) {
    const nativeServer = native.get(serverContext);
    nativeServer?.serverName satisfies string | undefined;
    // @ts-expect-error Only explicitly declared requirements are accessible.
    services.undeclared satisfies never;
    scope.onDispose(() => Promise.resolve());
    return {
      read(input, context) {
        context.target satisfies TargetReference;
        return `${input.prefix}${nativeServer?.serverName ?? 'unknown'}`;
      },
      status(_input, context) {
        context.target satisfies undefined;
        return true;
      },
      normalize(input) {
        input satisfies string;
        // @ts-expect-error Guard-only validation does not substitute the transformed number.
        input satisfies number;
        return input;
      },
    };
  },
});

const readAction = defineAction({
  id: 'example.read',
  version: 1,
  operation: titleCapability.operations.read,
});
export const readContribution = defineActionContribution(readAction, {
  id: 'example.read-handler',
  execution: serverExecution,
  requires: { titles: titleCapability },
  handler({ input, services, target, signal }) {
    // @ts-expect-error Dependencies preserve operation names.
    services.titles.api.missing satisfies never;
    // @ts-expect-error Requirements do not acquire unrelated services.
    services.other satisfies never;
    return services.titles.api.read(input, { target, signal });
  },
});

const customKind = defineContributionKind({
  id: 'example.notification',
  schema: z.object({ message: z.string() }),
});
export const notification = defineExtension(customKind, {
  id: 'example.ready',
  execution: serverExecution,
  payload: { message: 'Ready' },
});
export const plugin = definePlugin({
  id: 'example.plugin',
  services: [titleService],
  actions: [readContribution],
  extensions: [notification],
});

export async function checkClients(
  capabilities: CapabilityClient,
  actions: ActionClient,
  target: TargetReference,
): Promise<void> {
  serverRealm.id satisfies 'example.custom-server';
  serverExecution.id satisfies 'example.server';
  const selected = await capabilities.resolve(titleCapability, { target });
  if (selected.status === 'available') {
    const value = await selected.binding.api.read({ prefix: '' }, { target });
    value satisfies string;
    // @ts-expect-error Successful results remain exact.
    value satisfies number;
    (await selected.binding.api.status({})) satisfies boolean;
    (await selected.binding.api.normalize('12')) satisfies string;
    // @ts-expect-error A required target cannot be omitted.
    await selected.binding.api.read({ prefix: '' });
    // @ts-expect-error A targetless operation rejects a target.
    await selected.binding.api.status({}, { target });
    // @ts-expect-error Input schema transformations do not change accepted input type.
    await selected.binding.api.normalize(12);
    // @ts-expect-error A pinned binding cannot silently reroute.
    await selected.binding.api.status({}, { routing: {} });
  }
  (await capabilities.invoke(titleCapability, 'read', { prefix: '' }, { target })) satisfies string;
  (await actions.invoke(readAction, { prefix: '' }, { target })) satisfies string;
  // @ts-expect-error Routed calls also require a target.
  await capabilities.invoke(titleCapability, 'read', { prefix: '' });
  // @ts-expect-error Wrong operation is rejected instead of widening the descriptor.
  await capabilities.invoke(titleCapability, 'missing', {});
  // @ts-expect-error Action inputs match their descriptor.
  await actions.invoke(readAction, { prefix: 1 }, { target });
}

export function checkContexts(
  context: BindingContext,
  native: NativeContextAccess,
  error: unknown,
): void {
  if (context.access === 'remote') {
    // @ts-expect-error A remote binding has no raw native objects.
    context.native satisfies never;
  } else {
    context.native.get(serverContext)?.serverName satisfies string | undefined;
  }
  // @ts-expect-error Native lookup preserves its imported descriptor type.
  native.get(serverContext)?.missing satisfies never;
  if (isOperationError(error))
    error.diagnostic.phase satisfies 'admission' | 'setup' | 'call' | 'cleanup' | 'transport';
}

// @ts-expect-error Every capability needs an explicit contract version.
defineCapability({ id: 'example.unversioned', operations: {} });
// @ts-expect-error Contract versions are numeric.
defineCapability({ id: 'example.wrong-version', version: '1', operations: {} });
// @ts-expect-error Wire return schema is mandatory.
defineOperation({ input: z.string(), target: 'none' });
// @ts-expect-error Plugin property names are checked.
definePlugin({ id: 'example.typo', actons: [readContribution] });
// @ts-expect-error Service definitions cannot appear in the action list.
definePlugin({ id: 'example.wrong-kind', actions: [titleService] });
definePlugin({
  id: 'example.missing-contract',
  // @ts-expect-error A service entry must carry its explicit capability contract.
  services: [{ id: 'bad', kind: 'service', execution: serverExecution }],
});
definePlugin({
  id: 'example.incomplete-action',
  // @ts-expect-error Action entries require their contract, requirements and handler.
  actions: [{ id: 'bad', kind: 'action', execution: serverExecution }],
});
// @ts-expect-error Custom-kind payloads match the declared schema.
defineExtension(customKind, { id: 'bad', execution: serverExecution, payload: { message: 1 } });

defineService(titleCapability, {
  id: 'example.missing-methods',
  execution: serverExecution,
  // @ts-expect-error Implementations must supply every method.
  setup: () => ({ status: () => true }),
});
defineService(titleCapability, {
  id: 'example.wrong-results',
  execution: serverExecution,
  // @ts-expect-error Return schema transformations do not permit a number implementation.
  setup: () => ({ read: () => '', status: () => true, normalize: () => 12 }),
});
defineActionContribution(readAction, {
  id: 'example.wrong-action-result',
  execution: serverExecution,
  // @ts-expect-error Action results must match the declared output schema.
  handler: () => 12,
});

export const providerIdentity: ProviderDescriptor = {
  id: 'example.provider',
  incarnation: 'opaque-backend-lifetime',
  realm: serverRealm,
};

// @ts-expect-error Every provider descriptor identifies a concrete backend incarnation.
export const missingIncarnation: ProviderDescriptor = {
  id: 'example.provider',
  realm: serverRealm,
};
export const invalidIncarnation: ProviderDescriptor = {
  id: 'example.provider',
  // @ts-expect-error Incarnations are opaque strings rather than numeric generation counters.
  incarnation: 1,
  realm: serverRealm,
};

export function checkProviderIdentity(context: ContextMetadata): void {
  context.provider.incarnation satisfies string;
  // @ts-expect-error Consumers cannot change the backend lifetime of an existing context.
  context.provider.incarnation = 'successor';
}
