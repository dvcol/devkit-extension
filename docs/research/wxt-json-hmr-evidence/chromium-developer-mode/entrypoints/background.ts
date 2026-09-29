import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({ type: 'module', main() {
  const generation = crypto.randomUUID();
  let count = 100;
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.kind !== 'increment') return;
    count += 1;
    sendResponse({ requestId: message.requestId, count, generation, version: browser.runtime.getManifest().version });
  });
} });
