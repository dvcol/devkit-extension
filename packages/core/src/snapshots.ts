import type {
  ActionDeclaration,
  ActionDescriptor,
  CapabilityDescriptor,
  CapabilityRequirements,
  ContributionDeclaration,
  ContributionKindDescriptor,
  ExecutionDescriptor,
  ExtensionDefinition,
  OperationDefinition,
  ServiceDeclaration,
} from './types.js';

/** Own declaration envelopes, retaining author-owned schemas, payloads and executable functions. */
export function snapshotExecution<Execution extends ExecutionDescriptor>(
  execution: Execution,
): Execution {
  return Object.freeze({ ...execution, id: execution.id });
}

export function snapshotOperation<Operation extends OperationDefinition>(
  operation: Operation,
): Operation {
  return Object.freeze({
    ...operation,
    input: operation.input,
    output: operation.output,
    target: operation.target,
  });
}

function snapshotOperations<Operations extends Readonly<Record<string, OperationDefinition>>>(
  operations: Operations,
): Operations {
  const snapshot = { ...operations };
  for (const [name, operation] of Object.entries(operations)) {
    Object.defineProperty(snapshot, name, {
      value: snapshotOperation(operation),
      enumerable: true,
    });
  }
  return Object.freeze(snapshot);
}

export function snapshotCapability<Capability extends CapabilityDescriptor>(
  capability: Capability,
): Capability {
  return Object.freeze({
    ...capability,
    id: capability.id,
    version: capability.version,
    operations: snapshotOperations(capability.operations),
  });
}

export function snapshotAction<Action extends ActionDescriptor>(action: Action): Action {
  return Object.freeze({
    ...action,
    id: action.id,
    version: action.version,
    operation: snapshotOperation(action.operation),
  });
}

function snapshotRequirements<Requirements extends CapabilityRequirements>(
  requirements: Requirements,
): Requirements {
  const snapshot = { ...requirements };
  for (const [name, capability] of Object.entries(requirements)) {
    Object.defineProperty(snapshot, name, {
      value: snapshotCapability(capability),
      enumerable: true,
    });
  }
  return Object.freeze(snapshot);
}

export function snapshotService<Service extends ServiceDeclaration>(service: Service): Service {
  return Object.freeze({
    ...service,
    id: service.id,
    execution: snapshotExecution(service.execution),
    capability: snapshotCapability(service.capability),
    requires: snapshotRequirements(service.requires),
  });
}

export function snapshotActionContribution<Action extends ActionDeclaration>(
  action: Action,
): Action {
  return Object.freeze({
    ...action,
    id: action.id,
    execution: snapshotExecution(action.execution),
    contract: snapshotAction(action.contract),
    requires: snapshotRequirements(action.requires),
  });
}

export function snapshotKind<Kind extends ContributionKindDescriptor>(kind: Kind): Kind {
  return Object.freeze({ ...kind, id: kind.id, schema: kind.schema });
}

export function snapshotExtension<Extension extends ExtensionDefinition>(
  extension: Extension,
): Extension {
  return Object.freeze({
    ...extension,
    id: extension.id,
    execution: snapshotExecution(extension.execution),
    descriptor: snapshotKind(extension.descriptor),
  });
}

export function snapshotContribution<Contribution extends ContributionDeclaration>(
  contribution: Contribution,
): Contribution {
  return Object.freeze({
    ...contribution,
    id: contribution.id,
    execution: snapshotExecution(contribution.execution),
  });
}
