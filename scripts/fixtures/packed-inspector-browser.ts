/** Compiled inside the installed consumer; every application import resolves through a tarball. */
export const packedInspectorBrowser = `
import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex } from '@devframes/json-render';
import referenceRenderer from '@devframes/json-render-ui/renderer';
import { createClient } from '@devkit/client';
import { createActionCall } from '@devkit/devframe/client';
import {
  configureInspectorAction, markInspectorAction, readInspectorAction, resetInspectorAction,
} from '@devkit/example-contribution/inspector';
import { domRenderer } from '@devkit/example-json-render/renderer';
import { createDevframeProviderConnection } from '@devkit/server/client';
import { connectDevframe } from 'devframe/client';

const lifetime = new AbortController();
const cleanup = new DisposableStack();
const status = document.querySelector<HTMLOutputElement>('#connection')!;
const parameters = new URLSearchParams(location.search);
const host = parameters.get('host');
if (host !== 'devframe' && host !== 'devtools') throw new Error('Expected a native host');
const selectedRenderer = parameters.get('renderer');
if (selectedRenderer !== 'reference' && selectedRenderer !== 'custom') throw new Error('Expected a renderer');

function dispose(): void {
  lifetime.abort();
  cleanup.dispose();
  status.textContent = 'Disconnected';
}

/** Native connection and renderer setup can settle after the document has left. */
function own(release: () => void): void {
  if (cleanup.disposed) release();
  else cleanup.defer(release);
}

async function connect(): Promise<void> {
  const rpc = await connectDevframe({
    baseURL: '/__packed/',
    authToken: document.querySelector<HTMLInputElement>('#token')!.value,
    connection: { isolated: true }, simpleAuth: false, otpParam: false, webmcp: false,
  });
  own(() => rpc.close?.());
  lifetime.signal.throwIfAborted();
  await rpc.ensureTrusted();
  const connection = await createDevframeProviderConnection({
    rpc, providerId: 'example.' + host + '-inspector', signal: lifetime.signal,
  });
  own(() => { connection.dispose(); });
  lifetime.signal.throwIfAborted();
  const client = createClient({ connections: [connection] });
  own(() => { client.dispose(); });
  const index = await rpc.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  lifetime.signal.throwIfAborted();
  const view = Object.values(index.value()).find((entry) => entry.id === 'response-inspector');
  if (view === undefined) throw new Error('The native inspector view is unavailable');
  const actions = [readInspectorAction, configureInspectorAction, markInspectorAction, resetInspectorAction];
  const render = selectedRenderer === 'custom' ? domRenderer : referenceRenderer;
  const mounted = await render({
    entry: { id: view.id, title: view.title, type: 'json-render', view, icon: 'ph:magnifying-glass' },
    container: document.querySelector<HTMLElement>('#inspector')!,
    context: { rpc: { ...rpc, call: createActionCall({
      rpc, actions: client.actions, signal: lifetime.signal,
      bindings: actions.map((action) => ({ action, routing: { realm: 'devserver', provider: connection.provider.id } })),
    }) } },
  });
  own(() => mounted.dispose?.());
  lifetime.signal.throwIfAborted();
  document.querySelector<HTMLOutputElement>('#provider')!.textContent = JSON.stringify(connection.provider);
  status.textContent = 'Connected';
}

document.querySelector<HTMLFormElement>('#connect')!.addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector<HTMLButtonElement>('#connect button')!.disabled = true;
  void connect().catch((error: unknown) => {
    dispose();
    status.textContent = 'Connection failed: ' + String(error);
  });
}, { once: true });
document.querySelector<HTMLButtonElement>('#disconnect')!.addEventListener('click', dispose, { once: true });
window.addEventListener('pagehide', dispose, { once: true });
`;

export const packedInspectorHtml = `<!doctype html><html><head><script>
document.documentElement.dataset.firstScript = JSON.stringify({
  marker: Reflect.get(globalThis, 'responseInspectorMarker') ?? null,
  readyState: document.readyState,
});
</script><title>Packed response inspector</title></head><body>
<form id="connect"><label>Native auth token<input id="token" type="password" required></label>
<button>Connect</button></form><output id="connection">Disconnected</output>
<button id="disconnect">Disconnect</button><output id="provider"></output>
<main id="inspector"></main><script type="module" src="/packed-browser.ts"></script>
</body></html>`;
