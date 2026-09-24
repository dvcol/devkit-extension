import {
  defineAction,
  defineCapability,
  defineContributionKind,
  defineExecution,
  defineExtension,
  defineOperation,
  definePlugin,
  defineService,
} from '@devkit/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  action,
  admitted,
  available,
  capability,
  echoService,
  execution,
  operation,
  provider,
} from './provider-fixtures.js';

describe('provider admission and invocation contracts', () => {
  it('rejects a complete startup batch before setup and returns relaxed duplicates explicitly', async () => {
    expect.assertions(5);
    const setup = vi.fn<() => { echo: (value: string) => string }>(() => ({
      echo: (value) => value,
    }));
    const definition = defineService({ capability: capability, id: 'service', execution, setup });
    const { runtime } = provider();
    await expect(runtime.startup({ services: [definition, definition] })).rejects.toMatchObject({
      code: 'duplicate-registration',
    });
    expect(setup).not.toHaveBeenCalled();
    const { runtime: relaxed } = provider({ strict: false });
    const results = await relaxed.startup({ services: [definition, definition] });
    expect(results.services[0]?.status).toBe('admitted');
    expect(results.services[1]).toMatchObject({
      status: 'skipped',
      diagnostic: { severity: 'warning' },
    });
    expect(setup).toHaveBeenCalledTimes(1);
    await runtime.dispose();
    await relaxed.dispose();
  });

  it('reports exact-version mismatch, wrong execution and unsupported domain kinds', async () => {
    expect.assertions(5);
    const { runtime, diagnostics } = provider({ strict: false });
    await runtime.services.install(echoService());
    const newer = defineCapability({
      id: capability.id,
      version: 2,
      operations: capability.operations,
    });
    expect(await runtime.resolve(newer)).toMatchObject({
      status: 'unavailable',
      reason: 'incompatible-contract',
      diagnostic: { severity: 'warning' },
    });
    expect(diagnostics.at(-1)?.code).toBe('incompatible-contract');
    const incompatible = admitted(
      await runtime.plugins.install(
        definePlugin({
          id: 'incompatible',
          actions: [
            defineAction({
              contract: action,
              id: 'action',
              execution,
              requires: { newer },
              handler: ({ input }) => input,
            }),
          ],
        }),
      ),
    );
    expect(incompatible.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'incompatible-contract',
    });
    const foreign = admitted(
      await runtime.services.install(
        defineService({
          capability: newer,
          id: 'foreign',
          execution: defineExecution({ id: 'another.execution' }),
          setup: () => ({ echo: (value) => value }),
        }),
      ),
    );
    expect(foreign.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'wrong-execution',
    });
    const domain = admitted(
      await runtime.plugins.install(
        definePlugin({ id: 'domain', views: [{ id: 'view', kind: 'view', execution }] }),
      ),
    );
    expect(domain.snapshot().contributions[0]).toMatchObject({
      status: 'waiting',
      reason: 'unsupported',
    });
    await runtime.dispose();
  });

  it('validates custom payloads before any batch setup and owns custom cleanup', async () => {
    expect.assertions(5);
    const kind = defineContributionKind({ id: 'example.custom', schema: z.string().min(4) });
    const setup = vi.fn<() => { echo: (value: string) => string }>(() => ({
      echo: (value) => value,
    }));
    const cleanup = vi.fn<() => void>();
    const { runtime } = provider({
      kinds: [
        {
          descriptor: kind,
          activate(_definition, context) {
            context.scope.onDispose(cleanup);
          },
        },
      ],
    });
    const bad = definePlugin({
      id: 'bad',
      extensions: [defineExtension({ descriptor: kind, id: 'extension', execution, payload: 'x' })],
    });
    await expect(
      runtime.startup({
        services: [defineService({ capability: capability, id: 'service', execution, setup })],
        plugins: [bad],
      }),
    ).rejects.toMatchObject({ code: 'invalid-definition' });
    expect(setup).not.toHaveBeenCalled();
    const good = admitted(
      await runtime.plugins.install(
        definePlugin({
          id: 'good',
          extensions: [
            defineExtension({ descriptor: kind, id: 'extension', execution, payload: 'okay' }),
          ],
        }),
      ),
    );
    expect(good.snapshot().status).toBe('ready');
    expect(cleanup).not.toHaveBeenCalled();
    await good.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it('uses registered validators even when the caller supplies permissive schemas', async () => {
    expect.assertions(4);
    const handler = vi.fn<(value: string) => string>((value) => value);
    const { runtime } = provider();
    await runtime.services.install(
      defineService({
        capability: capability,
        id: 'service',
        execution,
        setup: () => ({ echo: handler }),
      }),
    );
    const counterfeit = defineCapability({
      id: capability.id,
      version: capability.version,
      operations: {
        echo: defineOperation({ input: z.unknown(), output: z.unknown(), target: 'none' }),
      },
    });
    const resolution = await runtime.resolve(counterfeit);
    expect(resolution.status).toBe('available');
    await expect(available(resolution).api.echo(12)).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(handler).not.toHaveBeenCalled();
    const inheritedName = defineCapability({
      id: capability.id,
      version: capability.version,
      operations: { constructor: operation },
    });
    const missing = available(await runtime.resolve(inheritedName));
    await expect(missing.api.constructor('not declared')).rejects.toMatchObject({
      code: 'unavailable-capability',
    });
    await runtime.dispose();
  });

  it('supports prototype-shaped operation names and requirement aliases as own properties', async () => {
    expect.assertions(4);
    const unusual = defineCapability({
      id: 'example.unusual',
      version: 1,
      operations: { ['__proto__']: operation },
    });
    const { runtime } = provider();
    await runtime.services.install(
      defineService({
        capability: unusual,
        id: 'unusual',
        execution,
        setup: () => ({ ['__proto__']: (value) => value }),
      }),
    );
    const resolution = await runtime.resolve(unusual);
    expect(Object.hasOwn(available(resolution).api, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(available(resolution).api)).toBe(Object.prototype);
    await expect(available(resolution).api['__proto__']('own')).resolves.toBe('own');
    const contribution = defineAction({
      contract: action,
      id: 'action',
      execution,
      requires: { ['__proto__']: unusual },
      handler: ({ input, services }) => services['__proto__'].api['__proto__'](input),
    });
    await runtime.plugins.install(definePlugin({ id: 'plugin', actions: [contribution] }));
    await expect(runtime.invoke(action, 'dependency')).resolves.toBe('dependency');
    await runtime.dispose();
  });
});
