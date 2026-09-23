import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
export default defineBackground({ type: 'module', main() {
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === 'probe') return Promise.resolve({ value: 'background-ready', realm: 'extension' });
    return undefined;
  });
} });
