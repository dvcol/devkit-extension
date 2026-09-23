import { callProbe } from './api';
import { spec } from './spec';
import { version } from './view-version';
const result = document.querySelector('#result');
const incrementButton = document.querySelector('#increment');
const failureButton = document.querySelector('#failure');
if (!result || !incrementButton || !failureButton) throw new Error('Fixture elements missing');
const output = result;
let pageInvocations = 0;
async function render(action = 'fixture.read'): Promise<void> {
  const reply = await callProbe(action);
  output.textContent = JSON.stringify({ ...reply, viewVersion: version, pageInvocations, specRoot: spec.root, pageTimeOrigin: performance.timeOrigin });
  await fetch('http://127.0.0.1:39371/page-report', { method: 'POST', body: output.textContent });
}
function increment(): void { pageInvocations += 1; void render(spec.elements.increment.on.press.action); }
function fail(): void { void render(spec.elements.failure.on.press.action); }
incrementButton.addEventListener('click', increment);
failureButton.addEventListener('click', fail);
await render();
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    incrementButton.removeEventListener('click', increment);
    failureButton.removeEventListener('click', fail);
  });
}
