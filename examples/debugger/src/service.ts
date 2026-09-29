import {
  defineAction,
  defineExecution,
  defineNativeContext,
  definePlugin,
  defineService,
} from '@devkit/core';
import type { EmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import { z } from 'zod';
import { pageTitleCapability, readPageTitleAction } from './contracts.js';
import type { DebuggerTarget } from './contracts.js';

export const backgroundExecution = defineExecution({ id: 'webext.background' });
export const debuggerContext = defineNativeContext<EmbeddedChromeDebuggerBridge>({
  id: 'example.cdb',
});
const titleResult = z.object({ result: z.object({ value: z.string() }) });

async function readTitle(
  bridge: EmbeddedChromeDebuggerBridge,
  target: DebuggerTarget,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const lease = await bridge.client.acquireLease({
    targetId: target.id,
    targetGeneration: target.generation,
    durationMilliseconds: 10_000,
    mode: 'exclusive-control',
    requestedMethods: ['Runtime.evaluate'],
  });
  const operationId = crypto.randomUUID();
  const cancel = () => {
    bridge.broker.cancelCommand(operationId);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const result = await bridge.client.executeCommand({
      targetId: target.id,
      targetGeneration: target.generation,
      leaseId: lease.id,
      operationId,
      method: 'Runtime.evaluate',
      parameters: { expression: 'document.title', returnByValue: true },
    });
    return titleResult.parse(result.value).result.value;
  } finally {
    signal.removeEventListener('abort', cancel);
    await bridge.client.releaseLease({
      targetId: target.id,
      targetGeneration: target.generation,
      leaseId: lease.id,
    });
  }
}

export const pageTitleService = defineService({
  id: 'example.debugger.page-title-service',
  capability: pageTitleCapability,
  execution: backgroundExecution,
  setup({ native }) {
    const bridge = native.get(debuggerContext);
    if (bridge === undefined) throw new Error('Native CDB host is unavailable');
    return { read: (target, { signal }) => readTitle(bridge, target, signal) };
  },
});

export const pageTitlePlugin = definePlugin({
  id: 'example.debugger.actions',
  actions: [
    defineAction({
      id: 'example.debugger.read-title',
      contract: readPageTitleAction,
      execution: backgroundExecution,
      requires: { title: pageTitleCapability },
      handler: ({ input, services, signal }) => services.title.api.read(input, { signal }),
    }),
  ],
});
