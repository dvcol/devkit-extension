import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { styleText } from 'node:util';
import { chromium, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { createServer } from 'wxt';
import type { WxtDevServer } from 'wxt';
import { checkChromiumHostDevelopment } from './chromium-host-development.ts';
import {
  availablePort,
  createDevelopmentFixture,
  updateDevelopmentVersion,
} from './development-fixture.ts';

const root = await createDevelopmentFixture();
const errors: string[] = [];
const artifactDirectory = 'artifacts/chromium-development';
/** Native CDP pipe failures can terminate before the launch promise rejects. */
process.on('uncaughtExceptionMonitor', () => {
  const path = join(root, '.wxt/chromium-profile/chrome-err.log');
  if (!existsSync(path)) return;
  console.error(styleText('red', '❌ [webext/dev]'), readFileSync(path, 'utf8'));
});
let server: WxtDevServer | undefined;
let browser: Browser | undefined;
try {
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(`${artifactDirectory}/receipt.json`, JSON.stringify({ passed: false }));
  const observerPort = await availablePort();
  const chromiumArgs = ['--headless=new', `--remote-debugging-port=${observerPort}`];
  /** Ubuntu CI cannot sandbox downloaded Chromium; match Playwright's isolated test launch. */
  if (process.platform === 'linux' && process.env.CI === 'true') chromiumArgs.push('--no-sandbox');
  server = await createServer({
    root,
    browser: 'chrome',
    dev: { server: { port: await availablePort() } },
    webExt: {
      binaries: { chrome: chromium.executablePath() },
      chromiumArgs,
    },
  });
  await server.start();
  browser = await connectObserver(observerPort);
  const context = browser.contexts()[0];
  assert.ok(context);
  context.on('weberror', (error) => errors.push(error.error().message));
  await enableDeveloperMode(context);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const first = await openPanel(context, origin);
  const second = await openPanel(context, origin);
  assert.equal(await first.evaluate(() => chrome.runtime.getManifest().version), '0.0.1');
  await checkModuleReplacement(first, second);
  await checkHtmlReplacement(first, second);
  const replacement = await checkBackgroundReplacement(first, second, origin);
  const configured = await checkConfigurationRestart(replacement, origin, observerPort);
  await checkChromiumHostDevelopment(configured, root);
  assert.deepEqual(errors, []);
  await configured.screenshot({
    path: `${artifactDirectory}/panel.png`,
    fullPage: true,
  });
  await server.stop();
  assert.equal(browser.isConnected(), false, 'Native WXT stop must close its browser');
} finally {
  const cleanup = [
    ...(await Promise.allSettled([server?.stop()])),
    ...(await Promise.allSettled([browser?.close()])),
    ...(await Promise.allSettled([rm(root, { recursive: true, force: true })])),
  ];
  assert.equal(
    cleanup.find((result) => result.status === 'rejected'),
    undefined,
  );
}

await writeFile(
  `${artifactDirectory}/receipt.json`,
  JSON.stringify(
    {
      passed: true,
      browser: browser.version(),
      scenarios: [
        'Native managed startup with shared manifest and real JSON renderer',
        'Panel HMR retains document, provider and state with new caller and one action effect',
        'Pending old action completes without overwriting replacement UI',
        'HTML edit reloads documents and retains provider state',
        'Background edit replaces provider, resets ephemeral state and does not replay actions',
        'Config edit closes the original browser and adopts manifest 0.0.2 in a new provider',
        'Actual popup HMR retains document, form and state with a fresh caller and one JSON action effect',
        'Pre-HMR popup work completes once without overwriting the replacement result',
        'Actual DevTools panel module HMR retains document and state; HTML reload replaces document; each JSON action reaches options once',
        'Actual browser sidebar module HMR retains document and state; HTML reload replaces document; each JSON action reaches options once',
        'Native stop closes browser',
      ],
      errors,
    },
    null,
    2,
  ) + '\n',
);
console.info(styleText('green', '✅ [webext/dev]'), 'Chromium native development checks passed');

async function connectObserver(port: number): Promise<Browser> {
  let connected: Browser | undefined;
  await expect(async () => {
    connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
  }).toPass({ timeout: 30_000, intervals: [100, 250, 500] });
  assert.ok(connected);
  return connected;
}

async function enableDeveloperMode(context: BrowserContext): Promise<void> {
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  const toggle = manager.locator('#devMode');
  if (!(await toggle.evaluate((element) => element.hasAttribute('checked')))) await toggle.click();
  await expect(toggle).toHaveAttribute('checked', '');
  await manager.close();
}

async function openPanel(context: BrowserContext, origin: string): Promise<Page> {
  const page = await context.newPage();
  await expect(async () => {
    await page.goto(`${origin}/panel.html`, { timeout: 3000 });
  }).toPass({ timeout: 30_000, intervals: [100, 250, 500] });
  await expect(page.locator('#status')).toHaveText('Connected', { timeout: 30_000 });
  await expect(page.getByText('Counter: 0', { exact: true })).toBeVisible();
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action?.default_popup, 'panel.html');
  assert.equal(manifest.options_ui?.page, 'panel.html');
  return page;
}

async function callerIdentity(page: Page): Promise<string> {
  await page.locator('#identity').click();
  await expect(page.locator('#result')).toContainText('panel.html');
  return page.locator('#result').innerText();
}

