import { browser } from 'wxt/browser';
const button = document.querySelector<HTMLButtonElement>('#increment');
const output = document.querySelector<HTMLOutputElement>('#result');
if (!button || !output) throw new Error('Missing proof controls');
output.dataset.manifestVersion = browser.runtime.getManifest().version;
button.addEventListener('click', () => {
  const requestId = crypto.randomUUID();
  browser.runtime.sendMessage({ kind: 'increment', requestId }).then((result: unknown) => {
    output.textContent = JSON.stringify(result);
    return null;
  }).catch((error) => { output.textContent = JSON.stringify({ error: String(error) }); });
});
