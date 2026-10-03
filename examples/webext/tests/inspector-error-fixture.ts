import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectorStateSchema } from '@devkit/example-contribution/inspector';
import { inspectorHostHtml, startInspectorHost } from './inspector-hosts.ts';

/** Fail the actual owned HTTP endpoint; the extension's MAIN-world fetch stays unchanged. */
export async function startInspectorErrorFixture() {
  const failure = { active: false };
  const requests: ('completed' | 'destroyed')[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url !== '/inspector-response') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(inspectorHostHtml);
      return;
    }
    if (failure.active) {
      requests.push('destroyed');
      response.destroy();
      return;
    }
    response.once('finish', () => {
      requests.push('completed');
    });
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('fixture:original');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    failure,
    requests: () => [...requests],
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

export type InspectorErrorFixture = Awaited<ReturnType<typeof startInspectorErrorFixture>>;

export async function startInspectorErrorSibling(
  extensionOrigin: string,
  cleanup: AsyncDisposableStack,
) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-inspector-error-sibling-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), inspectorHostHtml);
  const host = await startInspectorHost({ mode: 'devframe', extensionOrigin, directory });
  cleanup.defer(host.close);
  return host;
}

/** Observation only: read the existing native panel and renderer without an extension bridge. */
export function inspectorErrorSnapshot() {
  const container = document.querySelector('#inspector')!;
  const root = container.shadowRoot ?? container;
  const mount = root.querySelector<HTMLElement>(
    '.devframes-json-render-scroll-root, [data-renderer="custom"]',
  );
  const text = mount?.innerText ?? '';
  return {
    document: performance.timeOrigin,
    provider: document.querySelector('#provider')!.textContent ?? '',
    connection: document.querySelector('#status')!.textContent ?? '',
    state: text
      .split('\n')
      .filter((line) =>
        /^(Target|Response modification|Modification enabled|Response status|Response body|Marker installed):/u.test(
          line,
        ),
      ),
    text,
    alert: root.querySelector('[role="alert"]')?.textContent ?? '',
    buttons: root.querySelectorAll('button').length,
    disabled: root.querySelectorAll('button:disabled').length,
    custom: root.querySelector('[data-renderer="custom"]') !== null,
  };
}

export function isCurrentInspectorMount(element: Element): boolean {
  const container = document.querySelector('#inspector');
  const root = container?.shadowRoot ?? container;
  return (
    element.isConnected &&
    root?.querySelector('.devframes-json-render-scroll-root, [data-renderer="custom"]') === element
  );
}

export function checkInspectorSnapshot(current: ReturnType<typeof inspectorErrorSnapshot>) {
  assert.equal(current.connection, 'Connected');
  assert.equal(current.alert, '');
  assert.equal(current.buttons, 5);
  assert.equal(current.disabled, 0);
  assert.equal(current.state.length, 6);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkInspectorOutcomes(
  text: string,
  status: 'fulfilled' | 'rejected',
  origins: { readonly extension: string; readonly sibling: string },
  body: string,
) {
  const outcomes: unknown = JSON.parse(text);
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, 2);
  for (const [provider, origin] of [
    ['example.extension', origins.extension],
    ['example.devframe', origins.sibling],
  ] as const) {
    const outcome: unknown = outcomes.find(
      (value: unknown) =>
        isRecord(value) && isRecord(value.provider) && value.provider.id === provider,
    );
    assert.ok(isRecord(outcome));
    if (provider === 'example.extension' && status === 'rejected') {
      assert.equal(outcome.status, 'rejected');
      assert.deepEqual(outcome.reason, { message: 'Operation handler failed' });
    } else {
      assert.equal(outcome.status, 'fulfilled');
      assert.deepEqual(inspectorStateSchema.parse(outcome.value).latest, {
        url: `${origin}/inspector-response`,
        status: 200,
        body,
      });
    }
  }
  return outcomes as readonly unknown[];
}

export const inspectorErrorChecks = [
  'an actual owned HTTP connection failure rejects the extension provider outcome while the Devframe sibling still returns its own response',
  'broadcast outcomes preserve authored success semantics: dispatch completion is shown without invoking onError',
  'the failed fetch preserves prior inspector result and configuration, provider incarnation, document and renderer mount',
  'Reset and Inspect recover through the same mount and connection in both native reference and framework-free renderers',
];

export const inspectorErrorLimitations = [
  'One extension provider and one real Devframe development sibling; DevTools sibling and other extension surfaces are not exercised',
  'Provider rejection remains a broadcast outcome with the native generic operation error; the native cause is not exposed through the panel',
  'The browser may retry the failed native HTTP request; this proof makes no automatic retry, cancellation or rollback policy claim',
];
