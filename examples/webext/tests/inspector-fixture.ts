import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export async function startInspectorFixture() {
  let reads = 0;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/inspector-response') {
      reads += 1;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.write('fixture:original');
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><script>
document.documentElement.dataset.firstScript = JSON.stringify({
  marker: Reflect.get(globalThis, 'responseInspectorMarker') ?? null,
  readyState: document.readyState,
});
</script><title>Owned response inspector fixture</title></head><body>
<h1>Owned response inspector fixture</h1></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    reads: () => reads,
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

export type InspectorFixture = Awaited<ReturnType<typeof startInspectorFixture>>;

/** Driver-side observation reads the actual fixture document, without an extension bridge. */
export function inspectorMarkerSnapshot() {
  const value = document.documentElement.dataset.firstScript;
  if (value === undefined) throw new Error('The fixture did not record its first parser script');
  const firstScript: unknown = JSON.parse(value);
  const currentMarker: unknown = Reflect.get(globalThis, 'responseInspectorMarker');
  return { firstScript, currentMarker: currentMarker ?? null };
}

export async function readInspectorResponse() {
  const response = await fetch('/inspector-response', { cache: 'no-store' });
  return { url: response.url, status: response.status, body: await response.text() };
}

export function inspectorOutcome(text: string, status: 'fulfilled' | 'rejected'): unknown {
  const outcomes: unknown = JSON.parse(text);
  assert.partialDeepStrictEqual(outcomes, [
    { provider: { id: 'example.extension', realm: { id: 'webext' } }, status },
  ]);
  return outcomes;
}

export const inspectorChecks = [
  'shared native JSON inspector returns the actual owned response URL and status and displays its body',
  'zero and multiple owned fixture tabs reject per provider without requesting a response or changing prior results',
  'marker registration affects the next owned document before its first parser script',
  'reset clears configuration and result, unregisters future injection and leaves the existing document marker intact',
  'inspector failures preserve the independent counter state and provider incarnation',
];

export const inspectorLimitations = [
  'Panel rejection messages retain the native generic operation error; precise target-selection causes are covered by service tests',
  'One extension provider; mixed-host inspector broadcast remains a separate proof',
];
