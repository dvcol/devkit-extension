import { createEmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import { createSelectedTabLifecycle, createSelectedTabPublisher } from '@dvcol/cdb-extension';
import { nativeDebugger } from './chrome.js';
import { nativeLifecycle } from './lifecycle.js';

/** Example host recipe. The publisher alone owns native attachment and domain activation. */
export function createDebuggerHost(
  browser: 'chromium' | 'firefox',
  onError: (error: unknown) => void,
) {
  if (browser === 'firefox')
    return { status: 'unavailable', reason: 'unsupported-browser' } as const;
  const bridge = createEmbeddedChromeDebuggerBridge();
  const publisher = createSelectedTabPublisher({
    scopeId: crypto.randomUUID(),
    capabilities: { level: 'debug' },
    chromeDebugger: nativeDebugger,
    publishTarget: bridge.broker.publishTarget,
    updateTarget: bridge.broker.updateTarget,
    revokeTarget: (target, reason) => {
      bridge.broker.revokeTarget(target.id, target.generation, reason);
    },
    publishEvent: bridge.broker.publishEvent,
    registerTargetExecutor: bridge.registerTargetExecutor,
  });
  const lifecycle = createSelectedTabLifecycle({
    chrome: nativeLifecycle(onError),
    publisher,
    onError,
  });
  lifecycle.start();
  let disposal: Promise<void> | undefined;
  async function disposeHost(): Promise<void> {
    lifecycle.stop();
    try {
      await publisher.revoke();
    } finally {
      bridge.dispose();
    }
  }
  return {
    status: 'available',
    bridge,
    publisher,
    dispose: () => {
      disposal ??= disposeHost();
      return disposal;
    },
  } as const;
}
