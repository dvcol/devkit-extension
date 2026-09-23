import type {
  ActivationScope,
  CapabilityRequirements,
  ContributionKindDescriptor,
  ContributionKindInstaller,
} from '@devkit/core';

import { createActivation } from './activation.js';
import type { BindingEnvironment } from './provider-bindings.js';
import { callRecipe, implementationMethod, requirementBindings } from './provider-bindings.js';
import {
  contributionDiagnostic,
  notifyInstallation,
  providerDiagnostic,
} from './provider-status.js';
import { actionDeclaration, extensionDeclaration, serviceDeclaration } from './provider-types.js';
import type { OwnedContribution } from './provider-types.js';
import { validateOriginal } from './validation.js';

export interface ActivationEnvironment extends BindingEnvironment {
  readonly kinds: ReadonlyMap<string, ContributionKindInstaller<ContributionKindDescriptor>>;
  refresh(): void;
}

export function requirementsOf(contribution: OwnedContribution): CapabilityRequirements {
  return (
    serviceDeclaration(contribution.definition)?.requires ??
    actionDeclaration(contribution.definition)?.requires ??
    {}
  );
}

async function setupContribution(
  environment: ActivationEnvironment,
  contribution: OwnedContribution,
  scope: ActivationScope,
): Promise<unknown> {
  const definition = contribution.definition;
  const context = {
    provider: environment.options.provider,
    execution: definition.execution,
    native: environment.options.native,
    scope,
    services: requirementBindings(environment, requirementsOf(contribution)),
  };
  const service = serviceDeclaration(definition);
  if (service !== undefined) {
    const implementation = await callRecipe(service.setup, context);
    for (const operation of Object.keys(service.capability.operations))
      implementationMethod(implementation, operation);
    return implementation;
  }
  if (actionDeclaration(definition) !== undefined) return undefined;
  const extension = extensionDeclaration(definition);
  if (extension === undefined) throw new Error('Contribution kind has no activation handler');
  const installer = environment.kinds.get(extension.descriptor.id);
  if (installer === undefined) throw new Error('Custom contribution installer is unavailable');
  await validateOriginal(
    installer.descriptor.schema,
    extension.payload,
    providerDiagnostic(
      environment.options,
      'invalid-definition',
      'Custom contribution payload failed validation',
      'setup',
      contribution.installation,
      contribution,
    ),
  );
  scope.signal.throwIfAborted();
  await installer.activate(extension, context);
  return undefined;
}

export function startContribution(
  environment: ActivationEnvironment,
  contribution: OwnedContribution,
): void {
  const activation = createActivation<unknown>();
  contribution.activation = activation;
  contribution.generation += 1;
  contribution.status = 'starting';
  contribution.reason = undefined;
  const transition = Promise.resolve().then(() => completeStart(environment, contribution));
  contribution.transition = transition;
  void transition.finally(() => {
    if (contribution.transition === transition) contribution.transition = undefined;
    environment.refresh();
  });
  notifyInstallation(contribution.installation, environment.options);
}

async function completeStart(
  environment: ActivationEnvironment,
  contribution: OwnedContribution,
): Promise<void> {
  const activation = contribution.activation;
  if (activation === undefined) throw new Error('Missing activation');
  try {
    await activation.start((scope) => setupContribution(environment, contribution, scope));
    if (contribution.status === 'starting') contribution.status = 'active';
  } catch (cause) {
    if (contribution.status !== 'starting') return;
    contribution.failed = true;
    contributionDiagnostic(
      contribution,
      environment.options,
      'setup-failure',
      'Contribution setup failed',
      'setup',
      cause,
    );
    if (activation.snapshot().status === 'cleanup-blocked') {
      contribution.status = 'cleanup-blocked';
      contributionDiagnostic(
        contribution,
        environment.options,
        'cleanup-failure',
        'Setup failure cleanup did not complete successfully',
        'cleanup',
        activation.snapshot().cleanupFailure,
      );
    } else {
      contribution.status = 'failed';
    }
  }
  notifyInstallation(contribution.installation, environment.options);
}
