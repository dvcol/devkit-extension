import type {
  InstallationHandle,
  InstallationResult,
  PluginDefinition,
  ServiceDeclaration,
} from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import type {
  ProviderLifecycle,
  ProviderLifecycleOptions,
  StartupInstallationResult,
} from '@devkit/runtime';

export async function strictResults(
  options: Omit<ProviderLifecycleOptions, 'strict'>,
  service: ServiceDeclaration,
  plugin: PluginDefinition,
): Promise<void> {
  const runtime = createProviderLifecycle(options);
  runtime satisfies ProviderLifecycle;
  const handle = await runtime.services.install(service);
  handle satisfies InstallationHandle;
  (await runtime.services.replace(handle, service)) satisfies InstallationHandle;
  const pluginHandle = await runtime.plugins.install(plugin);
  pluginHandle satisfies InstallationHandle;
  (await runtime.plugins.replace(pluginHandle, plugin)) satisfies InstallationHandle;
  const startup = await runtime.startup({ services: [service], plugins: [plugin] });
  startup satisfies StartupInstallationResult;
  startup.services satisfies readonly InstallationHandle[];
  startup.plugins satisfies readonly InstallationHandle[];
  // @ts-expect-error Strict results have no admission envelope.
  const envelope: unknown = handle.handle;
  void envelope;
  const explicitlyStrict = createProviderLifecycle({ ...options, strict: true });
  explicitlyStrict satisfies ProviderLifecycle;
  (await explicitlyStrict.services.install(service)) satisfies InstallationHandle;
}

export async function relaxedResults(
  options: Omit<ProviderLifecycleOptions, 'strict'>,
  service: ServiceDeclaration,
  plugin: PluginDefinition,
  handle: InstallationHandle,
): Promise<void> {
  const runtime = createProviderLifecycle({ ...options, strict: false });
  runtime satisfies ProviderLifecycle<false>;
  const result = await runtime.services.install(service);
  result satisfies InstallationResult<false>;
  (await runtime.services.replace(handle, service)) satisfies InstallationResult<false>;
  (await runtime.plugins.install(plugin)) satisfies InstallationResult<false>;
  (await runtime.plugins.replace(handle, plugin)) satisfies InstallationResult<false>;
  const startup = await runtime.startup({ services: [service], plugins: [plugin] });
  startup satisfies StartupInstallationResult<false>;
  startup.services satisfies readonly InstallationResult<false>[];
  startup.plugins satisfies readonly InstallationResult<false>[];
  // @ts-expect-error Relaxed startup results are admission envelopes, not direct handles.
  startup.services satisfies readonly InstallationHandle[];
  // @ts-expect-error Relaxed results must be narrowed before accessing a handle.
  result satisfies InstallationHandle;
  if (result.status === 'admitted') result.handle satisfies InstallationHandle;
  else {
    // @ts-expect-error Skipped registrations have no handle.
    const skippedHandle: unknown = result.handle;
    void skippedHandle;
  }
}

export async function configuredResults(
  options: Omit<ProviderLifecycleOptions, 'strict'>,
  service: ServiceDeclaration,
  plugin: PluginDefinition,
  handle: InstallationHandle,
  strict: boolean,
): Promise<void> {
  const runtime = createProviderLifecycle({ ...options, strict });
  runtime satisfies ProviderLifecycle<boolean>;
  const result = await runtime.services.install(service);
  result satisfies InstallationResult<boolean>;
  (await runtime.services.replace(handle, service)) satisfies InstallationResult<boolean>;
  (await runtime.plugins.install(plugin)) satisfies InstallationResult<boolean>;
  (await runtime.plugins.replace(handle, plugin)) satisfies InstallationResult<boolean>;
  const startup = await runtime.startup({ services: [service], plugins: [plugin] });
  startup satisfies StartupInstallationResult<boolean>;
  startup.services satisfies readonly InstallationResult<boolean>[];
  startup.plugins satisfies readonly InstallationResult<boolean>[];
  // @ts-expect-error Runtime strictness does not guarantee a direct handle.
  result satisfies InstallationHandle;
  if (!('status' in result)) result satisfies InstallationHandle;
  // @ts-expect-error Runtime-configured startup results do not guarantee direct handles.
  startup.plugins satisfies readonly InstallationHandle[];
}
