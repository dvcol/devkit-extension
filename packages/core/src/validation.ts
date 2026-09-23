import type { StandardSchemaV1 } from '@standard-schema/spec';

import type {
  ActionDescriptor,
  ActionDeclaration,
  CapabilityDescriptor,
  ContributionDeclaration,
  ContributionKindDescriptor,
  OperationDefinition,
  ExtensionDefinition,
  ServiceDeclaration,
} from './types.js';

export function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

export function assertKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) {
      throw new TypeError(`${label} contains unknown field ${String(key)}`);
    }
  }
}

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty identifier`);
  }
}

export function assertVersion(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

export function assertIdentityDescriptor(value: unknown, label: string): void {
  assertRecord(value, label);
  assertKeys(value, ['id'], label);
  assertIdentifier(value.id, `${label}.id`);
}

/** Inspect the Standard Schema protocol without running user-supplied validation. */
export function assertSchema(value: unknown, label: string): asserts value is StandardSchemaV1 {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    !('~standard' in value)
  ) {
    throw new TypeError(`${label} must implement Standard Schema v1`);
  }
  const standard = value['~standard'];
  assertRecord(standard, `${label}.~standard`);
  if (standard.version !== 1 || typeof standard.validate !== 'function') {
    throw new TypeError(`${label} must implement Standard Schema v1`);
  }
  assertIdentifier(standard.vendor, `${label}.~standard.vendor`);
}

export function assertOperation(
  value: unknown,
  label: string,
): asserts value is OperationDefinition {
  assertRecord(value, label);
  assertKeys(value, ['input', 'output', 'target'], label);
  assertSchema(value.input, `${label}.input`);
  assertSchema(value.output, `${label}.output`);
  if (value.target !== 'none' && value.target !== 'required') {
    throw new TypeError(`${label}.target must be required or none`);
  }
}

export function assertCapability(
  value: unknown,
  label: string,
): asserts value is CapabilityDescriptor {
  assertRecord(value, label);
  assertKeys(value, ['kind', 'id', 'version', 'operations'], label);
  if (value.kind !== 'capability') throw new TypeError(`${label}.kind must be capability`);
  assertIdentifier(value.id, `${label}.id`);
  assertVersion(value.version, `${label}.version`);
  assertRecord(value.operations, `${label}.operations`);
  for (const operationName of Reflect.ownKeys(value.operations)) {
    assertIdentifier(operationName, `${label} operation name`);
    assertOperation(value.operations[operationName], `${label}.operations.${operationName}`);
  }
}

export function assertAction(value: unknown, label: string): asserts value is ActionDescriptor {
  assertRecord(value, label);
  assertKeys(value, ['kind', 'id', 'version', 'operation'], label);
  if (value.kind !== 'action-contract')
    throw new TypeError(`${label}.kind must be action-contract`);
  assertIdentifier(value.id, `${label}.id`);
  assertVersion(value.version, `${label}.version`);
  assertOperation(value.operation, `${label}.operation`);
}

export function assertContribution(
  value: unknown,
  kind: string,
  label: string,
): asserts value is ContributionDeclaration {
  assertRecord(value, label);
  if (value.kind !== kind) throw new TypeError(`${label}.kind must be ${kind}`);
  assertIdentifier(value.id, `${label}.id`);
  assertIdentityDescriptor(value.execution, `${label}.execution`);
}

export function assertRequirements(value: unknown, label: string): void {
  assertRecord(value, label);
  for (const requirementName of Reflect.ownKeys(value)) {
    assertIdentifier(requirementName, `${label} requirement name`);
    assertCapability(value[requirementName], `${label}.${requirementName}`);
  }
}

export function assertKind(
  value: unknown,
  label: string,
): asserts value is ContributionKindDescriptor {
  assertRecord(value, label);
  assertKeys(value, ['id', 'schema'], label);
  assertIdentifier(value.id, `${label}.id`);
  assertSchema(value.schema, `${label}.schema`);
}

export function assertService(value: unknown, label: string): asserts value is ServiceDeclaration {
  assertRecord(value, label);
  assertKeys(value, ['kind', 'id', 'execution', 'capability', 'requires', 'setup'], label);
  assertContribution(value, 'service', label);
  assertCapability(value.capability, `${label}.capability`);
  assertRequirements(value.requires, `${label}.requires`);
  if (typeof value.setup !== 'function') throw new TypeError(`${label}.setup must be a function`);
}

export function assertActionContribution(
  value: unknown,
  label: string,
): asserts value is ActionDeclaration {
  assertRecord(value, label);
  assertKeys(value, ['kind', 'id', 'execution', 'contract', 'requires', 'handler'], label);
  assertContribution(value, 'action', label);
  assertAction(value.contract, `${label}.contract`);
  assertRequirements(value.requires, `${label}.requires`);
  if (typeof value.handler !== 'function')
    throw new TypeError(`${label}.handler must be a function`);
}

export function assertExtension(
  value: unknown,
  label: string,
): asserts value is ExtensionDefinition {
  assertRecord(value, label);
  assertKeys(value, ['kind', 'id', 'execution', 'descriptor', 'payload'], label);
  assertContribution(value, 'extension', label);
  assertKind(value.descriptor, `${label}.descriptor`);
  if (!Object.hasOwn(value, 'payload')) throw new TypeError(`${label}.payload is required`);
}
