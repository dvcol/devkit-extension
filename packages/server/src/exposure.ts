import type { DevframeHubContext } from '@devframes/hub/node';
import { styleText } from 'node:util';

import { exposureIdentity, exposureMethods, incarnationSchema } from './exposure-methods.js';
import type { ExposedMethod, ExposedProvider } from './exposure-methods.js';
import type { ServerComposition } from './types.js';
import { catalogSchema } from './catalog-schema.js';
import { projectCatalog } from './catalog-exposure.js';
import { catalogChanged, catalogMethod } from './rpc-contract.js';

interface HostExposure {
  readonly identity: string;
  current: ExposedProvider | undefined;
  failed: boolean;
}

export interface PreparedExposure {
  publish(provider: ExposedProvider): void;
  clear(): void;
}

const exposures = new WeakMap<DevframeHubContext, HostExposure>();

/** Reserve a finite host contract once; successful provider startup supplies its implementation. */
export function prepareExposure(
  context: DevframeHubContext,
  composition: ServerComposition<boolean>,
): PreparedExposure | undefined {
  if (composition.expose === undefined) return undefined;
  const methods = exposureMethods(composition);
  const exposure = exposures.get(context) ?? registerExposure(context, methods, composition);
  if (exposure.failed)
    throw new Error(
      'Native RPC exposure is blocked after registration failure; recreate the native host',
    );
  if (exposure.identity !== exposureIdentity(composition, methods))
    throw new Error(
      'Exposed contracts are fixed for this native host; recreate the host to change them',
    );
  let unsubscribe: (() => void) | undefined;
  const notify = () => {
    void context.rpc
      .broadcast({ method: catalogChanged, args: [], event: true, optional: true })
      .catch((cause: unknown) => {
        console.error(styleText('red', '⚠️ [devkit/server]'), 'Catalog invalidation failed', cause);
      });
  };
  return {
    publish(provider) {
      exposure.current = provider;
      unsubscribe = provider.catalog.subscribe(notify);
    },
    clear() {
      unsubscribe?.();
      exposure.current = undefined;
      notify();
    },
  };
}

function registerExposure(
  context: DevframeHubContext,
  methods: readonly ExposedMethod[],
  composition: ServerComposition<boolean>,
): HostExposure {
  const catalogName = catalogMethod(composition.providerId);
  for (const name of [catalogName, ...methods.map((method) => method.name)]) {
    if (context.rpc.has(name)) throw new Error(`Native RPC method is already registered: ${name}`);
  }
  const exposure: HostExposure = {
    identity: exposureIdentity(composition, methods),
    current: undefined,
    failed: false,
  };
  exposures.set(context, exposure);
  try {
    const snapshot = projectCatalog(composition, methods);
    context.rpc.register({
      name: catalogName,
      type: 'query',
      args: [] as const,
      returns: catalogSchema,
      handler: () => snapshot(exposure.current),
    });
    for (const method of methods) {
      context.rpc.register({
        name: method.name,
        type: 'action',
        args: [incarnationSchema, method.operation.input] as const,
        returns: method.operation.output,
        handler(incarnation: string, input: unknown) {
          const provider = selectedProvider(exposure, incarnation);
          return method.invoke(provider, input);
        },
      });
    }
    return exposure;
  } catch (cause) {
    /** Native observers can throw after insertion; retained methods must remain unavailable. */
    exposure.failed = true;
    throw new Error(
      'Native RPC exposure failed; retained methods are unavailable until the native host is recreated',
      { cause },
    );
  }
}

function selectedProvider(exposure: HostExposure, incarnation: string): ExposedProvider {
  const provider = exposure.current;
  if (provider === undefined) throw new Error('Exposed provider is unavailable');
  if (provider.provider.incarnation !== incarnation)
    throw new Error('The provider incarnation changed; make a fresh selection before retrying');
  return provider;
}
