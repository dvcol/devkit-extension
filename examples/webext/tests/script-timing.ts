import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { Browser } from '@wxt-dev/browser';

export async function startTimingServer() {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./script-timing/', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error('Missing script-timing server URL');
    return { url, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

/** These functions run in the extension document through the real browser driver. */
export async function registerTimingScript(world: `${Browser.scripting.ExecutionWorld}`) {
  await chrome.scripting.registerContentScripts([
    {
      id: 'example-script-timing',
      js: ['script-timing.js'],
      matches: ['http://127.0.0.1/index.html'],
      runAt: 'document_start',
      world,
      allFrames: false,
      persistAcrossSessions: false,
    },
  ]);
  return chrome.scripting.getRegisteredContentScripts({ ids: ['example-script-timing'] });
}

export async function unregisterTimingScript() {
  await chrome.scripting.unregisterContentScripts({ ids: ['example-script-timing'] });
  return chrome.scripting.getRegisteredContentScripts({ ids: ['example-script-timing'] });
}

export function readTimingSnapshot(): unknown {
  const snapshot = document.documentElement.dataset.firstScript;
  if (snapshot === undefined) throw new Error('The first page script did not record its snapshot');
  return JSON.parse(snapshot) as unknown;
}

export function checkTimingSnapshot(
  snapshot: unknown,
  world?: `${Browser.scripting.ExecutionWorld}`,
) {
  assert.deepEqual(snapshot, {
    injectedGlobal: world === 'MAIN' ? 'loading' : null,
    injectedReadyState: world === undefined ? null : 'loading',
    pageReadyState: 'loading',
  });
  return { world: world ?? 'unregistered', snapshot };
}

export function checkTimingRegistration(
  registrations: Browser.scripting.RegisteredContentScript[],
  world: `${Browser.scripting.ExecutionWorld}`,
): void {
  assert.equal(registrations.length, 1);
  const registration = registrations[0];
  assert.ok(registration);
  assert.equal(registration.id, 'example-script-timing');
  assert.equal(registration.world, world);
  assert.equal(registration.runAt, 'document_start');
  assert.equal(registration.allFrames, false);
  assert.equal(registration.persistAcrossSessions, false);
  assert.deepEqual(registration.js, ['script-timing.js']);
  assert.deepEqual(registration.matches, ['http://127.0.0.1/index.html']);
}

export function readUnmatchedMarkers() {
  document.dispatchEvent(new Event('example-script-timing'));
  return {
    global: Reflect.has(globalThis, 'exampleScriptTiming'),
    listener: document.documentElement.dataset.injectedState ?? null,
  };
}
