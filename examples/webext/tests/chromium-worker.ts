import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { ProviderDescriptor } from '@devkit/core';
import { counterCapability, increaseCounterAction } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { publishCounterView } from './json-view-fixture.ts';

type ServerHost = Awaited<ReturnType<typeof createRemoteHost>>;
interface ConnectedServer {
  readonly host: ServerHost;
  readonly initialValue: number;
}

/** Force native termination; this does not simulate or measure the browser's idle policy. */
export async function checkChromiumWorker(first: Page, second: Page): Promise<string[]> {
  await using cleanup = new AsyncDisposableStack();
  await Promise.all([first.reload(), second.reload()]);
  for (const page of [first, second]) await expect(page.locator('#status')).toHaveText('Connected');
  await first.locator('#write').click();
  await expect(first.locator('#result')).toHaveText('"Native write"');
  for (const page of [first, second])
    await expect(page.getByText('Counter: 10', { exact: true })).toBeVisible();
  const provider = await readProvider(first);
  assert.deepEqual(await readProvider(second), provider);
  const documents = await Promise.all(
    [first, second].map((page) => page.evaluate(() => performance.timeOrigin)),
  );
  const servers = await connectServers(first, cleanup);
  const executions = await readExecutions(second);
  await first.locator('#wait').click();
  assert.deepEqual(await readExecutions(second), {
    started: executions.started + 1,
    completed: executions.completed,
  });
  await expect(first.locator('#result')).toHaveText('Pending');
  const termination = await stopWorker(first);
  for (const page of [first, second]) await checkClosedBackground(page);
  assert.deepEqual(
    await Promise.all([first, second].map((page) => page.evaluate(() => performance.timeOrigin))),
    documents,
  );
  await expect(first.locator('#result')).toContainText('closed');
  await checkSurvivingServers(first, servers, provider);
  await checkFullDisconnect(first, servers);
  const replacement = await checkFreshBackground(first, second, provider);
  return await saveEvidence(first, {
    provider,
    executions,
    termination,
    replacement,
    servers: servers.map(({ host, initialValue }) => ({
      provider: host.provider.provider,
      counter: initialValue + 2,
    })),
  });
}

async function checkClosedBackground(page: Page): Promise<void> {
  await expect(page.locator('#status')).toHaveText('Disconnected');
  for (const selector of ['#renderer', '#management'])
    await expect(page.locator(selector).locator('.devframes-json-render-scroll-root')).toHaveCount(
      0,
    );
}

export async function stopWorker(page: Page) {
  const scriptURL = await page.evaluate(() => chrome.runtime.getURL('background.js'));
  const control = await page.context().newCDPSession(page);
  let version: { versionId: string; runningStatus: string; targetId?: string } | undefined;
  const statuses: string[] = [];
  control.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const candidate of versions) {
      if (candidate.scriptURL !== scriptURL) continue;
      version = candidate;
      statuses.push(candidate.runningStatus);
    }
  });
  try {
    await control.send('ServiceWorker.enable');
    await expect.poll(() => version?.runningStatus).toBe('running');
    const running = version;
    assert.ok(running?.targetId !== undefined);
    await control.send('ServiceWorker.stopWorker', { versionId: running.versionId });
    await expect.poll(() => version?.runningStatus).toBe('stopped');
    await expect
      .poll(async () =>
        (await control.send('Target.getTargets')).targetInfos.some(
          (target) => target.targetId === running.targetId,
        ),
      )
      .toBe(false);
    return {
      method: 'ServiceWorker.stopWorker',
      scriptURL,
      versionId: running.versionId,
      targetId: running.targetId,
      statuses,
    };
  } finally {
    await control.detach();
  }
}

async function checkSurvivingServers(
  page: Page,
  servers: readonly ConnectedServer[],
  provider: ProviderDescriptor,
): Promise<void> {
  for (const { host, initialValue } of servers) {
    const view = page.locator(`[data-provider="${host.provider.provider.id}"]`);
    await expect(view.locator('[data-view]')).toHaveCount(1);
    await expect(view.getByText(`Remote: ${initialValue}`, { exact: true })).toBeVisible();
    await view.getByRole('button', { name: 'Increase published counter' }).click();
    await expect(view.getByText(`Remote: ${initialValue + 1}`, { exact: true })).toBeVisible();
    assert.equal(await readCounter(host), initialValue + 1);
  }
  await page.getByRole('button', { name: 'Increase all realms', exact: true }).click();
  await expect(page.locator('#server-result')).toHaveText(/^\[.*\]$/u);
  const outcomes: unknown = JSON.parse(await page.locator('#server-result').innerText());
  assert.ok(Array.isArray(outcomes));
  assert.equal(outcomes.length, 3);
  assert.partialDeepStrictEqual(outcomes, [
    { provider, status: 'rejected', reason: { code: 'unavailable-provider' } },
    ...servers.map(({ host, initialValue }) => ({
      provider: host.provider.provider,
      status: 'fulfilled',
      value: initialValue + 2,
    })),
  ]);
  for (const { host, initialValue } of servers) {
    const view = page.locator(`[data-provider="${host.provider.provider.id}"]`);
    await expect(view.getByText(`Remote: ${initialValue + 2}`, { exact: true })).toBeVisible();
    assert.equal(await readCounter(host), initialValue + 2);
  }
  await expect(page.locator('#status')).toHaveText('Disconnected');
}

