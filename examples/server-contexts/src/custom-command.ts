import { defineContributionKind, defineExtension, definePlugin } from '@devkit/core';
import type { ContributionKindInstaller, InstallationHandle } from '@devkit/core';
import { devframeHubContext, serverExecution } from '@devkit/server';
import type { DevframeHubContext } from '@devframes/hub/node';
import { z } from 'zod';

/** The application defines the payload; the host supplies its native implementation. */
export const commandKind = defineContributionKind({
  id: 'example.command',
  schema: z.object({ title: z.string().min(1), message: z.string() }),
});

const commandId = 'example:custom-command';

export const commandPlugin = definePlugin({
  id: 'example.command-plugin',
  extensions: [
    defineExtension({
      descriptor: commandKind,
      id: commandId,
      execution: serverExecution,
      payload: {
        title: 'Custom contribution greeting',
        message: 'Hello from a custom contribution',
      },
    }),
  ],
});

export const commandInstaller: ContributionKindInstaller<typeof commandKind> = {
  descriptor: commandKind,
  activate(definition, { native, scope }) {
    const context = native.get(devframeHubContext);
    if (context === undefined) throw new Error('The command contribution requires a native hub');
    const command = context.commands.register({
      id: definition.id,
      title: definition.payload.title,
      handler: () => definition.payload.message,
    });
    scope.onDispose(() => {
      command.unregister();
    });
  },
};

export async function exerciseCustomCommand({
  context,
  installation,
}: {
  context: DevframeHubContext;
  installation: InstallationHandle;
}) {
  const initial = {
    status: installation.snapshot().status,
    result: await context.commands.execute(commandId),
  };
  await installation.disable();
  const disabled = {
    status: installation.snapshot().status,
    registered: context.commands.commands.has(commandId),
  };
  await installation.enable();
  const reenabled = {
    status: installation.snapshot().status,
    result: await context.commands.execute(commandId),
  };
  await installation.dispose();
  return {
    initial,
    disabled,
    reenabled,
    disposed: {
      status: installation.snapshot().status,
      registered: context.commands.commands.has(commandId),
    },
  };
}
