import { createClient } from '@devkit/client';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';

/** Supplied only by the loopback demo launcher; never logged or stored in browser credentials. */
declare const DEMO_AUTH_TOKEN: string;

const result = document.querySelector('#result');
const button = document.querySelector('#increase');
if (!(result instanceof HTMLElement) || !(button instanceof HTMLButtonElement))
  throw new Error('Example controls are missing');

const rpc = await connectDevframe({
  baseURL: '/__devkit-remote/',
  connection: { isolated: true },
  authToken: DEMO_AUTH_TOKEN,
  simpleAuth: false,
  otpParam: false,
  webmcp: false,
});
const connection = await createDevframeProviderConnection({ rpc, providerId: 'example.remote' });
const client = createClient({ connections: [connection] });
const value = await client.capabilities.invoke({
  capability: counterCapability,
  operation: 'read',
  input: {},
});
result.textContent = JSON.stringify({ provider: connection.provider, value }, null, 2);
button.disabled = false;
button.addEventListener('click', () => {
  button.disabled = true;
  void client.actions
    .invoke({ action: increaseCounterAction, input: { amount: 1 } })
    .then(
      (next) => {
        result.textContent = JSON.stringify(
          { provider: connection.provider, value: next },
          null,
          2,
        );
        return next;
      },
      (cause: unknown) => {
        result.textContent = String(cause);
      },
    )
    .finally(() => {
      button.disabled = false;
    });
});

function dispose(): void {
  client.dispose();
  connection.dispose();
  rpc.close?.();
}
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
