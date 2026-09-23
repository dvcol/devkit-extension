import {
  defineAction,
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
import type { ProviderLifecycleOptions } from '../src/provider.js';

export const execution = defineExecution({ id: 'example.server' });
export const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
export const capability = defineCapability({
  id: 'example.echo',
  version: 1,
  operations: { echo: operation },
});
export const action = defineAction({ id: 'example.action', version: 1, operation });

export function provider(options: Partial<ProviderLifecycleOptions> = {}) {
  const diagnostics: RuntimeDiagnostic[] = [];
  const runtime = createProviderLifecycle({
    provider: { id: 'example.provider', realm: defineRealm({ id: 'example.custom-realm' }) },
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
  return defineService(capability, {
    id,
    execution,
    setup: () => ({ echo: (value) => `${valuePrefix}${value}` }),
  });
}

export function admitted(result: InstallationResult | undefined) {
  if (result?.status !== 'admitted') throw new Error('Expected admitted installation');
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
