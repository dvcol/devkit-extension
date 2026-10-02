import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { counterStateKey, increaseCounterAction } from '@devkit/example-contribution';
import { chromium, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createServer } from 'vite';
import { structuredCloneParse } from 'devframe/utils/structured-clone';
import { counterSpec } from '../src/spec.ts';

await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const observations = [];
for (const mode of ['devframe', 'devtools'] as const)
  observations.push(await checkHost(browser, mode));
await mkdir('artifacts', { recursive: true });
const receipt = {
  browser: browser.version(),
  observations,
  checks: observations.flatMap(({ mode, checks }) => checks.map((check) => `${mode}: ${check}`)),
  pageErrors: observations.flatMap((observation) => observation.pageErrors),
};
await writeFile('artifacts/renderers.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(styleText('green', '✅ [json-render]'), receipt);

async function checkHost(browserInstance: Browser, mode: 'devframe' | 'devtools') {
  await using lifetime = new AsyncDisposableStack();
  const example = await createJsonRenderExample(mode);
  lifetime.defer(example.close);
  const server = await serve(example);
  lifetime.defer(() => server.close());
  const origin = server.resolvedUrls?.local[0];
  assert.ok(
    typeof origin === 'string' && origin.length > 0,
    'The example server must publish a loopback URL',
  );
  const context = await browserInstance.newContext();
  lifetime.defer(() => context.close());
  const pageErrors: string[] = [];
  context.on('weberror', (error) => pageErrors.push(error.error().message));
  const { reference, custom } = await openViews({ context, origin, example });
  await checkActions(reference, custom);

  await checkReplacement(reference, custom);

  const view = await checkUnsupported(example, custom);
  await custom.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(reference, 5);
  await counter(custom, 5);
  assert.deepEqual(view.value().state, { value: 5 });
  await checkContributionLifetime(example, reference, custom);
  await example.close();
  for (const page of [reference, custom]) {
    await expect(page.locator('#view')).toBeEmpty();
    await expect(page.locator('#mount')).toBeDisabled();
    await expect(page.locator('#renderer')).toBeDisabled();
  }
  assert.deepEqual(pageErrors, []);
  return {
    mode,
    checks: [
      'pending native view read is disposed before same-key republication mounts',
      'unchanged JSON view with reference and custom renderer',
      'native action and state shared across both rendered pages',
      'native input rejection displayed without an unhandled error',
      'unmount removes subscriptions, DOM and click listeners',
      'remount reads current state; unregister restores reference renderer',
      'unsupported component fails explicitly on update and mount; valid remount recovers',
      'view disable and dependency loss remove both mounts; reenable republishes current business state',
      'host disconnect disposes both views and controls',
    ],
    finalValue: 7,
    pageErrors,
  };
}

async function checkContributionLifetime(
  example: Awaited<ReturnType<typeof createJsonRenderExample>>,
  reference: Page,
  custom: Page,
): Promise<void> {
  await example.viewPlugin.disable();
  for (const page of [reference, custom]) {
    await expect(page.locator('#view')).toBeEmpty();
    await expect(page.locator('#mount')).toBeDisabled();
  }
  assert.equal(
    await example.host.provider.invoke({ action: increaseCounterAction, input: { amount: 1 } }),
    6,
  );
  await example.viewPlugin.enable();
  await counter(reference, 6);
  await counter(custom, 6);
  const service = example.host.provider.startup.services[0];
  assert.ok(service);
  await service.disable();
  for (const page of [reference, custom]) await expect(page.locator('#view')).toBeEmpty();
  const state = await example.host.context.rpc.sharedState.get<{ value: number }>(counterStateKey);
  state.mutate((draft) => {
    draft.value = 7;
  });
  await service.enable();
  await counter(reference, 7);
  await counter(custom, 7);
}

async function openViews({
  context,
  origin,
  example,
}: {
  context: BrowserContext;
  origin: string;
  example: Awaited<ReturnType<typeof createJsonRenderExample>>;
}) {
  const reference = await openPendingView({ context, origin, example });
  const custom = await context.newPage();
  await custom.goto(origin);
  await counter(reference, 0);
  await counter(custom, 0);
  await custom.locator('#renderer').selectOption('custom');
  await expect(custom.locator('[data-renderer="custom"]')).toBeVisible();
  await counter(custom, 0);

  return { reference, custom };
}

/** Delay one genuine native state response while its owning contribution is replaced. */
async function openPendingView({
  context,
  origin,
  example,
}: {
  context: BrowserContext;
  origin: string;
  example: Awaited<ReturnType<typeof createJsonRenderExample>>;
}): Promise<Page> {
  const page = await context.newPage();
  const pendingRead = await delayFirstViewRead(page, example.stateKey);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect.poll(pendingRead.received).toBe(true);
  await example.viewPlugin.disable();
  await expect(page.locator('#view')).toBeEmpty();
  await expect(page.locator('#mount')).toBeDisabled();
  await example.viewPlugin.enable();
  await expect(page.locator('#view > div')).toHaveCount(1);
  pendingRead.release();
  await counter(page, 0);
  await expect(page.getByRole('button', { name: 'Increase counter', exact: true })).toHaveCount(1);
  assert.equal(pendingRead.reads(), 2);
  return page;
}

async function delayFirstViewRead(page: Page, stateKey: string) {
  let requestId: unknown;
  let release: (() => void) | undefined;
  let reads = 0;
  await page.routeWebSocket(/\/__devkit-remote\//u, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      const envelope = nativeEnvelope(message);
      if (
        envelope.m === 'devframe:rpc:server-state:get' &&
        Array.isArray(envelope.a) &&
        envelope.a[0] === stateKey
      ) {
        reads += 1;
        if (reads === 1) requestId = envelope.i;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const envelope = nativeEnvelope(message);
      if (requestId !== undefined && envelope.i === requestId) {
        requestId = undefined;
        release = () => {
          socket.send(message);
        };
        return;
      }
      socket.send(message);
    });
  });
  return {
    received: () => release !== undefined,
    release: () => {
      assert.ok(release);
      release();
    },
    reads: () => reads,
  };
}

