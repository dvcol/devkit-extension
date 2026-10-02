import assert from 'node:assert/strict';
import { createServer } from 'node:http';

export const redirectRuleChecks = [
  'native redirect session rules change the actual server path and received body before the original request is sent',
  'native higher redirect priority selects one same-origin destination',
  'unmatched requests retain their original server path and received body',
  'native redirect response URLs preserve the granted loopback origin and expose measured redirect metadata',
  'duplicate native redirect rule rejects setup without changing either active redirect',
  'invalid native redirect rule rejects its atomic update without removing the existing redirect',
  'disabling and reenabling each redirect contribution preserves its sibling and native precedence',
  'disposing one redirect contribution preserves its sibling and disposing both restores the original request',
];

function responseBody(path: string) {
  if (path === '/redirect-lower') return { path, value: 'lower' };
  if (path === '/redirect-higher') return { path, value: 'higher' };
  return { path, value: 'original' };
}

export async function startRedirectServer() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    requests.push(path);
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><title>Native redirect fixture</title><h1>Native redirect fixture</h1>',
      );
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(responseBody(path)));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing native redirect fixture port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        /** Close browser preconnections that never sent a request and survive page teardown. */
        server.closeAllConnections();
      }),
  };
}

/** Record Fetch redirect metadata from the real document without assuming its native value. */
export async function readNativeRedirects() {
  const observations = [];
  for (const path of ['/transform-redirect', '/unmatched-redirect']) {
    const requestedUrl = new URL(path, location.href).href;
    const response = await fetch(requestedUrl, { cache: 'no-store' });
    observations.push({
      requestedUrl,
      responseUrl: response.url,
      redirected: response.redirected,
      status: response.status,
      body: await response.text(),
    });
  }
  return observations;
}

function checkResponse(observed: unknown, path: string) {
  assert.partialDeepStrictEqual(observed, {
    status: 200,
    body: JSON.stringify(responseBody(path)),
  });
  assert.ok(typeof observed === 'object' && observed !== null);
  assert.ok('requestedUrl' in observed && typeof observed.requestedUrl === 'string');
  assert.ok('responseUrl' in observed && typeof observed.responseUrl === 'string');
  assert.ok('redirected' in observed && typeof observed.redirected === 'boolean');
  assert.equal(observed.responseUrl, new URL(path, observed.requestedUrl).href);
}

interface RedirectBrowser {
  control(identifier: string): Promise<unknown>;
  observe(): Promise<unknown>;
  readonly requests: readonly string[];
}

async function checkObservation(browser: RedirectBrowser, expected: 'lower' | 'higher' | null) {
  const before = browser.requests.length;
  const observed = await browser.observe();
  assert.ok(Array.isArray(observed));
  assert.equal(observed.length, 2);
  const path = expected === null ? '/transform-redirect' : `/redirect-${expected}`;
  checkResponse(observed[0], path);
  checkResponse(observed[1], '/unmatched-redirect');
  const serverPaths = browser.requests
    .slice(before)
    .filter((request) =>
      [
        '/transform-redirect',
        '/redirect-lower',
        '/redirect-higher',
        '/unmatched-redirect',
      ].includes(request),
    );
  assert.deepEqual(serverPaths, [path, '/unmatched-redirect']);
  return { responses: observed, serverPaths };
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
      id: `example.redirects-${name}`,
      contributions: [{ kind: 'transform', status, generation }],
    },
  });
  assert.deepEqual(ruleIds(snapshot), expectedIds);
  return snapshot;
}

async function checkFailures(browser: RedirectBrowser) {
  const results = [];
  for (const kind of ['duplicate', 'invalid']) {
    const failure = await browser.control(`redirects-${kind}`);
    assert.partialDeepStrictEqual(failure, {
      failure: {
        id: `example.redirects-${kind}`,
        contributions: [
          { kind: 'transform', status: 'failed', diagnostics: [{ code: 'setup-failure' }] },
        ],
      },
    });
    assert.ok(typeof failure === 'object' && failure !== null && 'current' in failure);
    assert.deepEqual(ruleIds(failure.current), [1201, 1202]);
    results.push({ kind, failure, observed: await checkObservation(browser, 'higher') });
  }
  return results;
}

async function checkReactivation(
  browser: RedirectBrowser,
  name: 'lower' | 'higher',
  remaining: 'lower' | 'higher',
) {
  const disabled = checkInstallation(
    await browser.control(`redirects-${name}-disable`),
    name,
    'disabled',
    1,
    [remaining === 'lower' ? 1201 : 1202],
  );
  const absent = await checkObservation(browser, remaining);
  const enabled = checkInstallation(
    await browser.control(`redirects-${name}-enable`),
    name,
    'active',
    2,
    [1201, 1202],
  );
  const restored = await checkObservation(browser, 'higher');
  return { disabled, absent, enabled, restored };
}

async function checkDisposal(browser: RedirectBrowser) {
  const disposedLower = checkInstallation(
    await browser.control('redirects-lower-dispose'),
    'lower',
    'disposed',
    2,
    [1202],
  );
  const lowerDisposed = await checkObservation(browser, 'higher');
  const disposedHigher = checkInstallation(
    await browser.control('redirects-higher-dispose'),
    'higher',
    'disposed',
    2,
    [],
  );
  const bothDisposed = await checkObservation(browser, null);
  return { disposedLower, lowerDisposed, disposedHigher, bothDisposed };
}

async function checkRedirectLifecycle(browser: RedirectBrowser) {
  return {
    lower: await checkReactivation(browser, 'lower', 'higher'),
    higher: await checkReactivation(browser, 'higher', 'lower'),
    disposal: await checkDisposal(browser),
  };
}

export async function checkNativeRedirectRules(browser: RedirectBrowser) {
  const original = await checkObservation(browser, null);
  const lower = checkInstallation(
    await browser.control('redirects-lower-install'),
    'lower',
    'active',
    1,
    [1201],
  );
  const lowerOnly = await checkObservation(browser, 'lower');
  const higher = checkInstallation(
    await browser.control('redirects-higher-install'),
    'higher',
    'active',
    1,
    [1201, 1202],
  );
  try {
    return {
      original,
      lower,
      lowerOnly,
      higher,
      overlapping: await checkObservation(browser, 'higher'),
      failures: await checkFailures(browser),
      lifecycle: await checkRedirectLifecycle(browser),
      checks: redirectRuleChecks,
    };
  } finally {
    await browser.control('redirects-lower-dispose');
    await browser.control('redirects-higher-dispose');
  }
}
