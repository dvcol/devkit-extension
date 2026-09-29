import { createClient } from '@devkit/client';
import { defineService } from '@devkit/core';
import type { CapabilityResolution } from '@devkit/core';
import { counterCapability } from '@devkit/example-contribution';
import { expect, it } from 'vitest';
import { createDevframeProviderConnection } from '../src/client/index.js';
import { serverExecution } from '../src/index.js';
import { createProviderFixture } from '../../webext/tests/provider-fixture.js';
import { ownCleanup, remoteHost } from './remote-fixtures.js';

it('routes one shared contract across an authenticated server and a native Port provider', async () => {
  expect.assertions(5);
  let value = 0;
  const service = defineService({
    id: 'test.server-counter',
    capability: counterCapability,
    execution: serverExecution,
    setup: () => ({
      read: () => value,
      increase: ({ amount }) => {
        value += amount;
        return value;
      },
    }),
  });
  const server = await remoteHost({
    providerId: 'same-id',
    services: [service],
    expose: { capabilities: [counterCapability] },
  });
  const serverConnection = await createDevframeProviderConnection({
    rpc: await server.connect(),
    providerId: 'same-id',
  });
  ownCleanup(() => {
    serverConnection.dispose();
  });
  const extension = await createProviderFixture('same-id');
  ownCleanup(extension.dispose);
  const peer = await extension.connect('json');
  const client = createClient({ connections: [serverConnection, peer.connection] });
  ownCleanup(() => {
    client.dispose();
  });
  await expect(
    client.capabilities.resolve({ capability: counterCapability }),
  ).rejects.toMatchObject({ code: 'ambiguous-provider' });
  const outcomes = await client.capabilities.broadcast({
    capability: counterCapability,
    operation: 'increase',
    input: { amount: 2 },
    selection: [{ realm: 'devserver' }, { realm: 'webext' }],
  });
  expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(value).toBe(2);
  peer.close();
  const resolution = await client.capabilities.resolve({
    capability: counterCapability,
    routing: [{ realm: 'webext' }, { realm: 'devserver' }],
  });
  const binding = available(resolution);
  expect(binding.context.provider.realm.id).toBe('devserver');
  await expect(binding.api.increase({ amount: 1 })).resolves.toBe(3);
});

function available(resolution: CapabilityResolution<typeof counterCapability>) {
  if (resolution.status !== 'available') throw new Error('Counter should be available');
  return resolution.binding;
}
