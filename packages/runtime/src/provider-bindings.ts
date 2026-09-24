import { isOperationError } from '@devkit/core';
import type {
  ActionDescriptor,
  ActionInvocationRequest,
  AvailabilityReason,
  CapabilityBinding,
  CapabilityDescriptor,
  CapabilityResolution,
  OperationValue,
  RequirementBindings,
  CapabilityRequirements,
  RuntimeDiagnostic,
} from '@devkit/core';

import { operationError } from './errors.js';
import { invokeLocalOperation } from './invocation.js';
import type { LocalInvocationOptions } from './invocation.js';
import { providerDiagnostic, reportDiagnostic } from './provider-status.js';
import { actionDeclaration, serviceDeclaration } from './provider-types.js';
import type {
  OwnedContribution,
  OwnedInstallation,
  ProviderLifecycleOptions,
} from './provider-types.js';

export interface BindingEnvironment {
  readonly options: ProviderLifecycleOptions;
  readonly installations: ReadonlySet<OwnedInstallation>;
}

export function allContributions(environment: BindingEnvironment): OwnedContribution[] {
  return [...environment.installations].flatMap((installation) => installation.contributions);
}

export function findService(
  environment: BindingEnvironment,
  capability: CapabilityDescriptor,
): OwnedContribution | undefined {
  return allContributions(environment).find((contribution) => {
    const service = serviceDeclaration(contribution.definition);
    return (
      !contribution.installation.disposed &&
      service?.capability.id === capability.id &&
      service.capability.version === capability.version
    );
  });
}

export function unavailableReason(
  environment: BindingEnvironment,
  capability: CapabilityDescriptor,
): AvailabilityReason {
  const exact = findService(environment, capability);
  if (exact !== undefined) return exact.reason ?? 'dependency-unavailable';
  const differentVersion = allContributions(environment).some(
    (contribution) =>
      !contribution.installation.disposed &&
      serviceDeclaration(contribution.definition)?.capability.id === capability.id,
  );
  return differentVersion ? 'incompatible-contract' : 'unsupported';
}

export function unavailableDiagnostic(
  environment: BindingEnvironment,
  capability: CapabilityDescriptor,
): RuntimeDiagnostic {
  const reason = unavailableReason(environment, capability);
  const diagnostic = providerDiagnostic(
    environment.options,
    reason === 'incompatible-contract' ? reason : 'unavailable-capability',
    `Capability ${capability.id}@${capability.version} is ${reason}`,
    'call',
  );
  if (reason === 'incompatible-contract' && environment.options.strict === false)
    return { ...diagnostic, severity: 'warning' };
  return diagnostic;
}

/** Recipe signatures are erased after admission; runtime schema checks guard values at invocation. */
export function callRecipe(recipe: (...parameters: never[]) => unknown, context: object): unknown {
  return Reflect.apply(recipe, undefined, [context]);
}

export function implementationMethod(
  value: unknown,
  name: string,
): (...parameters: unknown[]) => unknown {
  if (typeof value !== 'object' || value === null || !(name in value))
    throw new TypeError(`Missing operation implementation ${name}`);
  const method: unknown = Reflect.get(value, name);
  if (typeof method !== 'function') throw new TypeError(`Operation ${name} is not a function`);
  return (...parameters): unknown => Reflect.apply(method, value, parameters);
}

function localContext(environment: BindingEnvironment, contribution: OwnedContribution) {
  return {
    provider: environment.options.provider,
    execution: contribution.definition.execution,
    native: environment.options.native,
    contributionId: contribution.definition.id,
    ...(contribution.installation.reservation.kind === 'plugin'
      ? { pluginId: contribution.installation.reservation.id }
      : {}),
  };
}

async function invokeOwned(
  environment: BindingEnvironment,
  contribution: OwnedContribution,
  work: (implementation: unknown, signal: AbortSignal) => Promise<unknown>,
): Promise<unknown> {
  const activation = contribution.activation;
  if (contribution.status !== 'active' || activation === undefined)
    return rejectUnavailable(environment, 'Contribution is unavailable', contribution);
  try {
    return await activation.run(work);
  } catch (cause) {
    const error = isOperationError(cause)
      ? cause
      : operationError(
          providerDiagnostic(
            environment.options,
            contribution.status === 'active' ? 'operation-failed' : 'cancelled',
            'Operation did not complete',
            'call',
            contribution.installation,
            contribution,
          ),
          cause,
        );
    reportDiagnostic(environment.options, error.diagnostic, contribution.installation, error.cause);
    throw error;
  }
}

