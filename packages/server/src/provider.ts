import { styleText } from 'node:util';
import type { RuntimeDiagnostic } from '@devkit/core';
import { createRpcProvider } from '@devkit/devframe';
import { nativeAccess, serverExecution, serverRealm } from './native.js';
import type {
  DevframeProviderOptions,
  DevToolsProviderOptions,
  ServerProviderHandle,
} from './types.js';

function reportDiagnostic(diagnostic: RuntimeDiagnostic, cause?: unknown): void {
  if (diagnostic.severity === 'warning') {
    console.warn(styleText('yellow', '⚠️ [devkit/server]'), diagnostic, cause);
    return;
  }
  console.error(styleText('red', '⚠️ [devkit/server]'), diagnostic, cause);
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
  return createRpcProvider({
    ...options,
    context: {
      rpc: options.context.rpc,
      realm: serverRealm,
      execution: serverExecution,
      native: nativeAccess(options.context),
    },
    report: options.report ?? reportDiagnostic,
  });
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
  return createRpcProvider({
    ...options,
    context: {
      rpc: options.context.rpc,
      realm: serverRealm,
      execution: serverExecution,
      native: nativeAccess(options.context, options.context),
    },
    report: options.report ?? reportDiagnostic,
  });
}
