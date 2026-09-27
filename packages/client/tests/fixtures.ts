import {
  defineAction,
  defineActionContract,
  defineCapability,
  defineOperation,
  definePlugin,
  defineService,
} from '@devkit/core';
import type {
  ActionDescriptor,
  CapabilityDescriptor,
  CapabilityResolution,
  RoutingPolicy,
} from '@devkit/core';
import { createProviderLifecycle } from '@devkit/runtime';
import { afterEach, vi } from 'vitest';
import { z } from 'zod';
import { createClient } from '../src/index.js';
import type { ClientOptions, ProviderConnection } from '../src/index.js';

export const operation = defineOperation({ input: z.string(), output: z.string(), target: 'none' });
export const capability = defineCapability({
  id: 'example.echo',
  version: 1,
  operations: { echo: operation },
});
export const action = defineActionContract({ id: 'example.echo', version: 1, operation });
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

export function client(options: ClientOptions = {}) {
  const instance = createClient(options);
  cleanup.push(() => {
    instance.dispose();
  });
  return instance;
}

interface BackendOptions {
  readonly id: string;
  readonly realm?: string;
  readonly incarnation?: string;
  readonly routing?: RoutingPolicy;
  readonly handler?: (input: string) => string | Promise<string>;
}

export async function backend(options: BackendOptions) {
  const calls: string[] = [];
  const execution = { id: 'example.local' };
  const runtime = createProviderLifecycle({
    provider: {
      id: options.id,
      realm: { id: options.realm ?? 'devserver' },
      incarnation: options.incarnation ?? `${options.id}.original`,
    },
    execution,
    native: { get: vi.fn<() => undefined>() },
    report() {},
  });
  cleanup.push(() => runtime.dispose());
  const contract = defineActionContract({
    id: action.id,
    version: 1,
    operation,
    ...(options.routing === undefined ? {} : { routing: options.routing }),
  });
  const service = await runtime.services.install(
    defineService({
      capability,
      id: 'echo',
      execution,
      setup: () => ({
        echo: (input) => {
          return execute(options, calls, input);
        },
      }),
    }),
  );
  await runtime.plugins.install(actionPlugin(contract, execution));
  const connection: ProviderConnection = {
    provider: runtime.catalog.snapshot().provider,
    catalog: runtime.catalog,
    resolve: (request) => runtime.resolve(request),
    invoke: (request) => runtime.invoke(request),
  };
  return { runtime, calls, connection, action: contract, service };
}

function execute(
  options: BackendOptions,
  calls: string[],
  input: string,
): string | Promise<string> {
  calls.push(input);
  if (options.handler !== undefined) return options.handler(input);
  return `${options.id}:${input}`;
}
export function deferred<Value>() {
  let complete: ((value: Value | PromiseLike<Value>) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  if (complete === undefined) throw new Error('Missing resolver');
  return { promise, resolve: complete };
}
export function requireBinding<Capability extends CapabilityDescriptor>(
  resolution: CapabilityResolution<Capability>,
) {
  if (resolution.status !== 'available') throw new Error('Expected capability binding');
  return resolution.binding;
}

function actionPlugin(
  contract: ActionDescriptor<typeof operation>,
  execution: { readonly id: string },
) {
  return definePlugin({
    id: 'echo',
    actions: [
      defineAction({
        contract,
        id: 'echo',
        execution,
        requires: { echo: capability },
        handler: ({ input, services, signal }) => services.echo.api.echo(input, { signal }),
      }),
    ],
  });
}
