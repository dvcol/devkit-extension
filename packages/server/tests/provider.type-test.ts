import type { DevframeHubContext } from '@devframes/hub/node';
import type { InstallationHandle, InstallationResult } from '@devkit/core';

import { createDevframeProvider } from '../src/index.js';
import { counterCapability, counterPlugin, incrementAction } from './fixtures.js';

export async function providerStartupTypes(
  context: DevframeHubContext,
  strict: boolean,
): Promise<void> {
  const provider = await createDevframeProvider({
    context,
    providerId: 'example.strict',
    plugins: [counterPlugin],
    expose: { actions: [incrementAction], capabilities: [counterCapability] },
  });
  (await provider.plugins.install(counterPlugin)) satisfies InstallationHandle;
  const relaxed = await createDevframeProvider({
    context,
    providerId: 'example.relaxed',
    strict: false,
  });
  (await relaxed.plugins.install(counterPlugin)) satisfies InstallationResult<false>;
  const configured = await createDevframeProvider({
    context,
    providerId: 'example.configured',
    strict,
  });
  (await configured.plugins.install(counterPlugin)) satisfies InstallationResult<boolean>;
  // @ts-expect-error Native context and composition belong to the same startup object.
  await createDevframeProvider(context, { providerId: 'old-shape' });
  await createDevframeProvider({
    context,
    providerId: 'example.invalid-exposure',
    // @ts-expect-error Exposure contains contracts, not executable plugin definitions.
    expose: { actions: [counterPlugin] },
  });
}
