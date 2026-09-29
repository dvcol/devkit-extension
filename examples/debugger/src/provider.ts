import { defineRealm } from '@devkit/core';
import type { NativeContextAccess, NativeContextDescriptor, RuntimeDiagnostic } from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import type { EmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import {
  backgroundExecution,
  debuggerContext,
  pageTitlePlugin,
  pageTitleService,
} from './service.js';

function nativeAccess(bridge: EmbeddedChromeDebuggerBridge | undefined): NativeContextAccess {
  function get<Value>(descriptor: NativeContextDescriptor<Value>): Value | undefined;
  function get(descriptor: NativeContextDescriptor<unknown>): unknown {
    return descriptor.id === debuggerContext.id ? bridge : undefined;
  }
  return { get };
}

/** Contribution ownership excludes the embedding host's publisher, broker and client. */
export async function installDebuggerContributions(
  bridge: EmbeddedChromeDebuggerBridge | undefined,
  report: (diagnostic: RuntimeDiagnostic) => void,
) {
  const provider = createProviderLifecycle({
    provider: {
      id: 'example.debugger',
      incarnation: crypto.randomUUID(),
      realm: defineRealm({ id: 'webext' }),
    },
    execution: backgroundExecution,
    native: nativeAccess(bridge),
    report,
  });
  try {
    const startup = await provider.startup({
      services: bridge === undefined ? [] : [pageTitleService],
      plugins: [pageTitlePlugin],
    });
    return { provider, startup };
  } catch (error) {
    return cleanupFailedStartup(provider, error);
  }
}

async function cleanupFailedStartup(
  provider: ReturnType<typeof createProviderLifecycle>,
  error: unknown,
): Promise<never> {
  try {
    await provider.dispose();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Debugger contribution startup and cleanup failed',
      { cause: cleanupError },
    );
  }
  throw error;
}
