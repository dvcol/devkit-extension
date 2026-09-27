import { createClient, type Client } from '@devkit/client';
import type { ProviderDescriptor } from '@devkit/core';
import { increaseCounterAction } from '@devkit/example-contribution';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';
import { counterStateKey } from '../src/state-key.js';

/** Supplied only by the loopback demo launcher; never logged or stored in browser credentials. */
declare const DEMO_AUTH_TOKEN: string;

function element<Constructor extends typeof HTMLElement>(
  selector: string,
  constructor: Constructor,
): InstanceType<Constructor>;
function element(selector: string, constructor: typeof HTMLElement): HTMLElement {
  const found = document.querySelector(selector);
  if (!(found instanceof constructor)) throw new Error(`Missing example control: ${selector}`);
  return found;
}

const result = element('#result', HTMLElement);
const status = element('#connection', HTMLElement);
const command = element('#command', HTMLElement);
const increase = element('#increase', HTMLButtonElement);
const disconnect = element('#disconnect', HTMLButtonElement);
const reconnect = element('#reconnect', HTMLButtonElement);
const cleanup = new DisposableStack();
const events = new AbortController();
cleanup.defer(() => {
  events.abort();
});

function dispose(): void {
  cleanup.dispose();
  increase.disabled = true;
  disconnect.disabled = true;
  status.textContent = 'Disconnected. The displayed value is stale. Reload to reconnect.';
}

/** Pending native startup can finish after this document's lifetime ends. */
function own(disposeResource: () => void): void {
  if (cleanup.disposed) disposeResource();
  else cleanup.defer(disposeResource);
}

async function start(): Promise<void> {
  const nativeClient = await connectDevframe({
    baseURL: '/__devkit-remote/',
    connection: { isolated: true },
    authToken: DEMO_AUTH_TOKEN,
    simpleAuth: false,
    otpParam: false,
    webmcp: false,
  });
  own(() => nativeClient.close?.());
  if (cleanup.disposed) return;
  const connection = await createDevframeProviderConnection({
    rpc: nativeClient,
    providerId: 'example.remote',
  });
  own(() => {
    connection.dispose();
  });
  if (cleanup.disposed) return;
  const client = createClient({ connections: [connection] });
  own(() => {
    client.dispose();
  });
  own(
    nativeClient.events.on('connection:status', (value) => {
      if (value !== 'connected' && value !== 'connecting') dispose();
    }),
  );
  /** No initialValue: await the native server snapshot instead of showing a local placeholder. */
  const state = await nativeClient.sharedState.get<{ value: number }>(counterStateKey);
  if (cleanup.disposed) return;
  own(
    state.on('updated', (value) => {
      render(connection.provider, value.value);
    }),
  );
  render(connection.provider, state.value().value);
  status.textContent = 'Connected. Observing native shared state.';
  increase.disabled = false;
  disconnect.disabled = false;
  increase.addEventListener(
    'click',
    () => {
      void runCommand(client);
    },
    { signal: events.signal },
  );
}

function render(provider: ProviderDescriptor, value: number): void {
  result.textContent = JSON.stringify({ provider, value }, null, 2);
}

async function runCommand(client: Client): Promise<void> {
  increase.disabled = true;
  command.textContent = 'Running…';
  try {
    const value = await client.actions.invoke({
      action: increaseCounterAction,
      input: { amount: 1 },
    });
    if (!cleanup.disposed) command.textContent = `Last command returned ${value}.`;
  } catch (cause) {
    if (!cleanup.disposed) command.textContent = String(cause);
  } finally {
    increase.disabled = cleanup.disposed;
  }
}

function reload(): void {
  window.location.reload();
}

disconnect.addEventListener('click', dispose, { signal: events.signal });
reconnect.addEventListener('click', reload);
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    reconnect.removeEventListener('click', reload);
    window.removeEventListener('pagehide', dispose);
  });
try {
  await start();
} catch (cause) {
  dispose();
  status.textContent = `Connection failed: ${String(cause)}`;
}
