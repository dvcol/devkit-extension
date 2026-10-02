import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export const headerRuleChecks = [
  'native session header rules change server-observed request and page-observed response headers',
  'native higher rule priority controls overlapping request and response header sets',
  'unmatched requests retain original request and response headers',
  'duplicate native session rule rejects setup without changing either active rule',
  'invalid native session rule rejects its atomic update without removing the existing rule',
  'disabling and reenabling each header contribution preserves its sibling and native precedence',
  'disposing one header contribution preserves its sibling and disposing both restores original headers',
];

export async function startHeaderServer() {
  const requests: { path: string; requestHeader: string | readonly string[] | null }[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><title>Native header transform fixture</title><h1>Native header transform fixture</h1>',
      );
      return;
    }
    const requestHeader = request.headers['x-devkit-request'] ?? null;
    requests.push({ path, requestHeader });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Devkit-Response', 'original');
    response.end(JSON.stringify({ requestHeader }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing native header fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** Run in the actual fixture document so these fetches have its granted loopback initiator. */
export async function readNativeHeaders() {
  const matched = await fetch('/transform-headers', { cache: 'no-store' });
  const unmatched = await fetch('/unmatched-headers', { cache: 'no-store' });
  const matchedBody: unknown = await matched.json();
  const unmatchedBody: unknown = await unmatched.json();
  return {
    matched: { received: matchedBody, responseHeader: matched.headers.get('X-Devkit-Response') },
    unmatched: {
      received: unmatchedBody,
      responseHeader: unmatched.headers.get('X-Devkit-Response'),
    },
  };
}

function checkObservation(observed: unknown, expected: 'lower' | 'higher' | null) {
  assert.deepEqual(observed, {
    matched: { received: { requestHeader: expected }, responseHeader: expected ?? 'original' },
    unmatched: { received: { requestHeader: null }, responseHeader: 'original' },
  });
  return observed;
}

function ruleIds(snapshot: unknown) {
  assert.ok(typeof snapshot === 'object' && snapshot !== null && 'rules' in snapshot);
  assert.ok(Array.isArray(snapshot.rules));
  return snapshot.rules
    .map((rule: unknown) => {
      assert.ok(
        typeof rule === 'object' && rule !== null && 'id' in rule && typeof rule.id === 'number',
      );
      return rule.id;
    })
    .toSorted((first, second) => first - second);
}

function checkInstallation(
  snapshot: unknown,
  name: string,
  status: string,
  generation: number,
  expectedIds: readonly number[],
) {
  assert.partialDeepStrictEqual(snapshot, {
    [name]: {
      id: `example.headers-${name}`,
      contributions: [{ kind: 'transform', status, generation }],
    },
  });
  assert.deepEqual(ruleIds(snapshot), expectedIds);
  return snapshot;
}

interface HeaderBrowser {
  control(identifier: string): Promise<unknown>;
  observe(): Promise<unknown>;
}

async function checkFailures(browser: HeaderBrowser) {
  const results = [];
  for (const kind of ['duplicate', 'invalid']) {
    const failure = await browser.control(`headers-${kind}`);
    assert.partialDeepStrictEqual(failure, {
      failure: {
        id: `example.headers-${kind}`,
        contributions: [
          { kind: 'transform', status: 'failed', diagnostics: [{ code: 'setup-failure' }] },
        ],
      },
    });
    assert.ok(typeof failure === 'object' && failure !== null && 'current' in failure);
    assert.deepEqual(ruleIds(failure.current), [1101, 1102]);
    results.push({ kind, failure, observed: checkObservation(await browser.observe(), 'higher') });
  }
  return results;
}

async function checkReactivation(
  browser: HeaderBrowser,
  name: 'lower' | 'higher',
  remaining: 'lower' | 'higher',
) {
  const disabled = checkInstallation(
    await browser.control(`headers-${name}-disable`),
    name,
    'disabled',
    1,
    [remaining === 'lower' ? 1101 : 1102],
  );
  const absent = checkObservation(await browser.observe(), remaining);
  const enabled = checkInstallation(
    await browser.control(`headers-${name}-enable`),
    name,
    'active',
    2,
    [1101, 1102],
  );
  const restored = checkObservation(await browser.observe(), 'higher');
  return { disabled, absent, enabled, restored };
}

async function checkDisposal(browser: HeaderBrowser) {
  const disposedLower = checkInstallation(
    await browser.control('headers-lower-dispose'),
    'lower',
    'disposed',
    2,
    [1102],
  );
  const lowerDisposed = checkObservation(await browser.observe(), 'higher');
  const disposedHigher = checkInstallation(
    await browser.control('headers-higher-dispose'),
    'higher',
    'disposed',
    2,
    [],
  );
  const bothDisposed = checkObservation(await browser.observe(), null);
  return {
    disposedLower,
    lowerDisposed,
    disposedHigher,
    bothDisposed,
  };
}

async function checkHeaderLifecycle(browser: HeaderBrowser) {
  return {
    lower: await checkReactivation(browser, 'lower', 'higher'),
    higher: await checkReactivation(browser, 'higher', 'lower'),
    disposal: await checkDisposal(browser),
  };
}

export async function checkNativeHeaderRules(browser: HeaderBrowser) {
  const original = checkObservation(await browser.observe(), null);
  const lower = checkInstallation(
    await browser.control('headers-lower-install'),
    'lower',
    'active',
    1,
    [1101],
  );
  const lowerOnly = checkObservation(await browser.observe(), 'lower');
  const higher = checkInstallation(
    await browser.control('headers-higher-install'),
    'higher',
    'active',
    1,
    [1101, 1102],
  );
  try {
    const overlapping = checkObservation(await browser.observe(), 'higher');
    const failures = await checkFailures(browser);
    const lifecycle = await checkHeaderLifecycle(browser);
    return {
      original,
      lower,
      lowerOnly,
      higher,
      overlapping,
      failures,
      lifecycle,
      checks: headerRuleChecks,
    };
  } finally {
    await browser.control('headers-lower-dispose');
    await browser.control('headers-higher-dispose');
  }
}
