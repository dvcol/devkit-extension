import {
  defineAction,
  defineExecution,
  defineNativeContext,
  definePlugin,
  defineService,
} from '@devkit/core';
import { cdpCommandResultSchema, leaseSchema } from '@dvcol/cdb';
import { getCdbService } from '@dvcol/cdb-devframe';
import type { DevframeNodeContext } from 'devframe';
import { z } from 'zod';
import { pageTitleCapability, readPageTitleAction } from './contracts.ts';
import type { DebuggerTarget } from './contracts.ts';

export const remoteDebuggerExecution = defineExecution({ id: 'example.debugger.server' });
export const remoteDebuggerContext = defineNativeContext<DevframeNodeContext>({
  id: 'example.devframe.context',
});
const titleResult = z.object({ result: z.object({ value: z.string() }) });

/** Native peer disconnect owns cancellation; local disable waits for native work to settle. */
async function readTitle(
  context: DevframeNodeContext,
  target: DebuggerTarget,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const session = requireCaller(context);
  const service = getCdbService(context);
  const authority = { targetId: target.id, targetGeneration: target.generation };
  const lease = await leaseSchema['~standard'].validate(
    await service.invoke(session, {
      operationId: crypto.randomUUID(),
      name: 'browser.acquire',
      arguments: {
        ...authority,
        durationMilliseconds: 10_000,
        mode: 'exclusive-control',
        requestedMethods: ['Runtime.evaluate'],
      },
    }),
  );
  if (lease.issues !== undefined) throw new Error('Native broker returned an invalid lease');
  try {
    signal.throwIfAborted();
    const command = await cdpCommandResultSchema['~standard'].validate(
      await service.invoke(session, {
        operationId: crypto.randomUUID(),
        name: 'browser.raw_cdp',
        arguments: {
          ...authority,
          leaseId: lease.value.id,
          method: 'Runtime.evaluate',
          parameters: { expression: 'document.title', returnByValue: true },
        },
      }),
    );
    if (command.issues !== undefined)
      throw new Error('Native broker returned an invalid command result');
    return titleResult.parse(command.value.value).result.value;
  } finally {
    await service.invoke(session, {
      operationId: crypto.randomUUID(),
      name: 'browser.release',
      arguments: {
        ...authority,
        leaseId: lease.value.id,
      },
    });
  }
}

/** Read once per invocation; setup has no caller, and a supplied ID is not a native session. */
function requireCaller(context: DevframeNodeContext) {
  const session = context.rpc.getCurrentRpcSession();
  if (session === undefined) throw new Error('A current Devframe RPC caller is required');
  return session;
}

export const remotePageTitleService = defineService({
  id: 'example.debugger.remote-page-title-service',
  capability: pageTitleCapability,
  execution: remoteDebuggerExecution,
  setup({ native }) {
    const context = native.get(remoteDebuggerContext);
    if (context === undefined) throw new Error('Native Devframe context is unavailable');
    return { read: (target, { signal }) => readTitle(context, target, signal) };
  },
});

export const remotePageTitlePlugin = definePlugin({
  id: 'example.debugger.remote-actions',
  actions: [
    defineAction({
      id: 'example.debugger.remote-read-title',
      contract: readPageTitleAction,
      execution: remoteDebuggerExecution,
      requires: { title: pageTitleCapability },
      handler: ({ input, services, signal }) => services.title.api.read(input, { signal }),
    }),
  ],
});
