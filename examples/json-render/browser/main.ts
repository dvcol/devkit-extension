import { createDevframeClientRuntime } from '@devframes/hub/client';
import type { DevframeClientRuntime, DockRendererManifest } from '@devframes/hub/client';
import { DOCK_RENDERERS_STATE_KEY, HUB_EVENTS } from '@devframes/hub/constants';
import type { DevframeDockEntry } from '@devframes/hub/types';
import { connectDevframe } from 'devframe/client';

/** Temporary credential injected by this loopback-only demo launcher. */
declare const DEMO_AUTH_TOKEN: string;

function element<Constructor extends typeof HTMLElement>(
  selector: string,
  constructor: Constructor,
): InstanceType<Constructor>;
function element(selector: string, constructor: typeof HTMLElement): HTMLElement {
  const found = document.querySelector(selector);
  if (!(found instanceof constructor)) throw new Error(`Missing example element: ${selector}`);
  return found;
}

const container = element('#view', HTMLElement);
const status = element('#status', HTMLElement);
const mountButton = element('#mount', HTMLButtonElement);
const unmountButton = element('#unmount', HTMLButtonElement);
const cleanup = new DisposableStack();
const events = new AbortController();
let disposeView: (() => void) | undefined;
cleanup.defer(() => {
  events.abort();
});

function unmount(): void {
  disposeView?.();
  disposeView = undefined;
  unmountButton.disabled = true;
  mountButton.disabled = cleanup.disposed;
  status.textContent = 'View unmounted. Backend state is retained.';
}

function dispose(): void {
  unmount();
  cleanup.dispose();
  mountButton.disabled = true;
  status.textContent = 'Disconnected. Reload the page to reconnect.';
}

/** A native startup/mount can finish after the document was disposed. */
function own(disposeResource: () => void): void {
  if (cleanup.disposed) disposeResource();
  else cleanup.defer(disposeResource);
}

async function mount(runtime: DevframeClientRuntime): Promise<void> {
  mountButton.disabled = true;
  try {
    const entry = runtime.context.docks.entries.find(
      (candidate) => candidate.id === 'example:counter',
    );
    if (entry === undefined) throw new Error('Counter dock is unavailable');
    await runtime.context.docks.switchEntry(entry.id);
    if (cleanup.disposed) return;
    const result = await runtime.context.renderers.mount(entry, container);
    if (result.status !== 'mounted') throw new Error(`Renderer unavailable: ${result.status}`);
    if (cleanup.disposed) {
      result.dispose();
      return;
    }
    disposeView = result.dispose;
    unmountButton.disabled = false;
    status.textContent = 'Mounted using the native renderer and native state.';
  } catch (cause) {
    if (!cleanup.disposed) status.textContent = `Mount failed: ${String(cause)}`;
  } finally {
    mountButton.disabled = cleanup.disposed || disposeView !== undefined;
  }
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
  await nativeClient.ensureTrusted();
  /** Avoid the native runtime's initial placeholders when mounting immediately after startup. */
  await Promise.all([
    nativeClient.sharedState.get<DevframeDockEntry[]>(HUB_EVENTS.sharedState.docks),
    nativeClient.sharedState.get<DockRendererManifest>(DOCK_RENDERERS_STATE_KEY),
  ]);
  if (cleanup.disposed) return;
  const runtime = await createDevframeClientRuntime({
    rpc: nativeClient,
    loadClientScripts: false,
  });
  own(runtime.dispose);
  if (cleanup.disposed) return;
  own(
    nativeClient.events.on('connection:status', (value) => {
      if (value !== 'connected' && value !== 'connecting') dispose();
    }),
  );
  mountButton.addEventListener(
    'click',
    () => {
      void mount(runtime);
    },
    { signal: events.signal },
  );
  await mount(runtime);
}

unmountButton.addEventListener('click', unmount, { signal: events.signal });
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    window.removeEventListener('pagehide', dispose);
  });
try {
  await start();
} catch (cause) {
  dispose();
  status.textContent = `Connection failed: ${String(cause)}`;
}