function rejectUnavailable(
  environment: BindingEnvironment,
  message: string,
  contribution?: OwnedContribution,
): Promise<never> {
  const diagnostic = providerDiagnostic(
    environment.options,
    'unavailable-capability',
    message,
    'call',
    contribution?.installation,
    contribution,
  );
  reportDiagnostic(environment.options, diagnostic, contribution?.installation);
  return Promise.reject(operationError(diagnostic));
}

function localBinding<Capability extends CapabilityDescriptor>(
  environment: BindingEnvironment,
  contribution: OwnedContribution,
  capability: Capability,
): CapabilityBinding<Capability>;
function localBinding(
  environment: BindingEnvironment,
  contribution: OwnedContribution,
  capability: CapabilityDescriptor,
): CapabilityBinding<CapabilityDescriptor> {
  const api: Record<
    string,
    (input: unknown, options?: LocalInvocationOptions) => Promise<unknown>
  > = {};
  const registered = serviceDeclaration(contribution.definition);
  for (const name of Object.keys(capability.operations)) {
    const operations = registered?.capability.operations;
    const operation =
      operations !== undefined && Object.hasOwn(operations, name) ? operations[name] : undefined;
    const invoke = (input: unknown, options: LocalInvocationOptions = {}) => {
      if (operation === undefined)
        return rejectUnavailable(environment, `Operation ${name} is not registered`, contribution);
      return invokeOwned(environment, contribution, (implementation, signal) =>
        invokeLocalOperation({
          operation,
          input,
          options,
          context: localContext(environment, contribution),
          activationSignal: signal,
          handler: (value, context) => implementationMethod(implementation, name)(value, context),
        }),
      );
    };
    Object.defineProperty(api, name, { value: invoke, enumerable: true });
  }
  return {
    api: Object.freeze(api),
    context: Object.freeze({
      access: 'local',
      provider: environment.options.provider,
      execution: contribution.definition.execution,
      native: environment.options.native,
    }),
  };
}

export function resolveLocal<Capability extends CapabilityDescriptor>(
  environment: BindingEnvironment,
  capability: Capability,
): CapabilityResolution<Capability> {
  const contribution = findService(environment, capability);
  if (contribution?.status === 'active')
    return { status: 'available', binding: localBinding(environment, contribution, capability) };
  const reason = unavailableReason(environment, capability);
  const diagnostic = unavailableDiagnostic(environment, capability);
  if (reason === 'incompatible-contract') reportDiagnostic(environment.options, diagnostic);
  return { status: 'unavailable', reason, diagnostic };
}

export function requirementBindings(
  environment: BindingEnvironment,
  requirements: CapabilityRequirements,
): RequirementBindings<CapabilityRequirements> {
  const services: Record<string, CapabilityBinding<CapabilityDescriptor>> = {};
  for (const [name, capability] of Object.entries(requirements)) {
    const resolution = resolveLocal(environment, capability);
    if (resolution.status !== 'available')
      throw operationError(unavailableDiagnostic(environment, capability));
    Object.defineProperty(services, name, { value: resolution.binding, enumerable: true });
  }
  return Object.freeze(services);
}

export function invokeAction<Action extends ActionDescriptor>(
  environment: BindingEnvironment,
  request: ActionInvocationRequest<Action>,
): Promise<OperationValue<Action['operation']>>;
export function invokeAction(
  environment: BindingEnvironment,
  request: { readonly action: ActionDescriptor; readonly input: unknown } & LocalInvocationOptions,
): Promise<unknown> {
  const { action, input } = request;
  const contribution = allContributions(environment).find((candidate) => {
    const definition = actionDeclaration(candidate.definition);
    return (
      candidate.status === 'active' &&
      definition?.contract.id === action.id &&
      definition.contract.version === action.version
    );
  });
  const definition =
    contribution === undefined ? undefined : actionDeclaration(contribution.definition);
  if (contribution === undefined || definition === undefined)
    return rejectUnavailable(environment, `Action ${action.id}@${action.version} is unavailable`);
  return invokeOwned(environment, contribution, (_value, signal) =>
    invokeLocalOperation({
      operation: definition.contract.operation,
      input,
      options: request,
      context: localContext(environment, contribution),
      activationSignal: signal,
      handler: (value, context) =>
        callRecipe(definition.handler, {
          ...context,
          input: value,
          services: requirementBindings(environment, definition.requires),
        }),
    }),
  );
}
