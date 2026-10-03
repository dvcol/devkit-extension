import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { getTempAuthCodeInfo } from 'devframe/node/auth';
import { connectInspector } from './inspector-browser-actions.ts';
import {
  inspectorDevelopmentChecks,
  inspectorDevelopmentFixture,
} from './inspector-development-fixture.ts';

await using cleanup = new AsyncDisposableStack();
const browser = await chromium.launch({ headless: true });
cleanup.defer(() => browser.close());
const observations = [];
for (const host of ['devframe', 'devtools'] as const)
  observations.push(await checkHost(browser, host));
await cleanup.disposeAsync();
const allPageErrors = observations.flatMap((observation) => observation.pageErrors);
assert.deepEqual(allPageErrors, []);
const receipt = {
  browser: browser.version(),
  observations,
  pageErrors: allPageErrors,
  checks: observations.flatMap(({ host }) =>
    inspectorDevelopmentChecks.map((check) => `${host}: ${check}`),
  ),
  limitations: [
    'Native inspector main-module reload only; backend module HMR and extension edits are not exercised',
    'A failed browser module cannot dispatch actions; the native backend remains alive with its prior state',
  ],
};
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/inspector-development-chromium.json',
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.info(styleText('green', '🧪 [inspector/development/chromium]'), receipt);

async function checkHost(browserInstance: Browser, host: 'devframe' | 'devtools') {
  await using lifetime = new AsyncDisposableStack();
  const fixture = await inspectorDevelopmentFixture(host);
  lifetime.defer(fixture.close);
  const context = await browserInstance.newContext();
  lifetime.defer(() => context.close());
  const pageErrors: string[] = [];
  context.on('weberror', (error) => pageErrors.push(error.error().message));
  const page = await context.newPage();
  const authPrompts = authenticateReloads(page, pageErrors);
  const consoleErrors: { text: string; url: string }[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  await connectInspector({ page, ...fixture });
  await action(page, 'Enable response modification', 'Configuration dispatch complete');
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  await retainedState(page);
  const initial = await snapshot(page);
  assert.equal(fixture.requests.length, 1);
  await fixture.edit('Updated development inspector');
  const updated = await reloaded(page, initial.document, 'Updated development inspector');
  assert.deepEqual(updated.provider, initial.provider);
  assert.equal(fixture.requests.length, 1);
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  assert.equal(fixture.requests.length, 2);
  const failure = await failSource(page, fixture, updated.document);
  assert.equal(fixture.requests.length, 2);
  await fixture.edit('Recovered development inspector');
  const recovered = await reloaded(page, failure.document, 'Recovered development inspector');
  assert.deepEqual(recovered.provider, initial.provider);
  assert.equal(fixture.requests.length, 2);
  await action(page, 'Inspect response', 'Inspection dispatch complete');
  assert.equal(fixture.requests.length, 3);
  assert.ok(fixture.requests.every((request) => request.completed));
  assert.deepEqual(pageErrors, []);
  checkExpectedErrors(consoleErrors);
  return {
    host,
    initial,
    updated,
    failure,
    recovered,
    requests: fixture.requests,
    pageErrors,
    consoleErrors,
    authPrompts,
  };
}

function authenticateReloads(page: Page, errors: string[]) {
  const prompts: string[] = [];
  page.on('dialog', (dialog) => {
    assert.equal(dialog.type(), 'prompt');
    assert.equal(
      dialog.message(),
      'devframe: enter the authentication code shown in your terminal',
    );
    prompts.push(dialog.message());
    void dialog.accept(getTempAuthCodeInfo().code).catch((error: unknown) => {
      errors.push(String(error));
    });
  });
  return prompts;
}

async function action(page: Page, label: string, outcome: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#inspector').getByText(outcome, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
}

async function retainedState(page: Page): Promise<void> {
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#inspector > div')).toHaveCount(1);
  await expect(page.locator('#inspector button')).toHaveCount(5);
  await expect(page.locator('#inspector')).toContainText('Modification enabled: true');
  await expect(page.locator('#inspector')).toContainText('Response body: native:fixture:original');
  await expect(page.locator('#inspector [role="alert"]')).toHaveCount(0);
}

async function snapshot(page: Page) {
  return {
    document: await page.evaluate(() => performance.timeOrigin),
    provider: JSON.parse(await page.locator('#provider').innerText()) as unknown,
    renderer: await page.locator('#inspector-renderer').inputValue(),
    body: await page.getByText(/^Response body:/u).innerText(),
    configuration: await page.getByText(/^Modification enabled:/u).innerText(),
  };
}

async function reloaded(page: Page, previous: number, heading: string) {
  await expect(page.locator('h1')).toHaveText(heading);
  assert.notEqual(await page.evaluate(() => performance.timeOrigin), previous);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await retainedState(page);
  return snapshot(page);
}

async function failSource(
  page: Page,
  fixture: Awaited<ReturnType<typeof inspectorDevelopmentFixture>>,
  previous: number,
) {
  const response = page.waitForResponse(
    (received) => new URL(received.url()).pathname === '/main.ts' && received.status() === 500,
  );
  await fixture.invalidate();
  const failedResponse = await response;
  await expect(page.locator('vite-error-overlay')).toBeVisible();
  const failure = await page.evaluate(() => ({
    document: performance.timeOrigin,
    message:
      document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message-body')
        ?.textContent ?? '',
    mounts: document.querySelectorAll('#inspector > div').length,
    rendererDisabled: document.querySelector('#inspector-renderer')?.matches(':disabled') === true,
  }));
  assert.notEqual(failure.document, previous);
  assert.match(failure.message, /\[PARSE_ERROR\] Unexpected token/u);
  assert.match(failure.message, /export const invalidInspector = ;/u);
  assert.equal(failure.mounts, 0);
  assert.equal(failure.rendererDisabled, true);
  return { ...failure, responseStatus: failedResponse.status() };
}

function checkExpectedErrors(errors: { text: string; url: string }[]): void {
  assert.ok(errors.length > 0);
  for (const error of errors)
    assert.ok(
      (new URL(error.url).pathname === '/main.ts' && /500/u.test(error.text)) ||
        /\[PARSE_ERROR\] Unexpected token/u.test(error.text),
      `Unexpected browser console error: ${JSON.stringify(error)}`,
    );
}
