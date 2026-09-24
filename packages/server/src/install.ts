import { randomUUID } from 'node:crypto';
import { styleText } from 'node:util';

import type { NativeContextAccess, ProviderDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import type { ProviderLifecycle } from '@devkit/runtime';
import type { DevframeHubContext } from '@devframes/hub/node';
import type { KitNodeContext } from '@vitejs/devtools-kit/node';

import { nativeAccess, serverExecution, serverRealm } from './native.js';
import type { ServerComposition, ServerProviderHandle } from './types.js';

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
  composition: ServerComposition,
): Promise<ServerProviderHandle> {
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
  const handle = await startProvider(context, composition, lifecycle, provider);
  return handle;
}

async function startProvider(
  context: DevframeHubContext,
  composition: ServerComposition,
  lifecycle: ProviderLifecycle,
  provider: ProviderDescriptor,
): Promise<ServerProviderHandle> {
  let disposal: Promise<void> | undefined;
  async function release(): Promise<void> {
    await lifecycle.dispose();
    installedContexts.delete(context);
  }
  function dispose(): Promise<void> {
    disposal ??= release();
    return disposal;
  }
  try {
    const startup = await lifecycle.startup(composition);
    return Object.freeze({
      provider,
      startup,
      services: lifecycle.services,
      plugins: lifecycle.plugins,
      resolve: (request) => lifecycle.resolve(request),
      invoke: (request) => lifecycle.invoke(request),
      dispose,
    } satisfies ServerProviderHandle);
  } catch (startupFailure) {
    try {
      await dispose();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [startupFailure, cleanupFailure],
        'Provider startup cleanup failed',
        {
          cause: cleanupFailure,
        },
      );
    }
    throw startupFailure;
  }
}

export function installDevframeProvider(
  context: DevframeHubContext,
  composition: ServerComposition,
): Promise<ServerProviderHandle> {
  return install(context, nativeAccess(context), composition);
}

export function installDevToolsProvider(
  context: KitNodeContext,
  composition: ServerComposition,
): Promise<ServerProviderHandle> {
  return install(context, nativeAccess(context, context), composition);
}
