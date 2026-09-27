import {
  defineActionContract,
  defineCapability,
  defineExecution,
  defineOperation,
  defineRealm,
  defineService,
} from '@devkit/core';
import type {
  CapabilityDescriptor,
  CapabilityResolution,
  InstallationResult,
  RuntimeDiagnostic,
} from '@devkit/core';
import { vi } from 'vitest';
import { z } from 'zod';

import { createProviderLifecycle } from '../src/provider.js';
import type { ProviderLifecycle, ProviderLifecycleOptions } from '../src/provider.js';

export const execution = defineExecution({ id: 'example.server' });
export const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
export const capability = defineCapability({
  id: 'example.echo',
  version: 1,
  operations: { echo: operation },
});
export const action = defineActionContract({ id: 'example.action', version: 1, operation });

export function provider(options: Partial<ProviderLifecycleOptions> & { readonly strict: false }): {
  runtime: ProviderLifecycle<false>;
  diagnostics: RuntimeDiagnostic[];
};
export function provider(
  options?: Partial<ProviderLifecycleOptions> & { readonly strict?: true },
): { runtime: ProviderLifecycle; diagnostics: RuntimeDiagnostic[] };
export function provider(options: Partial<ProviderLifecycleOptions>): {
  runtime: ProviderLifecycle<boolean>;
  diagnostics: RuntimeDiagnostic[];
};
export function provider(options: Partial<ProviderLifecycleOptions> = {}) {
  const diagnostics: RuntimeDiagnostic[] = [];
  const runtime = createProviderLifecycle({
    provider: {
      id: 'example.provider',
      incarnation: 'example.backend-lifetime',
      realm: defineRealm({ id: 'example.custom-realm' }),
    },
    execution,
    native: { get: vi.fn<() => undefined>() },
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
    ...options,
  });
  return { runtime, diagnostics };
}

export function echoService(id = 'example.service', valuePrefix = '') {
  return defineService({
    capability: capability,
    id,
    execution,
    setup: () => ({ echo: (value) => `${valuePrefix}${value}` }),
  });
}

export function admitted(result: InstallationResult<boolean> | undefined) {
  if (result === undefined) throw new Error('Expected admitted installation');
  if (!('status' in result)) return result;
  if (result.status === 'skipped') throw new Error(result.diagnostic.message);
  return result.handle;
}

export function available<Capability extends CapabilityDescriptor>(
  resolution: CapabilityResolution<Capability>,
) {
  if (resolution.status !== 'available') throw new Error('Expected available capability');
  return resolution.binding;
}

export function deferred<Value>() {
  let complete: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  if (complete === undefined) throw new Error('Missing promise resolver');
  return { promise, resolve: complete };
}
