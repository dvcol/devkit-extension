import type { InstallationHandle, InstallationResult } from '@devkit/core';

import { echoService, provider } from './provider-fixtures.js';

export async function strictResults(): Promise<void> {
  const { runtime } = provider();
  const handle = await runtime.services.install(echoService());
  handle satisfies InstallationHandle;
  // @ts-expect-error Strict results have no admission envelope.
  const envelope: unknown = handle.handle;
  void envelope;
  const explicitlyStrict = provider({ strict: true });
  (await explicitlyStrict.runtime.services.install(echoService())) satisfies InstallationHandle;
}

export async function relaxedResults(): Promise<void> {
  const { runtime } = provider({ strict: false });
  const result = await runtime.services.install(echoService());
  result satisfies InstallationResult<false>;
  // @ts-expect-error Relaxed results must be narrowed before accessing a handle.
  result satisfies InstallationHandle;
  if (result.status === 'admitted') result.handle satisfies InstallationHandle;
  else {
    // @ts-expect-error Skipped registrations have no handle.
    const handle: unknown = result.handle;
    void handle;
  }
}

export async function configuredResults(strict: boolean): Promise<void> {
  const { runtime } = provider({ strict });
  const result = await runtime.services.install(echoService());
  result satisfies InstallationResult<boolean>;
  // @ts-expect-error Runtime strictness does not guarantee a direct handle.
  result satisfies InstallationHandle;
  if (!('status' in result)) result satisfies InstallationHandle;
}
