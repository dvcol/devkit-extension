import { createHubContext } from '@devframes/hub/node';
import { createClient, RoutingError } from '@devkit/client';
import type { Client } from '@devkit/client';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { installDevframeProvider, installDevToolsProvider } from '@devkit/server';
import type { ServerProviderHandle } from '@devkit/server';
import { createKitContext } from '@vitejs/devtools-kit/node';
import { counterActionsPlugin, counterService, readCounterCommandId } from './definitions.js';
import { createHeadlessHost } from './host.js';

const devframeRoute = { realm: 'devserver', provider: 'example.devframe-server' } as const;
const devtoolsRoute = { realm: 'devserver', provider: 'example.devtools-server' } as const;

async function rejectedSelection(client: Client) {
  try {
    await client.actions.broadcast({
      action: increaseCounterAction,
      input: { amount: 100 },
      selection: [devframeRoute, { realm: 'devserver', provider: 'missing' }],
    });
  } catch (error) {
    if (!(error instanceof RoutingError)) throw error;
    return { code: error.code, message: error.message, selectors: error.selectors };
  }
  throw new Error('Missing broadcast recipient was silently ignored');
}

async function exerciseRoutes(client: Client, devframe: ServerProviderHandle) {
  const installation = devframe.startup.services[0];
  if (installation === undefined) throw new Error('Counter service was not admitted');
  const first = await client.actions.invoke({
    action: increaseCounterAction,
    input: { amount: 3 },
  });
  await installation.disable();
  const fallback = await client.actions.invoke({
    action: increaseCounterAction,
    input: { amount: 4 },
  });
  const callback = await client.actions.invoke({
    action: increaseCounterAction,
    input: { amount: 2 },
    routing: () => devtoolsRoute,
  });
  await installation.enable();
  const rejected = await rejectedSelection(client);
  const beforeBroadcast = await client.capabilities.broadcast({
    capability: counterCapability,
    operation: 'read',
    input: {},
    selection: [{ realm: 'devserver' }],
  });
  const broadcast = await client.actions.broadcast({
    action: increaseCounterAction,
    input: { amount: 1 },
    selection: [devframeRoute, { realm: 'devserver' }, devtoolsRoute],
  });
  return { first, fallback, callback, rejected, beforeBroadcast, broadcast };
}

/** Routes through two real local adapters. Each owns a separate native hub and counter state. */
export async function runRoutingDemo() {
  const devframeHost = await createHeadlessHost(createHubContext);
  try {
    const devtoolsHost = await createHeadlessHost(createKitContext);
    let devframe: ServerProviderHandle | undefined;
    let devtools: ServerProviderHandle | undefined;
    let client: Client | undefined;
    try {
      const composition = { services: [counterService], plugins: [counterActionsPlugin] };
      devframe = await installDevframeProvider(devframeHost.context, {
        ...composition,
        providerId: devframeRoute.provider,
      });
      devtools = await installDevToolsProvider(devtoolsHost.context, {
        ...composition,
        providerId: devtoolsRoute.provider,
      });
      client = createClient({
        connections: [devframe, devtools],
        routing: [devframeRoute, devtoolsRoute],
      });
      const result = await exerciseRoutes(client, devframe);
      client.dispose();
      const retained = await Promise.all([
        devframeHost.context.commands.execute(readCounterCommandId),
        devtoolsHost.context.commands.execute(readCounterCommandId),
      ]);
      return { ...result, retained };
    } finally {
      client?.dispose();
      try {
        await Promise.all([devframe?.dispose(), devtools?.dispose()]);
      } finally {
        await devtoolsHost.close();
      }
    }
  } finally {
    await devframeHost.close();
  }
}
