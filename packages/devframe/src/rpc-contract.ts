/** These names map imported SDK contracts onto native methods; payloads keep the native codec. */
export function actionMethod(providerId: string, id: string, version: number): string {
  return `devkit:${JSON.stringify([providerId, 'action', id, version])}`;
}

export function capabilityMethod(
  providerId: string,
  contract: { readonly id: string; readonly version: number },
  operation: string,
): string {
  return `devkit:${JSON.stringify([providerId, 'capability', contract.id, contract.version, operation])}`;
}

export function catalogMethod(providerId: string): string {
  return `devkit:${JSON.stringify([providerId, 'catalog'])}`;
}

/** Carries no catalog, identity, permission or diagnostic data. Reads use native authorization. */
export const catalogChanged = 'devkit:catalog:changed';

declare module 'devframe/types' {
  interface DevframeRpcClientFunctions {
    'devkit:catalog:changed': () => void;
  }
}
