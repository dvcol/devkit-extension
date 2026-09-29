import type { CdpSubscription, EmbeddedChromeDebuggerBridge, PublishedTarget } from '@dvcol/cdb';

export async function checkEvent(bridge: EmbeddedChromeDebuggerBridge, target: PublishedTarget) {
  const lease = await bridge.client.acquireLease({
    targetId: target.id,
    targetGeneration: target.generation,
    durationMilliseconds: 10_000,
    mode: 'exclusive-control',
    requestedMethods: ['Runtime.evaluate', 'Runtime.consoleAPICalled'],
  });
  const reference = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
  let subscription: CdpSubscription | undefined;
  try {
    subscription = await bridge.client.subscribe({
      ...reference,
      match: { method: 'Runtime.consoleAPICalled' },
      buffer: { capacity: 10, overflowStrategy: 'disconnect' },
    });
    const next = subscription[Symbol.asyncIterator]().next();
    const result = await bridge.client.executeCommand({
      ...reference,
      operationId: crypto.randomUUID(),
      method: 'Runtime.evaluate',
      parameters: { expression: 'console.log("devkit-cdb-event"); 6 * 7', returnByValue: true },
    });
    const event = await next;
    return { result, event };
  } finally {
    subscription?.close();
    await bridge.client.releaseLease(reference);
  }
}