function nativeEnvelope(message: string | Buffer): Record<string, unknown> {
  const serialized = message.toString();
  const envelope: unknown = serialized.startsWith('s:')
    ? structuredCloneParse(serialized.slice(2))
    : JSON.parse(serialized);
  assert.ok(typeof envelope === 'object' && envelope !== null);
  return { ...envelope };
}

async function checkReplacement(reference: Page, custom: Page): Promise<void> {
  await checkUnmount(reference, custom);
  await custom.locator('#renderer').selectOption('reference');
  await expect(custom.locator('[data-renderer="custom"]')).toHaveCount(0);
  await custom.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(reference, 4);
  await counter(custom, 4);
  await custom.locator('#renderer').selectOption('custom');
  await expect(custom.locator('[data-renderer="custom"]')).toBeVisible();
}

async function serve(example: Awaited<ReturnType<typeof createJsonRenderExample>>) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../browser/', import.meta.url)),
    logLevel: 'silent',
    define: { DEMO_AUTH_TOKEN: JSON.stringify(example.host.token) },
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: { '/__devkit-remote/': { target: example.host.origin, ws: true } },
    },
  });
  await server.listen();
  return server;
}

async function checkActions(reference: Page, custom: Page): Promise<void> {
  await custom.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(reference, 1);
  await counter(custom, 1);
  await custom.getByRole('button', { name: 'Try invalid input', exact: true }).click();
  await expect(custom.locator('#view [role="alert"]')).toContainText(/valid/iu);
  await counter(reference, 1);
  await counter(custom, 1);
  await custom.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await counter(reference, 2);
  await counter(custom, 2);
  await expect(custom.locator('#view [role="alert"]')).toBeEmpty();
}

async function counter(page: Page, value: number): Promise<void> {
  await expect(page.locator('#view').getByText(`Counter: ${value}`, { exact: true })).toBeVisible();
}

async function checkUnmount(reference: Page, custom: Page): Promise<void> {
  const detached = await custom.locator('[data-renderer="custom"]').elementHandle();
  assert.ok(detached !== null);
  try {
    await custom.getByRole('button', { name: 'Unmount view', exact: true }).click();
    await expect(custom.locator('#view')).toBeEmpty();
    await reference.getByRole('button', { name: 'Increase counter', exact: true }).click();
    await counter(reference, 3);
    assert.equal(await detached.evaluate((element) => element.isConnected), false);
    assert.match((await detached.textContent()) ?? '', /Counter: 2/u);
    await detached.evaluate((element) => element.querySelector('button')?.click());
    await custom.getByRole('button', { name: 'Mount view', exact: true }).click();
    await counter(custom, 3);
  } finally {
    await detached.dispose();
  }
}

async function checkUnsupported(
  example: Awaited<ReturnType<typeof createJsonRenderExample>>,
  page: Page,
): Promise<typeof example.view> {
  const view = await example.host.context.rpc.sharedState.get<ReturnType<typeof counterSpec>>(
    example.stateKey,
  );
  view.patch([
    {
      op: 'replace',
      path: [],
      value: {
        root: 'badge',
        state: { value: 4 },
        elements: { badge: { type: 'Badge', props: { text: 'Outside the example DOM catalog' } } },
      },
    },
  ]);
  await expect(page.locator('#view [role="alert"]')).toContainText('Unsupported component');
  await expect(page.locator('#view button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Unmount view', exact: true }).click();
  await page.getByRole('button', { name: 'Mount view', exact: true }).click();
  await expect(page.locator('#status')).toHaveText(
    'Mount failed: Error: Renderer unavailable: load-error',
  );
  await expect(page.locator('#view')).toBeEmpty();
  view.patch([{ op: 'replace', path: [], value: counterSpec({ value: 4 }) }]);
  await page.getByRole('button', { name: 'Mount view', exact: true }).click();
  await counter(page, 4);
  return view;
}
