import type { ProviderCatalogSnapshot } from '@devkit/core';
import type { ExposedMethod, ExposedProvider } from './exposure-methods.js';
import { actionMethod, capabilityMethod } from './rpc-contract.js';
import type { RpcProviderComposition } from './types.js';

/** Only explicitly exposed contracts enter the remote catalog; local additions remain private. */
export function projectCatalog(
  composition: RpcProviderComposition<boolean>,
  methods: readonly ExposedMethod[],
) {
  const names = new Set(methods.map((method) => method.name));
  const capabilities = new Set(
    (composition.expose?.capabilities ?? []).map(({ id, version }) =>
      JSON.stringify([id, version]),
    ),
  );
  return (provider: ExposedProvider | undefined): ProviderCatalogSnapshot | undefined => {
    if (provider === undefined) return undefined;
    const catalog = provider.catalog.snapshot();
    return {
      provider: catalog.provider,
      status: catalog.status,
      actions: catalog.actions.filter(({ id, version }) =>
        names.has(actionMethod(catalog.provider.id, id, version)),
      ),
      capabilities: catalog.capabilities
        .filter(({ id, version }) => capabilities.has(JSON.stringify([id, version])))
        .map((capability) => ({
          ...capability,
          operations: capability.operations.filter(({ name }) =>
            names.has(capabilityMethod(catalog.provider.id, capability, name)),
          ),
        })),
    };
  };
}
