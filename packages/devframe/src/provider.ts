import type { NativeContextAccess, ProviderDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import type { ProviderLifecycle } from '@devkit/runtime';
import { prepareExposure } from './exposure.js';
import type { PreparedExposure } from './exposure.js';
import type { RpcProviderComposition, RpcProviderHandle, RpcProviderOptions } from './types.js';

const installedContexts = new WeakSet<object>();

function reportDiagnostic(diagnostic: RuntimeDiagnostic, cause?: unknown): void {
  if (diagnostic.severity === 'warning') {
    console.warn('[devkit/devframe]', diagnostic, cause);
    return;
  }
  console.error('[devkit/devframe]', diagnostic, cause);
}

async function install<Context>(
  context: RpcProviderOptions<boolean, Context>['context'],
  native: NativeContextAccess,
  composition: RpcProviderComposition<boolean>,
): Promise<RpcProviderHandle<boolean>> {
  if (composition.providerId.trim().length === 0)
    throw new TypeError('Provider ID must not be empty');
  if (installedContexts.has(context.rpc))
    throw new Error('This native context already owns a provider');
  const provider: ProviderDescriptor = Object.freeze({
    id: composition.providerId,
    incarnation: crypto.randomUUID(),
    realm: context.realm,
  });
  const lifecycle = createProviderLifecycle({
    provider,
    execution: context.execution,
    native,
    report: composition.report ?? reportDiagnostic,
    ...(composition.strict === undefined ? {} : { strict: composition.strict }),
    ...(composition.kinds === undefined ? {} : { kinds: composition.kinds }),
  });
  installedContexts.add(context.rpc);
  const handle = await startProvider({ ...composition, context }, lifecycle, provider);
  return handle;
}

async function startProvider<Context>(
  composition: RpcProviderOptions<boolean, Context>,
  lifecycle: ProviderLifecycle<boolean>,
  provider: ProviderDescriptor,
): Promise<RpcProviderHandle<boolean>> {
  const { context } = composition;
  let disposal: Promise<void> | undefined;
  let exposure: PreparedExposure | undefined;
  async function release(): Promise<void> {
    await lifecycle.dispose();
    installedContexts.delete(context.rpc);
  }
  function dispose(): Promise<void> {
    if (disposal !== undefined) return disposal;
    exposure?.clear();
    disposal = release();
    return disposal;
  }
  try {
    exposure = prepareExposure(context.rpc, composition);
    const startup = await lifecycle.startup(composition);
    const handle = Object.freeze({
      provider,
      catalog: lifecycle.catalog,
      startup,
      services: lifecycle.services,
      plugins: lifecycle.plugins,
      resolve: (request) => lifecycle.resolve(request),
      invoke: (request) => lifecycle.invoke(request),
      dispose,
    } satisfies RpcProviderHandle<boolean>);
    exposure?.publish(handle);
    return handle;
  } catch (startupFailure) {
    return rejectStartup(dispose, startupFailure);
  }
}

async function rejectStartup(
  dispose: () => Promise<void>,
  startupFailure: unknown,
): Promise<never> {
  try {
    await dispose();
  } catch (cleanupFailure) {
    throw new AggregateError([startupFailure, cleanupFailure], 'Provider startup cleanup failed', {
      cause: cleanupFailure,
    });
  }
  throw startupFailure;
}

export function createRpcProvider<Context>(
  options: RpcProviderOptions<false, Context> & { readonly strict: false },
): Promise<RpcProviderHandle<false>>;
export function createRpcProvider<Context>(
  options: RpcProviderOptions<true, Context>,
): Promise<RpcProviderHandle>;
export function createRpcProvider<Context>(
  options: RpcProviderOptions<boolean, Context>,
): Promise<RpcProviderHandle<boolean>>;
export function createRpcProvider<Context>(
  options: RpcProviderOptions<boolean, Context>,
): Promise<RpcProviderHandle<boolean>> {
  return install(options.context, options.context.native, options);
}
