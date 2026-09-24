/** Private adapter internals, not a second RPC or shared-state implementation. */
export { createAdmissionRegistry } from './admission.js';
export type { Admission, Reservation, StartupComposition } from './admission.js';
export { invokeLocalOperation } from './invocation.js';
export type {
  LocalInvocationContext,
  LocalInvocationOptions,
  LocalInvocationRequest,
} from './invocation.js';
export { createActivationScope } from './scope.js';
export { createActivation } from './activation.js';
export type { Activation, ActivationSnapshot, ActivationStatus } from './activation.js';
export { createProviderLifecycle } from './provider.js';
export type {
  ProviderLifecycle,
  ProviderLifecycleOptions,
  StartupInstallationResult,
} from './provider.js';
