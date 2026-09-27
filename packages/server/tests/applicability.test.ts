import { createClient, type ProviderConnection } from '@devkit/client';
import { describe, expect, it } from 'vitest';
import { createDevframeProviderConnection } from '../src/client/index.js';
import {
  configurationAction,
  configurationCapability,
  configurationComposition,
} from './applicability-fixtures.js';
import { ownCleanup, remoteHost } from './remote-fixtures.js';

async function connect(host: Awaited<ReturnType<typeof remoteHost>>) {
  const connection = await createDevframeProviderConnection({
    rpc: await host.connect(),
    providerId: host.provider.provider.id,
  });
  ownCleanup(() => {
    connection.dispose();
  });
  return connection;
}

function client(connections: readonly ProviderConnection[]) {
  const instance = createClient({ connections });
  ownCleanup(() => {
    instance.dispose();
  });
  return instance;
}

describe('native command recipients and implementation applicability', () => {
  it('keeps independent clients and provider-local applicability for actions and direct capabilities', async () => {
    expect.assertions(9);
    const firstHost = await remoteHost(configurationComposition('first', 'dev.example.test'));
    const secondHost = await remoteHost(configurationComposition('second', 'staging.example.test'));
    const firstClient = client([await connect(firstHost), await connect(secondHost)]);
    const secondClient = client([await connect(firstHost), await connect(secondHost)]);
    const input = { domain: 'dev.example.test', target: 'theme', value: 7 };
    const outcomes = await firstClient.actions.broadcast({
      action: configurationAction,
      selection: [{ realm: 'devserver' }],
      input,
    });
    expect(outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect(outcomes).toMatchObject([
      { provider: { id: 'first' }, value: { status: 'applied', value: 7 } },
      { provider: { id: 'second' }, value: { status: 'not-applicable' } },
    ]);
    await expect(
      secondClient.capabilities.invoke({
        capability: configurationCapability,
        operation: 'read',
        input: 'theme',
        routing: { realm: 'devserver', provider: 'first' },
      }),
    ).resolves.toBe(7);
    await expect(
      secondClient.capabilities.invoke({
        capability: configurationCapability,
        operation: 'read',
        input: 'theme',
        routing: { realm: 'devserver', provider: 'second' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      secondClient.capabilities.invoke({
        capability: configurationCapability,
        operation: 'set',
        input,
        routing: { realm: 'devserver', provider: 'second' },
      }),
    ).resolves.toEqual({ status: 'not-applicable' });
    expect(secondClient.providers.snapshot().map(({ status }) => status)).toEqual(['open', 'open']);
    firstClient.dispose();
    await expect(
      secondClient.actions.invoke({
        action: configurationAction,
        input: { ...input, domain: 'staging.example.test', value: 9 },
        routing: { realm: 'devserver', provider: 'second' },
      }),
    ).resolves.toEqual({ status: 'applied', value: 9 });
    const catalog = secondHost.provider.catalog.snapshot();
    expect(catalog.actions[0]).not.toHaveProperty('target');
    expect(catalog.capabilities[0]?.operations[0]).not.toHaveProperty('target');
  });
});
