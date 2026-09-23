import type {
  ContributionDeclaration,
  PluginDefinition,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';
import type { Admission, RegistryOptions, Reservation } from './admission.js';
import { operationError } from './errors.js';
import { createDiagnostic } from './provider-admission-diagnostic.js';
import { contractKey } from './provider-admission-graph.js';

export function pluginInput(plugin: PluginDefinition) {
  const { kind, ...definition } = plugin;
  if (kind !== 'plugin') throw new TypeError('Expected a plugin definition');
  return definition;
}

export function admitDefinition(
  definition: PluginDefinition,
  kind: Reservation['kind'],
  owners: Map<string, Reservation>,
  options: RegistryOptions,
  customKinds: ReadonlySet<string>,
): Admission {
  const contributions = collectContributions(definition);
  assertUniqueContributionIds(contributions, options, definition.id);
  assertKnownKinds(definition, customKinds, options);
  const { services, diagnostics, reservedKeys } = selectServices(definition, owners, options);
  if (kind === 'service' && services.length === 0) {
    const diagnostic = diagnostics[0];
    if (!diagnostic) throw new Error('Missing duplicate admission diagnostic');
    return { status: 'skipped', diagnostic };
  }
  reserveInstallationAndActions(definition, kind, owners, options, reservedKeys);
  const admittedServices = new Set<ContributionDeclaration>(services);
  const reservation: Reservation = Object.freeze({
    id: definition.id,
    kind,
    services: Object.freeze(services),
    actions: Object.freeze([...(definition.actions ?? [])]),
    contributions: Object.freeze(
      contributions.filter(
        (contribution) => contribution.kind !== 'service' || admittedServices.has(contribution),
      ),
    ),
    diagnostics: Object.freeze(diagnostics),
  });
  for (const key of reservedKeys) owners.set(key, reservation);
  return { status: 'reserved', reservation };
}

function collectContributions(definition: PluginDefinition): ContributionDeclaration[] {
  return [
    ...(definition.services ?? []),
    ...(definition.actions ?? []),
    ...(definition.views ?? []),
    ...(definition.transforms ?? []),
    ...(definition.scripts ?? []),
    ...(definition.extensions ?? []),
  ];
}

function assertKnownKinds(
  definition: PluginDefinition,
  customKinds: ReadonlySet<string>,
  options: RegistryOptions,
): void {
  for (const extension of definition.extensions ?? []) {
    if (!customKinds.has(extension.descriptor.id)) {
      throw operationError(
        createDiagnostic(
          options,
          'invalid-definition',
          `Unknown contribution kind ${extension.descriptor.id}`,
          definition.id,
        ),
      );
    }
  }
}

function selectServices(
  definition: PluginDefinition,
  owners: ReadonlyMap<string, Reservation>,
  options: RegistryOptions,
) {
  const diagnostics: RuntimeDiagnostic[] = [];
  const services: ServiceDeclaration[] = [];
  const reservedKeys = new Set<string>();
  for (const service of definition.services ?? []) {
    const key = contractKey('capability', service.capability);
    if (owners.has(key) || reservedKeys.has(key)) {
      const diagnostic = createDiagnostic(
        options,
        'duplicate-registration',
        `Capability ${service.capability.id}@${service.capability.version} is already registered`,
        definition.id,
        service.id,
      );
      if (options.strict !== false) throw operationError(diagnostic);
      diagnostics.push({ ...diagnostic, severity: 'warning' });
      continue;
    }
    reservedKeys.add(key);
    services.push(service);
  }
  return { diagnostics, services, reservedKeys };
}

function reserveInstallationAndActions(
  definition: PluginDefinition,
  kind: Reservation['kind'],
  owners: ReadonlyMap<string, Reservation>,
  options: RegistryOptions,
  reservedKeys: Set<string>,
): void {
  const installationKey = JSON.stringify(['installation', kind, definition.id]);
  if (owners.has(installationKey)) {
    throw operationError(
      createDiagnostic(
        options,
        'duplicate-registration',
        `Installation ${definition.id} is already registered`,
        definition.id,
      ),
    );
  }
  reservedKeys.add(installationKey);
  for (const action of definition.actions ?? []) {
    const key = contractKey('action', action.contract);
    if (owners.has(key) || reservedKeys.has(key)) {
      throw operationError(
        createDiagnostic(
          options,
          'duplicate-registration',
          `Action ${action.contract.id}@${action.contract.version} is already registered`,
          definition.id,
          action.id,
        ),
      );
    }
    reservedKeys.add(key);
  }
}

function assertUniqueContributionIds(
  contributions: readonly ContributionDeclaration[],
  options: RegistryOptions,
  pluginId: string,
): void {
  const identifiers = new Set<string>();
  for (const contribution of contributions) {
    if (identifiers.has(contribution.id)) {
      throw operationError(
        createDiagnostic(
          options,
          'duplicate-registration',
          `Duplicate contribution ${contribution.id}`,
          pluginId,
          contribution.id,
        ),
      );
    }
    identifiers.add(contribution.id);
  }
}
