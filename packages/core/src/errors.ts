import type { OperationError, RuntimeDiagnostic } from './runtime-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalIdentifier(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

const diagnosticPhases: readonly RuntimeDiagnostic['phase'][] = [
  'admission',
  'setup',
  'call',
  'cleanup',
  'transport',
];

function isDiagnostic(value: unknown): value is RuntimeDiagnostic {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.code) &&
    (value.severity === 'error' || value.severity === 'warning') &&
    typeof value.message === 'string' &&
    isNonEmptyString(value.providerId) &&
    isOptionalIdentifier(value.pluginId) &&
    isOptionalIdentifier(value.contributionId) &&
    diagnosticPhases.some((phase) => phase === value.phase)
  );
}

/** Accept portable error records without relying on a native Error prototype crossing realms. */
export function isOperationError(error: unknown): error is OperationError {
  if (!isRecord(error)) return false;
  return (
    typeof error.name === 'string' &&
    typeof error.message === 'string' &&
    (error.stack === undefined || typeof error.stack === 'string') &&
    isNonEmptyString(error.code) &&
    isDiagnostic(error.diagnostic) &&
    error.code === error.diagnostic.code
  );
}
