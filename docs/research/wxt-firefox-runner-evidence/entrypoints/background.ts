import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({ type: 'module', main() {
  const generation = crypto.randomUUID();
  let count = 0;
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'increment' || !('requestId' in message) || typeof message.requestId !== 'string') return;
    count += 1;
    sendResponse({ requestId: message.requestId, count, generation, version: browser.runtime.getManifest().version });
  });
} });