async function checkModuleReplacement(first: Page, second: Page): Promise<void> {
  const timeOrigin = await first.evaluate(() => performance.timeOrigin);
  const provider = await first.locator('#provider').innerText();
  const caller = await callerIdentity(first);
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await first.locator('#wait').click();
  await second.locator('#executions').click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":0}');
  await appendFile(
    join(root, 'src/panel.ts'),
    '\ndocument.body.dataset.development = "updated";\n',
  );
  for (const page of [first, second]) {
    await expect(page.locator('body')).toHaveAttribute('data-development', 'updated', {
      timeout: 30_000,
    });
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText('Counter: 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Increase counter', exact: true })).toHaveCount(
      1,
    );
    assert.equal(await page.locator('#provider').innerText(), provider);
  }
  assert.equal(await first.evaluate(() => performance.timeOrigin), timeOrigin);
  assert.notEqual(await callerIdentity(first), caller);
  await first.locator('#routed').click();
  await expect(first.locator('#result')).toHaveText('2');
  await first.getByRole('button', { name: 'Increase counter', exact: true }).click();
  for (const page of [first, second])
    await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  await second.locator('#release').click();
  await second.locator('#executions').click();
  await expect(second.locator('#result')).toHaveText('{"started":1,"completed":1}');
  await setTimeout(500);
  await expect(first.locator('#result')).toHaveText('2');
}

async function checkHtmlReplacement(first: Page, second: Page): Promise<void> {
  const timeOrigin = await first.evaluate(() => performance.timeOrigin);
  const provider = await first.locator('#provider').innerText();
  const path = join(root, 'entrypoints/panel.html');
  const html = await readFile(path, 'utf8');
  await writeFile(path, html.replace('Native Port proof</h1>', 'Updated native Port proof</h1>'));
  for (const page of [first, second]) {
    await expect(page.getByRole('heading', { name: 'Updated native Port proof' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#status')).toHaveText('Connected');
    await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
    assert.equal(await page.locator('#provider').innerText(), provider);
  }
  assert.notEqual(await first.evaluate(() => performance.timeOrigin), timeOrigin);
}

async function checkBackgroundReplacement(
  first: Page,
  second: Page,
  origin: string,
): Promise<Page> {
  const provider = await first.locator('#provider').innerText();
  await first.locator('#wait').click();
  await second.locator('#executions').click();
  await expect(second.locator('#result')).toHaveText('{"started":2,"completed":1}');
  await appendFile(
    join(root, 'entrypoints/background.ts'),
    '\nconsole.info("Updated background");\n',
  );
  await expect.poll(() => first.isClosed(), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => second.isClosed(), { timeout: 30_000 }).toBe(true);
  const replacement = await openPanel(first.context(), origin);
  assert.notEqual(await replacement.locator('#provider').innerText(), provider);
  await replacement.locator('#executions').click();
  await expect(replacement.locator('#result')).toHaveText('{"started":0,"completed":0}');
  await replacement.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await expect(replacement.getByText('Counter: 1', { exact: true })).toBeVisible();
  return replacement;
}

async function checkConfigurationRestart(
  page: Page,
  origin: string,
  observerPort: number,
): Promise<Page> {
  assert.ok(browser);
  const previousBrowser = browser;
  const provider = await page.locator('#provider').innerText();
  await waitForSavedDeveloperMode();
  await updateDevelopmentVersion(root);
  await expect.poll(() => previousBrowser.isConnected(), { timeout: 30_000 }).toBe(false);
  browser = await connectObserver(observerPort);
  const context = browser.contexts()[0];
  assert.ok(context);
  context.on('weberror', (error) => errors.push(error.error().message));
  const manager = await context.newPage();
  await manager.goto('chrome://extensions');
  await expect(manager.locator('#devMode')).toHaveAttribute('checked', '');
  await manager.close();
  const replacement = await openPanel(context, origin);
  assert.equal(await replacement.evaluate(() => chrome.runtime.getManifest().version), '0.0.2');
  assert.notEqual(await replacement.locator('#provider').innerText(), provider);
  await replacement.getByRole('button', { name: 'Increase counter', exact: true }).click();
  await expect(replacement.getByText('Counter: 1', { exact: true })).toBeVisible();
  return replacement;
}

/** Wait for the platform's native store before restart; the live UI is checked again afterward. */
async function waitForSavedDeveloperMode(): Promise<void> {
  /** Linux does not enforce this preference; macOS and Windows protect it in a separate store. */
  const protectedPreferences = process.platform === 'darwin' || process.platform === 'win32';
  const filename = protectedPreferences ? 'Secure Preferences' : 'Preferences';
  const path = join(root, '.wxt/chromium-profile/Default', filename);
  await expect
    .poll(
      async () => {
        if (!existsSync(path)) return false;
        const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (typeof saved !== 'object' || saved === null || !('extensions' in saved)) return false;
        const { extensions } = saved;
        if (typeof extensions !== 'object' || extensions === null || !('ui' in extensions))
          return false;
        const { ui } = extensions;
        return (
          typeof ui === 'object' &&
          ui !== null &&
          'developer_mode' in ui &&
          ui.developer_mode === true
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}
