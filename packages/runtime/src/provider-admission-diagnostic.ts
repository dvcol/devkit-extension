import type { RuntimeDiagnostic } from '@devkit/core';

export function createDiagnostic(
  options: { readonly providerId: string },
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
