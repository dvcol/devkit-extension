import { definePlugin, isOperationError } from '@devkit/core';
import type {
  ActionDeclaration,
  ContributionDeclaration,
  ContributionKindDescriptor,
  ContributionKindInstaller,
  PluginDefinition,
  RuntimeDiagnostic,
  ServiceDeclaration,
} from '@devkit/core';

import { operationError } from './errors.js';

export interface StartupComposition {
  readonly services?: readonly ServiceDeclaration[];
  readonly plugins?: readonly PluginDefinition[];
}

export interface Reservation {
  readonly id: string;
  readonly kind: 'plugin' | 'service';
  readonly services: readonly ServiceDeclaration[];
  readonly actions: readonly ActionDeclaration[];
  readonly contributions: readonly ContributionDeclaration[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
}

export type Admission =
  | { readonly status: 'reserved'; readonly reservation: Reservation }
  | { readonly status: 'skipped'; readonly diagnostic: RuntimeDiagnostic };

interface RegistryOptions {
  readonly providerId: string;
  readonly strict?: boolean;
  readonly kinds?: readonly ContributionKindInstaller<ContributionKindDescriptor>[];
}

/** Synchronous admission reserves the entire batch before any asynchronous setup runs. */
export function createAdmissionRegistry(options: RegistryOptions) {
  const owners = new Map<string, Reservation>();
  const customKinds = new Set(options.kinds?.map((installer) => installer.descriptor.id));
  if (customKinds.size !== (options.kinds?.length ?? 0)) {
    throw operationError(
      createDiagnostic(options, 'duplicate-registration', 'Duplicate custom kind installer'),
    );
  }

  function reserve(composition: StartupComposition): readonly Admission[] {
    try {
      return reserveBatch(composition);
    } catch (cause) {
      if (isOperationError(cause)) throw cause;
      throw operationError(
        createDiagnostic(options, 'invalid-definition', 'Admission contains an invalid definition'),
        cause,
      );
    }
  }

  function reserveBatch(composition: StartupComposition): readonly Admission[] {
    const pending = new Map(owners);
    const incoming: Admission[] = [];
    for (const service of composition.services ?? []) {
      const definition = { id: service.id, services: [service] };
      incoming.push(
        admitDefinition(definePlugin(definition), 'service', pending, options, customKinds),
      );
    }
    for (const plugin of composition.plugins ?? []) {
      incoming.push(
        admitDefinition(definePlugin(pluginInput(plugin)), 'plugin', pending, options, customKinds),
      );
    }
    assertAcyclic(pending, options);
    for (const [key, owner] of pending) {
      owners.set(key, owner);
    }
    return incoming;
  }

  function release(reservation: Reservation): void {
    for (const [key, owner] of owners) {
      if (owner === reservation) owners.delete(key);
    }
  }

  return { reserve, release };
}

function pluginInput(plugin: PluginDefinition) {
  const { kind, ...definition } = plugin;
  if (kind !== 'plugin') throw new TypeError('Expected a plugin definition');
  return definition;
}

function admitDefinition(
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

function contractKey(
  kind: string,
  contract: { readonly id: string; readonly version: number },
): string {
  return JSON.stringify([kind, contract.id, contract.version]);
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

/** Include already waiting services so later installation cannot close a dependency cycle. */
function assertAcyclic(owners: ReadonlyMap<string, Reservation>, options: RegistryOptions): void {
  const services = new Map<string, ServiceDeclaration>();
  for (const owner of new Set(owners.values())) {
    for (const service of owner.services)
      services.set(contractKey('capability', service.capability), service);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw operationError(
        createDiagnostic(
          options,
          'dependency-cycle',
          `Capability dependency cycle includes ${key}`,
        ),
      );
    }
    const service = services.get(key);
    if (!service) return;
    visiting.add(key);
    for (const requirement of Object.values(service.requires))
      visit(contractKey('capability', requirement));
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of services.keys()) visit(key);
}

function createDiagnostic(
  options: RegistryOptions,
  code: string,
  message: string,
  pluginId?: string,
  contributionId?: string,
): RuntimeDiagnostic {
  return {
    code,
    message,
    severity: 'error',
    phase: 'admission',
    providerId: options.providerId,
    ...(pluginId === undefined ? {} : { pluginId }),
    ...(contributionId === undefined ? {} : { contributionId }),
  };
}
