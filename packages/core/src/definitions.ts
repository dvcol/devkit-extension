import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  snapshotAction,
  snapshotActionContribution,
  snapshotCapability,
  snapshotContribution,
  snapshotExecution,
  snapshotExtension,
  snapshotKind,
  snapshotOperation,
  snapshotService,
} from './snapshots.js';

import type {
  ActionDefinition,
  ActionDeclaration,
  ActionDescriptor,
  Awaitable,
  CapabilityDescriptor,
  CapabilityImplementation,
  CapabilityRequirements,
  ContributionKindDescriptor,
  ContributionDeclaration,
  ExecutionDescriptor,
  ExtensionDefinition,
  NativeContextDescriptor,
  OperationDefinition,
  PluginDefinition,
  PluginInput,
  RealmDescriptor,
  ServiceDefinition,
  ServiceDeclaration,
  SetupContext,
} from './types.js';
import {
  assertAction,
  assertActionContribution,
  assertCapability,
  assertContribution,
  assertExtension,
  assertIdentifier,
  assertIdentityDescriptor,
  assertKeys,
  assertKind,
  assertOperation,
  assertRecord,
  assertRequirements,
  assertService,
} from './validation.js';

export function defineRealm<const Identifier extends string>(
  definition: RealmDescriptor<Identifier>,
): RealmDescriptor<Identifier> {
  assertIdentityDescriptor(definition, 'realm');
  return Object.freeze({ ...definition, id: definition.id });
}

export function defineExecution<const Identifier extends string>(
  definition: ExecutionDescriptor<Identifier>,
): ExecutionDescriptor<Identifier> {
  assertIdentityDescriptor(definition, 'execution');
  return snapshotExecution(definition);
}

export function defineNativeContext<Value>(definition: {
  readonly id: string;
}): NativeContextDescriptor<Value> {
  assertIdentityDescriptor(definition, 'native context');
  return Object.freeze({ ...definition, id: definition.id });
}

export function defineOperation<const Definition extends OperationDefinition>(
  definition: Definition,
): Definition {
  assertOperation(definition, 'operation');
  return snapshotOperation(definition);
}

export function defineCapability<const Definition extends Omit<CapabilityDescriptor, 'kind'>>(
  definition: Definition,
): Readonly<Definition> & { readonly kind: 'capability' } {
  assertRecord(definition, 'capability');
  assertKeys(definition, ['id', 'version', 'operations'], 'capability');
  const capability = { ...definition, kind: 'capability' as const };
  assertCapability(capability, 'capability');
  return snapshotCapability(capability);
}

export function defineActionContract<const Definition extends Omit<ActionDescriptor, 'kind'>>(
  definition: Definition,
): Readonly<Definition> & { readonly kind: 'action-contract' } {
  assertRecord(definition, 'action contract');
  assertKeys(definition, ['id', 'version', 'operation'], 'action contract');
  const action = { ...definition, kind: 'action-contract' as const };
  assertAction(action, 'action contract');
  return snapshotAction(action);
}

export function defineService<
  Capability extends CapabilityDescriptor,
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly capability: Capability;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  setup(
    context: SetupContext<NoInfer<Requirements>>,
  ): Awaitable<CapabilityImplementation<NoInfer<Capability>>>;
}): ServiceDefinition<Capability, Requirements>;
export function defineService(
  definition: Omit<ServiceDeclaration, 'kind' | 'requires'> & {
    readonly requires?: CapabilityRequirements;
  },
): ServiceDeclaration {
  assertRecord(definition, 'service');
  assertKeys(definition, ['capability', 'id', 'execution', 'requires', 'setup'], 'service');
  if (Object.hasOwn(definition, 'requires'))
    assertRequirements(definition.requires, 'service.requires');
  const service = {
    ...definition,
    kind: 'service' as const,
    requires: definition.requires ?? {},
  };
  assertService(service, 'service');
  return snapshotService(service);
}

export function defineAction<
  Action extends ActionDescriptor,
  const Requirements extends CapabilityRequirements = Record<never, never>,
>(definition: {
  readonly contract: Action;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly requires?: Requirements;
  handler: ActionDefinition<NoInfer<Action>, NoInfer<Requirements>>['handler'];
}): ActionDefinition<Action, Requirements>;
export function defineAction(
  definition: Omit<ActionDeclaration, 'kind' | 'requires'> & {
    readonly requires?: CapabilityRequirements;
  },
): ActionDeclaration {
  assertRecord(definition, 'action contribution');
  assertKeys(
    definition,
    ['contract', 'id', 'execution', 'requires', 'handler'],
    'action contribution',
  );
  if (Object.hasOwn(definition, 'requires'))
    assertRequirements(definition.requires, 'action contribution.requires');
  const contribution = {
    ...definition,
    kind: 'action' as const,
    requires: definition.requires ?? {},
  };
  assertActionContribution(contribution, 'action contribution');
  return snapshotActionContribution(contribution);
}

export function defineContributionKind<const Kind extends ContributionKindDescriptor>(
  definition: Kind,
): Kind {
  assertKind(definition, 'contribution kind');
  return snapshotKind(definition);
}

export function defineExtension<const Kind extends ContributionKindDescriptor>(definition: {
  readonly descriptor: Kind;
  readonly id: string;
  readonly execution: ExecutionDescriptor;
  readonly payload: StandardSchemaV1.InferInput<NoInfer<Kind>['schema']>;
}): ExtensionDefinition<Kind> {
  assertRecord(definition, 'extension');
  assertKeys(definition, ['descriptor', 'id', 'execution', 'payload'], 'extension');
  const extension = { ...definition, kind: 'extension' as const };
  assertExtension(extension, 'extension');
  return snapshotExtension(extension);
}

const pluginListKinds = {
  services: 'service',
  actions: 'action',
  views: 'view',
  transforms: 'transform',
  scripts: 'script',
  extensions: 'extension',
} as const;

function isContributionList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function snapshotPluginEntry(value: unknown, kind: string, label: string): ContributionDeclaration {
  if (kind === 'service') {
    assertService(value, label);
    return snapshotService(value);
  }
  if (kind === 'action') {
    assertActionContribution(value, label);
    return snapshotActionContribution(value);
  }
  if (kind === 'extension') {
    assertExtension(value, label);
    return snapshotExtension(value);
  }
  /** Domain adapters validate view, transform and script fields beyond this common envelope. */
  assertContribution(value, kind, label);
  return snapshotContribution(value);
}

export function definePlugin<const Input extends PluginInput>(
  definition: Input & Record<Exclude<keyof Input, keyof PluginInput>, never>,
): PluginDefinition<Input> {
  assertRecord(definition, 'plugin');
  assertKeys(definition, ['id', ...Object.keys(pluginListKinds)], 'plugin');
  assertIdentifier(definition.id, 'plugin.id');
  const plugin = { ...definition, kind: 'plugin' as const };
  for (const listName of [
    'services',
    'actions',
    'views',
    'transforms',
    'scripts',
    'extensions',
  ] as const) {
    if (!Object.hasOwn(definition, listName)) continue;
    const contributions = definition[listName];
    if (!isContributionList(contributions))
      throw new TypeError(`plugin.${listName} must be an array`);
    const snapshot = contributions.map((contribution, index) =>
      snapshotPluginEntry(contribution, pluginListKinds[listName], `plugin.${listName}[${index}]`),
    );
    Object.defineProperty(plugin, listName, {
      value: Object.freeze(snapshot),
      enumerable: true,
    });
  }
  return Object.freeze(plugin);
}
