import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';

export interface ScriptStageOptions {
  readonly world: `${chrome.scripting.ExecutionWorld}`;
  readonly runAt: chrome.extensionTypes.RunAt;
  readonly active?: boolean;
}

/** Holding a real subresource proves document_end without asserting a browser-specific idle delay. */
export async function startScriptStageServer() {
  let held = true;
  const responses = new Set<ServerResponse>();
  function release() {
    held = false;
    for (const response of responses) sendImage(response);
    responses.clear();
  }
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/held.svg') {
      if (!held) {
        sendImage(response);
        return;
      }
      responses.add(response);
      response.once('close', () => {
        responses.delete(response);
      });
      return;
    }
    if (request.url !== '/index.html') {
      response.writeHead(204).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(documentHtml);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}/index.html`,
    hold() {
      held = true;
    },
    release,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}

function sendImage(response: ServerResponse): void {
  response.setHeader('Content-Type', 'image/svg+xml');
  response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
}

const documentHtml = `<!doctype html><html><head><script>
  document.dispatchEvent(new Event('example-script-timing'));
  document.documentElement.dataset.firstScript = JSON.stringify({
    injectedGlobal: Reflect.get(globalThis, 'exampleScriptTiming') ?? null,
    injectedReadyState: document.documentElement.dataset.injectedState ?? null,
    pageReadyState: document.readyState,
  });
  document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.domContentLoaded = 'true'; });
  window.addEventListener('load', () => { document.documentElement.dataset.windowLoaded = 'true'; });
</script><title>Native script stages</title></head><body>
  <img id="held-image" src="/held.svg" alt="Held native subresource">
  <div id="parser-end">Parsed sentinel</div>
</body></html>`;

/** Direct document inspection consumes only the packaged script's existing harmless DOM marker. */
export function readScriptStageSnapshot() {
  document.dispatchEvent(new Event('example-script-timing'));
  const firstScript: unknown = JSON.parse(document.documentElement.dataset.firstScript ?? 'null');
  const currentGlobal: unknown = Reflect.get(globalThis, 'exampleScriptTiming') ?? null;
  return {
    firstScript,
    injectedReadyState: document.documentElement.dataset.injectedState ?? null,
    currentGlobal,
    readyState: document.readyState,
    parserComplete: document.querySelector('#parser-end') !== null,
    domContentLoaded: document.documentElement.dataset.domContentLoaded === 'true',
    windowLoaded: document.documentElement.dataset.windowLoaded === 'true',
    imageComplete: document.querySelector<HTMLImageElement>('#held-image')!.complete,
  };
}

export function scriptStageDocumentReady() {
  return (
    document.documentElement.dataset.stageNavigating !== 'true' &&
    document.documentElement.dataset.domContentLoaded === 'true'
  );
}

export function checkScriptStageSnapshot(
  snapshot: ReturnType<typeof readScriptStageSnapshot>,
  { world, runAt, active = true }: ScriptStageOptions,
): void {
  const early = active && runAt === 'document_start';
  assert.deepEqual(snapshot.firstScript, {
    injectedGlobal: early && world === 'MAIN' ? 'loading' : null,
    injectedReadyState: early ? 'loading' : null,
    pageReadyState: 'loading',
  });
  assert.equal(snapshot.parserComplete, true);
  if (!active) {
    assert.equal(snapshot.injectedReadyState, null);
    assert.equal(snapshot.currentGlobal, null);
    return;
  }
  if (runAt === 'document_start') assert.equal(snapshot.injectedReadyState, 'loading');
  else if (runAt === 'document_end') assert.equal(snapshot.injectedReadyState, 'interactive');
  else assert.ok(['interactive', 'complete'].includes(snapshot.injectedReadyState ?? ''));
  assert.equal(snapshot.currentGlobal, world === 'MAIN' ? snapshot.injectedReadyState : null);
}

export function checkHeldSubresource(snapshot: ReturnType<typeof readScriptStageSnapshot>): void {
  assert.equal(snapshot.readyState, 'interactive');
  assert.equal(snapshot.domContentLoaded, true);
  assert.equal(snapshot.windowLoaded, false);
  assert.equal(snapshot.imageComplete, false);
}

export type ScriptStageServer = Awaited<ReturnType<typeof startScriptStageServer>>;
export type ScriptStageSnapshot = ReturnType<typeof readScriptStageSnapshot>;
