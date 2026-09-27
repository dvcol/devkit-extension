import { ProviderController } from './provider-controller.js';
import type { ProviderLifecycle, ProviderLifecycleOptions } from './provider-types.js';

export type {
  ProviderLifecycle,
  ProviderLifecycleOptions,
  StartupInstallationResult,
} from './provider-types.js';

/**
 * Adapter-owned activation and local calls; communication and state stay with the native host.
 * Replacements serialize with each other while disjoint ordinary admission remains available.
 */
export function createProviderLifecycle(
  input: ProviderLifecycleOptions & { readonly strict: false },
): ProviderLifecycle<false>;
export function createProviderLifecycle(
  input: ProviderLifecycleOptions & { readonly strict?: true },
): ProviderLifecycle;
export function createProviderLifecycle(
  input: ProviderLifecycleOptions,
): ProviderLifecycle<boolean>;
export function createProviderLifecycle(
  input: ProviderLifecycleOptions,
): ProviderLifecycle<boolean> {
  return new ProviderController(input);
}
