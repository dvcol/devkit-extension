import {
  defineAction,
  defineExecution,
  defineNativeContext,
  definePlugin,
  defineService,
} from '@devkit/core';
import { cdpCommandResultSchema, leaseSchema } from '@dvcol/cdb';
import type { CdbDevframeService } from '@dvcol/cdb-devframe';
import { z } from 'zod';
import { pageTitleCapability, readPageTitleAction } from './contracts.ts';
import type { DebuggerTarget } from './contracts.ts';

type NativeBroker = CdbDevframeService['broker'];

/** This example principal is owned by the host; the contribution is not exposed to remote callers. */
export const remoteDebuggerAgent = { id: 'owned-example-agent', label: 'Owned fixture host agent' };
export const remoteDebuggerExecution = defineExecution({ id: 'example.debugger.server' });
export const remoteDebuggerContext = defineNativeContext<NativeBroker>({
  id: 'example.cdb.broker',
});
const titleResult = z.object({ result: z.object({ value: z.string() }) });

async function readTitle(
  broker: NativeBroker,
  target: DebuggerTarget,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const lease = await leaseSchema['~standard'].validate(
    await broker.invoke(
      remoteDebuggerAgent,
      'browser.acquire',
      {
        targetId: target.id,
        targetGeneration: target.generation,
        durationMilliseconds: 10_000,
        mode: 'exclusive-control',
        requestedMethods: ['Runtime.evaluate'],
      },
      { signal },
    ),
  );
  if (lease.issues !== undefined) throw new Error('Native broker returned an invalid lease');
  try {
    signal.throwIfAborted();
    const command = await cdpCommandResultSchema['~standard'].validate(
      await broker.invoke(
        remoteDebuggerAgent,
        'browser.raw_cdp',
        {
          targetId: target.id,
          targetGeneration: target.generation,
          leaseId: lease.value.id,
          method: 'Runtime.evaluate',
          parameters: { expression: 'document.title', returnByValue: true },
        },
        { signal },
      ),
    );
    if (command.issues !== undefined)
      throw new Error('Native broker returned an invalid command result');
    return titleResult.parse(command.value.value).result.value;
  } finally {
    await broker.invoke(remoteDebuggerAgent, 'browser.release', {
      targetId: target.id,
      targetGeneration: target.generation,
      leaseId: lease.value.id,
    });
  }
}

export const remotePageTitleService = defineService({
  id: 'example.debugger.remote-page-title-service',
  capability: pageTitleCapability,
  execution: remoteDebuggerExecution,
  setup({ native }) {
    const broker = native.get(remoteDebuggerContext);
    if (broker === undefined) throw new Error('Native CDB broker is unavailable');
    return { read: (target, { signal }) => readTitle(broker, target, signal) };
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
