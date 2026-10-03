import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface ScriptContextOptions {
  readonly world: `${chrome.scripting.ExecutionWorld}`;
  readonly allFrames: boolean;
  readonly strictCsp: boolean;
  readonly active: boolean;
  readonly runAt?: chrome.extensionTypes.RunAt;
}

/** HTTP headers and page scripts stay independent of Vite's development HTML injection. */
export async function startScriptContextServer() {
  let strictCsp = false;
  let sameOrigin = '';
  let crossOrigin = '';
  const servers = [createServer(respond), createServer(respond)];
  function respond(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (strictCsp)
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'nonce-fixture-reader'; frame-src http://127.0.0.1:* http://localhost:*",
      );
    let children = '';
    if (request.url === '/index.html')
      children = `<iframe name="same" src="${sameOrigin}/frame.html"></iframe>
        <iframe name="cross" src="${crossOrigin}/frame.html"></iframe>
        <iframe name="denied" src="${sameOrigin.replace('127.0.0.1', 'localhost')}/frame.html"></iframe>`;
    response.end(`<!doctype html><html><head>${reader}
      <script>document.documentElement.dataset.ordinaryScript = 'executed';</script>
      <title>Native script contexts</title></head><body>${children}</body></html>`);
  }
  try {
    const starts = await Promise.allSettled(servers.map((server) => listen(server)));
    const origins = starts.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    [sameOrigin, crossOrigin] = [origins[0]!, origins[1]!];
    return {
      url: `${sameOrigin}/index.html`,
      setStrictCsp(value: boolean) {
        strictCsp = value;
      },
      async close() {
        await Promise.all(servers.map((server) => closeServer(server)));
      },
    };
  } catch (error) {
    await Promise.all(servers.map((server) => closeServer(server)));
    throw error;
  }
}

/** The nonce reader records early injection independently of the blocked page-script control. */
const reader = `<script nonce="fixture-reader">
  document.addEventListener('securitypolicyviolation', (event) => {
    const previous = document.documentElement.dataset.cspViolations;
    document.documentElement.dataset.cspViolations = [previous, event.effectiveDirective].filter(Boolean).join(',');
  });
  document.dispatchEvent(new Event('example-script-timing'));
  document.documentElement.dataset.firstScript = JSON.stringify({
    injectedGlobal: Reflect.get(globalThis, 'exampleScriptTiming') ?? null,
    injectedReadyState: document.documentElement.dataset.injectedState ?? null,
    pageReadyState: document.readyState,
  });
</script>`;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing native script fixture port');
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
}

export function readOptionalHostPermission() {
  return chrome.permissions.contains({ origins: ['http://localhost/*'] });
}

/** These readers run directly in each document; no page-to-extension bridge is involved. */
export function scriptContextReady({
  strictCsp,
  injected,
}: {
  strictCsp: boolean;
  injected: boolean;
}): boolean {
  if (document.documentElement.dataset.firstScript === undefined) return false;
  document.dispatchEvent(new Event('example-script-timing'));
  if (injected && document.documentElement.dataset.injectedState === undefined) return false;
  if (!strictCsp) return true;
  return (document.documentElement.dataset.cspViolations ?? '')
    .split(',')
    .some((directive) => directive === 'script-src' || directive === 'script-src-elem');
}

export function readScriptContextSnapshot() {
  const firstScript: unknown = JSON.parse(document.documentElement.dataset.firstScript ?? 'null');
  const currentGlobal: unknown = Reflect.get(globalThis, 'exampleScriptTiming') ?? null;
  return {
    url: location.href,
    firstScript,
    currentGlobal,
    currentInjectedState: document.documentElement.dataset.injectedState ?? null,
    ordinaryScript: document.documentElement.dataset.ordinaryScript ?? null,
    violations: (document.documentElement.dataset.cspViolations ?? '').split(',').filter(Boolean),
  };
}

export type ScriptContextSnapshot = ReturnType<typeof readScriptContextSnapshot>;
export type ScriptContextServer = Awaited<ReturnType<typeof startScriptContextServer>>;

export function checkScriptContexts(
  snapshots: readonly ScriptContextSnapshot[],
  options: ScriptContextOptions,
): void {
  assert.equal(snapshots.length, 4);
  const [top, same, cross, denied] = snapshots;
  assert.ok(top && same && cross && denied);
  assert.equal(new URL(top.url).origin, new URL(same.url).origin);
  assert.notEqual(new URL(top.url).origin, new URL(cross.url).origin);
  assert.equal(new URL(denied.url).hostname, 'localhost');
  for (const [index, snapshot] of snapshots.entries()) {
    const injected = options.active && (index === 0 || options.allFrames) && index !== 3;
    checkScriptContext(snapshot, options, injected);
  }
}

function checkScriptContext(
  snapshot: ScriptContextSnapshot,
  options: ScriptContextOptions,
  injected: boolean,
): void {
  const early = injected && (options.runAt ?? 'document_start') === 'document_start';
  assert.deepEqual(snapshot.firstScript, {
    injectedGlobal: early && options.world === 'MAIN' ? 'loading' : null,
    injectedReadyState: early ? 'loading' : null,
    pageReadyState: 'loading',
  });
  if (injected) {
    const readyStates = early ? ['loading'] : ['interactive', 'complete'];
    assert.ok(readyStates.includes(snapshot.currentInjectedState ?? ''));
  } else assert.equal(snapshot.currentInjectedState, null);
  assert.equal(
    snapshot.currentGlobal,
    options.world === 'MAIN' ? snapshot.currentInjectedState : null,
  );
  assert.equal(snapshot.ordinaryScript, options.strictCsp ? null : 'executed');
  checkViolations(snapshot.violations, options.strictCsp);
}

function checkViolations(violations: readonly string[], strictCsp: boolean): void {
  if (!strictCsp) {
    assert.deepEqual(violations, []);
    return;
  }
  assert.ok(
    violations.some((directive) => directive === 'script-src' || directive === 'script-src-elem'),
  );
}
