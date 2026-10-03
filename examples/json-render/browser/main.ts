import { createDevframeClientRuntime } from '@devframes/hub/client';
import type { DevframeClientRuntime, DockRendererManifest } from '@devframes/hub/client';
import { DOCK_RENDERERS_STATE_KEY, HUB_EVENTS } from '@devframes/hub/constants';
import type { DevframeDockEntry } from '@devframes/hub/types';
import { JSON_RENDER_INDEX_KEY } from '@devframes/json-render';
import type { JsonRenderIndex } from '@devframes/json-render';
import { connectDevframe } from 'devframe/client';
import { domRenderer } from './renderer.js';

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
const rendererSelect = element('#renderer', HTMLSelectElement);
const cleanup = new DisposableStack();
const events = new AbortController();
let disposeView: (() => void) | undefined;
let pendingMount: Promise<unknown> = Promise.resolve();
let published = true;
cleanup.defer(() => {
  events.abort();
});

function unmount(): void {
  disposeView?.();
  disposeView = undefined;
  unmountButton.disabled = true;
  mountButton.disabled = cleanup.disposed || !published;
  status.textContent = 'View unmounted. Backend state is retained.';
}

function dispose(): void {
  unmount();
  cleanup.dispose();
  mountButton.disabled = true;
  rendererSelect.disabled = true;
  status.textContent = 'Disconnected. Reload the page to reconnect.';
}

/** A native startup/mount can finish after the document was disposed. */
function own(disposeResource: () => void): void {
  if (cleanup.disposed) disposeResource();
  else cleanup.defer(disposeResource);
}

async function mountRenderer({
  runtime,
  target,
  lifetime,
}: {
  runtime: DevframeClientRuntime;
  target: HTMLElement;
  lifetime: DisposableStack;
}): Promise<void> {
  if (lifetime.disposed) return;
  const entry = runtime.context.docks.entries.find(
    (candidate) => candidate.id === 'example:counter',
  );
  if (entry === undefined) throw new Error('Counter dock is unavailable');
  await runtime.context.docks.switchEntry(entry.id);
  if (lifetime.disposed) return;
  const result = await runtime.context.renderers.mount(entry, target);
  if (result.status !== 'mounted') throw new Error(`Renderer unavailable: ${result.status}`);
  if (lifetime.disposed) result.dispose();
  else lifetime.defer(result.dispose);
}

function mount(runtime: DevframeClientRuntime): Promise<void> {
  if (!published || cleanup.disposed || disposeView !== undefined) return Promise.resolve();
  const lifetime = new DisposableStack();
  const target = document.createElement('div');
  container.append(target);
  lifetime.defer(() => {
    target.remove();
  });
  const disposeMount = () => {
    lifetime.dispose();
  };
  disposeView = disposeMount;
  mountButton.disabled = true;
  rendererSelect.disabled = true;
  async function activate(): Promise<void> {
    try {
      await mountRenderer({ runtime, target, lifetime });
      if (lifetime.disposed) return;
      unmountButton.disabled = false;
      status.textContent = `Mounted using the ${rendererSelect.value} renderer and native state.`;
    } catch (cause) {
      if (lifetime.disposed) return;
      unmount();
      status.textContent = `Mount failed: ${String(cause)}`;
    } finally {
      if (disposeView === disposeMount || disposeView === undefined) {
        mountButton.disabled = cleanup.disposed || !published || disposeView !== undefined;
        rendererSelect.disabled = cleanup.disposed;
      }
    }
  }
  const completion = pendingMount.then(activate);
  pendingMount = completion;
  return completion;
}

/** Dock placement survives contribution disable; the native index controls view availability. */
async function observePublication(
  runtime: DevframeClientRuntime,
  client: Awaited<ReturnType<typeof connectDevframe>>,
): Promise<void> {
  const index = await client.sharedState.get<JsonRenderIndex>(JSON_RENDER_INDEX_KEY);
  let resume = false;
  let stateKey: string | undefined;
  function update(): void {
    const entry = Object.values(index.value()).find(
      (candidate) => candidate.id === 'counter' && candidate.scope === 'example',
    );
    const available = entry !== undefined;
    if (entry !== undefined) stateKey = entry.stateKey;
    if (available === published) return;
    published = available;
    if (!published) {
      resume = disposeView !== undefined;
      unmount();
      const removedKey = stateKey;
      /** A pending native get can repopulate its cache; finish it before eviction and remount. */
      if (removedKey !== undefined)
        pendingMount = pendingMount.then(() => client.sharedState.delete(removedKey));
      status.textContent = 'View contribution is unavailable. Backend state is retained.';
      return;
    }
    mountButton.disabled = cleanup.disposed;
    if (resume) void mount(runtime);
  }
  own(index.on('updated', update));
  update();
}

function registerRendererChoice(runtime: DevframeClientRuntime): void {
  let unregister: (() => void) | undefined;
  own(() => unregister?.());
  function registerSelection(): void {
    unregister?.();
    unregister = undefined;
    if (rendererSelect.value === 'custom')
      unregister = runtime.context.renderers.register('json-render', domRenderer);
  }
  /** A browser reload can restore the selector before native client startup. */
  registerSelection();
  rendererSelect.addEventListener(
    'change',
    () => {
      const mounted = disposeView !== undefined;
      unmount();
      registerSelection();
      if (mounted) void mount(runtime);
    },
    { signal: events.signal },
  );
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
  registerRendererChoice(runtime);
  await observePublication(runtime, nativeClient);
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
