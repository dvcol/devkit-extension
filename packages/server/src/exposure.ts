import type { DevframeHubContext } from '@devframes/hub/node';

import { exposureMethods, incarnationSchema } from './exposure-methods.js';
import type { ExposedMethod, ExposedProvider } from './exposure-methods.js';
import type { ServerComposition } from './types.js';

interface HostExposure {
  readonly names: ReadonlySet<string>;
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
  const exposure = exposures.get(context) ?? registerExposure(context, methods);
  if (exposure.failed)
    throw new Error(
      'Native RPC exposure is blocked after registration failure; recreate the native host',
    );
  if (
    exposure.names.size !== methods.length ||
    methods.some(({ name }) => !exposure.names.has(name))
  )
    throw new Error(
      'Exposed contracts are fixed for this native host; recreate the host to change them',
    );
  return {
    publish(provider) {
      exposure.current = provider;
    },
    clear() {
      exposure.current = undefined;
    },
  };
}

function registerExposure(
  context: DevframeHubContext,
  methods: readonly ExposedMethod[],
): HostExposure {
  for (const { name } of methods) {
    if (context.rpc.has(name)) throw new Error(`Native RPC method is already registered: ${name}`);
  }
  const exposure: HostExposure = {
    names: new Set(methods.map(({ name }) => name)),
    current: undefined,
    failed: false,
  };
  exposures.set(context, exposure);
  try {
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
