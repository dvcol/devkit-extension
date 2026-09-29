import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import type { createNativeHost } from './host.ts';

type NativeHost = Awaited<ReturnType<typeof createNativeHost>>;

export async function createNativeBrowser(host: NativeHost) {
  await using cleanup = new AsyncDisposableStack();
  const profile = await mkdtemp(join(tmpdir(), 'devkit-cdb-browser-'));
  cleanup.defer(() => rm(profile, { recursive: true, force: true }));
  const extensionPath = resolve('dist/devframe');
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  cleanup.defer(() => browser.close());
  const errors: string[] = [];
  browser.on('weberror', (error) => errors.push(error.error().message));
  const target = await browser.newPage();
  await target.goto(host.fixtureUrl);
  const control = await createControl(browser, host);
  const lifetime = cleanup.move();
  return {
    target,
    control,
    version: browser.browser()?.version(),
    errors,
    close: () => lifetime.disposeAsync(),
  };
}

async function createControl(browser: BrowserContext, host: NativeHost): Promise<Page> {
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  const registration = new URL(`${host.baseURL}__connection.json`);
  registration.searchParams.set('devframe_viewer_origin', extensionOrigin);
  registration.searchParams.set('devframe_viewer_origin_token', host.allowedOrigins.token);
  host.allowedOrigins.registerFromUrl(registration.href);
  const control = await browser.newPage();
  await control.goto(`${extensionOrigin}/control.html`);
  return control;
}
