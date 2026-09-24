import { createHubContext } from '@devframes/hub/node';
import type { CreateHubContextOptions, DevframeHubContext } from '@devframes/hub/node';
import type { InstallationResult, NativeContextAccess } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import {
  devframeContext,
  devframeHubContext,
  devToolsContext,
  installDevframeProvider,
  installDevToolsProvider,
} from '@devkit/server';
import type { ServerComposition, ServerProviderHandle } from '@devkit/server';
import { createKitContext } from '@vitejs/devtools-kit/node';

import {
  counterActionsPlugin,
  counterService,
  counterStateKey,
  readCounterCommandId,
} from './definitions.js';
import { createHeadlessHost } from './host.js';

function admitted(result: InstallationResult | undefined) {
  if (result?.status !== 'admitted') throw new Error('The counter installation was not admitted');
  return result.handle;
}

function describeNativeContexts(native: NativeContextAccess, context: DevframeHubContext) {
  return {
    devframe: native.get(devframeContext) === context,
    hub: native.get(devframeHubContext) === context,
    devtools: native.get(devToolsContext) === context,
  };
}

async function resolveCounter(provider: ServerProviderHandle) {
  const resolution = await provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Counter capability is unavailable');
  return resolution.binding;
}

async function readRetainedCounter(context: DevframeHubContext) {
  const state = await context.rpc.sharedState.get<{ value: number }>(counterStateKey, {
    initialValue: { value: 0 },
  });
  return state.value().value;
}

async function exerciseProvider(provider: ServerProviderHandle, context: DevframeHubContext) {
  const service = admitted(provider.startup.services[0]);
  const plugin = admitted(provider.startup.plugins[0]);
  const firstActionValue = await provider.invoke({
    action: increaseCounterAction,
    input: { amount: 3 },
  });
  const binding = await resolveCounter(provider);
  if (binding.context.access !== 'local') throw new Error('Expected a local server binding');
  const native = describeNativeContexts(binding.context.native, context);
  const firstReadValue = await binding.api.read({});
  await service.disable();
  const disabled = {
    service: service.snapshot().status,
    action: plugin.snapshot().contributions[0]?.status,
    commandRegistered: context.commands.commands.has(readCounterCommandId),
  };
  await service.enable();
  const secondActionValue = await provider.invoke({
    action: increaseCounterAction,
    input: { amount: 4 },
  });
  const commandValue = await context.commands.execute(readCounterCommandId);
  const reactivated = await resolveCounter(provider);
  const enabled = {
    service: service.snapshot().status,
    plugin: plugin.snapshot().status,
    incarnation: reactivated.context.provider.incarnation,
    commandRegistered: context.commands.commands.has(readCounterCommandId),
  };
  await provider.dispose();
  return {
    provider: provider.provider,
    execution: binding.context.execution,
    native,
    firstActionValue,
    firstReadValue,
    disabled,
    enabled,
    secondActionValue,
    commandValue,
    disposed: {
      service: service.snapshot().status,
      plugin: plugin.snapshot().status,
      commandRegistered: context.commands.commands.has(readCounterCommandId),
      retainedHostState: await readRetainedCounter(context),
    },
  };
}

async function runContextDemo<Context extends DevframeHubContext>(
  createContext: (options: CreateHubContextOptions) => Promise<Context>,
  installProvider: (
    context: Context,
    composition: ServerComposition,
  ) => Promise<ServerProviderHandle>,
  hostName: 'devframe' | 'devtools',
) {
  const host = await createHeadlessHost(createContext);
  let provider: ServerProviderHandle | undefined;
  try {
    provider = await installProvider(host.context, {
      providerId: `example.${hostName}-server`,
      services: [counterService],
      plugins: [counterActionsPlugin],
    });
    const result = await exerciseProvider(provider, host.context);
    return { host: hostName, ...result };
  } finally {
    try {
      await provider?.dispose();
    } finally {
      await host.close();
    }
  }
}

export function runDevframeDemo() {
  return runContextDemo(createHubContext, installDevframeProvider, 'devframe');
}

export function runDevToolsDemo() {
  return runContextDemo(createKitContext, installDevToolsProvider, 'devtools');
}
