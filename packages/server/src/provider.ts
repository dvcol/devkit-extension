import { randomUUID } from 'node:crypto';
import { styleText } from 'node:util';

import type { NativeContextAccess, ProviderDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import type { ProviderLifecycle } from '@devkit/runtime';
import type { DevframeHubContext } from '@devframes/hub/node';

import { prepareExposure } from './exposure.js';
import type { PreparedExposure } from './exposure.js';

import { nativeAccess, serverExecution, serverRealm } from './native.js';
import type {
  DevframeProviderOptions,
  DevToolsProviderOptions,
  ServerComposition,
  ServerProviderHandle,
} from './types.js';

const installedContexts = new WeakSet<DevframeHubContext>();

function reportDiagnostic(diagnostic: RuntimeDiagnostic, cause?: unknown): void {
  if (diagnostic.severity === 'warning') {
    console.warn(styleText('yellow', '⚠️ [devkit/server]'), diagnostic, cause);
    return;
  }
  console.error(styleText('red', '⚠️ [devkit/server]'), diagnostic, cause);
}

async function install(
  context: DevframeHubContext,
  native: NativeContextAccess,
  composition: ServerComposition<boolean>,
): Promise<ServerProviderHandle<boolean>> {
  if (composition.providerId.trim().length === 0)
    throw new TypeError('Provider ID must not be empty');
  if (installedContexts.has(context))
    throw new Error('This native context already owns a provider');
  const provider: ProviderDescriptor = Object.freeze({
    id: composition.providerId,
    incarnation: randomUUID(),
    realm: serverRealm,
  });
  const lifecycle = createProviderLifecycle({
    provider,
    execution: serverExecution,
    native,
    report: composition.report ?? reportDiagnostic,
    ...(composition.strict === undefined ? {} : { strict: composition.strict }),
    ...(composition.kinds === undefined ? {} : { kinds: composition.kinds }),
  });
  installedContexts.add(context);
  const handle = await startProvider({ ...composition, context }, lifecycle, provider);
  return handle;
}

async function startProvider(
  composition: DevframeProviderOptions<boolean>,
  lifecycle: ProviderLifecycle<boolean>,
  provider: ProviderDescriptor,
): Promise<ServerProviderHandle<boolean>> {
  const { context } = composition;
  let disposal: Promise<void> | undefined;
  let exposure: PreparedExposure | undefined;
  async function release(): Promise<void> {
    await lifecycle.dispose();
    installedContexts.delete(context);
  }
  function dispose(): Promise<void> {
    if (disposal !== undefined) return disposal;
    exposure?.clear();
    disposal = release();
    return disposal;
  }
  try {
    exposure = prepareExposure(context, composition);
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
    } satisfies ServerProviderHandle<boolean>);
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

export function createDevframeProvider(
  options: DevframeProviderOptions<false> & { readonly strict: false },
): Promise<ServerProviderHandle<false>>;
export function createDevframeProvider(
  options: DevframeProviderOptions,
): Promise<ServerProviderHandle>;
export function createDevframeProvider(
  options: DevframeProviderOptions<boolean>,
): Promise<ServerProviderHandle<boolean>>;
export function createDevframeProvider(
  options: DevframeProviderOptions<boolean>,
): Promise<ServerProviderHandle<boolean>> {
  return install(options.context, nativeAccess(options.context), options);
}

export function createDevToolsProvider(
  options: DevToolsProviderOptions<false> & { readonly strict: false },
): Promise<ServerProviderHandle<false>>;
export function createDevToolsProvider(
  options: DevToolsProviderOptions,
): Promise<ServerProviderHandle>;
export function createDevToolsProvider(
  options: DevToolsProviderOptions<boolean>,
): Promise<ServerProviderHandle<boolean>>;
export function createDevToolsProvider(
  options: DevToolsProviderOptions<boolean>,
): Promise<ServerProviderHandle<boolean>> {
  return install(options.context, nativeAccess(options.context, options.context), options);
}
