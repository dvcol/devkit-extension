import { browser } from 'wxt/browser';
const reply = await browser.runtime.sendMessage({ type: 'probe' });
document.querySelector('#result')!.textContent = reply.value;
if (import.meta.hot) import.meta.hot.accept();
