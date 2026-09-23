import { defineRealm } from '@devkit/core';
import type { ProviderDescriptor } from '@devkit/core';

/** Capture identity before asynchronous work can observe a caller's mutable descriptor alias. */
export function snapshotProvider(provider: ProviderDescriptor): ProviderDescriptor {
  const { id, incarnation, realm } = provider;
  if (typeof incarnation !== 'string' || incarnation.trim().length === 0)
    throw new TypeError('Provider incarnation must be a non-empty string');
  return Object.freeze({ id, incarnation, realm: defineRealm(realm) });
}
