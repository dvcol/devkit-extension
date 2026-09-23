import { definePlugin } from '@devkit/core';
import type { PluginDefinition, ServiceDeclaration } from '@devkit/core';

import type { StartupComposition } from './admission.js';
import type { ProviderReconciliation } from './provider-reconciliation.js';
import { providerDiagnostic } from './provider-status.js';
import { validateOriginal } from './validation.js';

export function snapshotComposition(composition: StartupComposition): StartupComposition {
  const services = (composition.services ?? []).map((service) => {
    const snapshot = definePlugin({ id: service.id, services: [service] }).services[0];
    if (snapshot === undefined) throw new Error('Missing service definition');
    return snapshot;
  });
  const plugins = (composition.plugins ?? []).map((plugin) => {
    const { kind, ...input } = plugin;
    if (kind !== 'plugin') throw new TypeError('Expected a plugin definition');
    return definePlugin(input);
  });
  return { services, plugins };
}

export function singleComposition(
  kind: 'service' | 'plugin',
  definition: ServiceDeclaration | PluginDefinition,
): StartupComposition {
  if (kind === 'service' && definition.kind === 'service') return { services: [definition] };
  if (kind === 'plugin' && definition.kind === 'plugin') return { plugins: [definition] };
  throw new TypeError(`Expected ${kind} definition`);
}

export async function validatePayloads(
  composition: StartupComposition,
  environment: ProviderReconciliation,
): Promise<void> {
  for (const plugin of composition.plugins ?? []) {
    for (const extension of plugin.extensions ?? []) {
      const installer = environment.kinds.get(extension.descriptor.id);
      if (installer === undefined)
        throw new TypeError(`Unknown custom kind ${extension.descriptor.id}`);
      await validateOriginal(
        installer.descriptor.schema,
        extension.payload,
        providerDiagnostic(
          environment.options,
          'invalid-definition',
          `Custom contribution ${extension.id} payload failed validation`,
          'admission',
        ),
      );
    }
  }
}