async function checkFullDisconnect(page: Page, servers: readonly ConnectedServer[]): Promise<void> {
  const retained = await Promise.all(
    servers.map(({ host }) =>
      page
        .locator(`[data-provider="${host.provider.provider.id}"]`)
        .getByRole('button', { name: 'Increase published counter' })
        .elementHandle(),
    ),
  );
  await page.locator('#disconnect').click();
  await expect(page.locator('#server-views')).toBeEmpty();
  for (const handle of retained)
    await handle.evaluate((button) =>
      button.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  for (const { host, initialValue } of servers)
    assert.equal(await readCounter(host), initialValue + 2);
}

async function checkFreshBackground(
  first: Page,
  second: Page,
  provider: ProviderDescriptor,
): Promise<ProviderDescriptor> {
  await first.reload();
  await expect(first.locator('#status')).toHaveText('Connected');
  await expect(first.getByText('Counter: 0', { exact: true })).toBeVisible();
  const replacement = await readProvider(first);
  assert.equal(replacement.id, provider.id);
  assert.deepEqual(replacement.realm, provider.realm);
  assert.notEqual(replacement.incarnation, provider.incarnation);
  assert.deepEqual(await readExecutions(first), { started: 0, completed: 0 });
  await expect(second.locator('#status')).toHaveText('Disconnected');
  await expect(second.locator('#renderer').getByRole('button')).toHaveCount(0);
  await second.reload();
  for (const page of [first, second]) {
    await expect(page.locator('#status')).toHaveText('Connected');
    assert.deepEqual(await readProvider(page), replacement);
    await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
    await expect(
      page.locator('#renderer').locator('.devframes-json-render-scroll-root'),
    ).toHaveCount(1);
    await expect(
      page.locator('#management').locator('.devframes-json-render-scroll-root'),
    ).toHaveCount(1);
    await expect(
      page.locator('#renderer').getByRole('button', { name: 'Increase counter', exact: true }),
    ).toHaveCount(1);
  }
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
  await second.locator('#release').click();
  assert.deepEqual(await readExecutions(second), { started: 0, completed: 0 });
  return replacement;
}

export async function readProvider(page: Page): Promise<ProviderDescriptor> {
  const provider: unknown = JSON.parse(await page.locator('#provider').innerText());
  assert.ok(typeof provider === 'object' && provider !== null);
  assert.ok('id' in provider && typeof provider.id === 'string');
  assert.ok('incarnation' in provider && typeof provider.incarnation === 'string');
  assert.ok('realm' in provider && typeof provider.realm === 'object' && provider.realm !== null);
  assert.ok('id' in provider.realm && typeof provider.realm.id === 'string');
  return { id: provider.id, incarnation: provider.incarnation, realm: { id: provider.realm.id } };
}

async function readExecutions(page: Page): Promise<{ started: number; completed: number }> {
  await page.locator('#executions').click();
  await expect(page.locator('#result')).toHaveText(/^\{"started":\d+,"completed":\d+\}$/u);
  const executions: unknown = JSON.parse(await page.locator('#result').innerText());
  assert.ok(typeof executions === 'object' && executions !== null);
  assert.ok('started' in executions && typeof executions.started === 'number');
  assert.ok('completed' in executions && typeof executions.completed === 'number');
  return { started: executions.started, completed: executions.completed };
}

async function connectServer(page: Page, host: ServerHost): Promise<void> {
  await page.locator('#server-url').fill(`${host.origin}/__devkit-remote/`);
  await page.locator('#server-id').fill(host.provider.provider.id);
  await page.locator('#server-token').fill(host.token);
  await page.getByRole('button', { name: 'Connect server', exact: true }).click();
  await expect(page.locator('#server-result')).toHaveText(
    JSON.stringify(`Connected ${host.provider.provider.id}`),
  );
}

async function connectServers(
  page: Page,
  cleanup: AsyncDisposableStack,
): Promise<ConnectedServer[]> {
  const allowedOrigins = [await page.evaluate(() => location.origin)];
  const servers: ConnectedServer[] = [];
  for (const [kind, initialValue] of [
    ['devframe', 0],
    ['devtools', 3],
  ] as const) {
    const host = await createRemoteHost(kind, { providerId: `example.${kind}`, allowedOrigins });
    cleanup.defer(host.close);
    if (initialValue > 0)
      await host.provider.invoke({
        action: increaseCounterAction,
        input: { amount: initialValue },
      });
    cleanup.defer((await publishCounterView(host)).dispose);
    await connectServer(page, host);
    servers.push({ host, initialValue });
  }
  return servers;
}

async function readCounter(host: ServerHost): Promise<number> {
  const resolution = await host.provider.resolve({ capability: counterCapability });
  assert.ok(resolution.status === 'available');
  return resolution.binding.api.read({});
}

async function saveEvidence(page: Page, observations: unknown): Promise<string[]> {
  const checks = [
    'forced Chromium worker termination rejects the pending RPC and unmounts background views in both surviving documents',
    'background loss preserves both independent server views, their actions and partial broadcast outcomes',
    'explicit page disconnect disposes surviving server connections after background loss',
    'explicit fresh page connections start a new provider incarnation with reset ephemeral state and no replay',
    'reconnected pages mount one counter and management view and share one action effect',
  ];
  await page.screenshot({ path: 'artifacts/worker-recovery.png', fullPage: true });
  await writeFile(
    'artifacts/worker-recovery.json',
    JSON.stringify(
      {
        browser: page.context().browser()?.version(),
        checks,
        observations,
        counters: {
          beforeTermination: 10,
          afterFreshConnection: 0,
          afterAction: 1,
        },
        limitations: [
          'Forced service-worker termination, not natural idle suspension or Firefox event-page behavior',
          'No persistent storage, automatic reconnection, automatic retry or remote side-effect rollback',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  return checks;
}
