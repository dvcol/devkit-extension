import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
export default defineContentScript({ matches: ['http://127.0.0.1/*'], async main() {
  const reply = await browser.runtime.sendMessage({ type: 'probe' });
  document.documentElement.dataset.extensionProbe = reply.value;
  await fetch('/extension-report', { method: 'POST', body: JSON.stringify(reply) });
} });
