import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import type { Browser } from '@wxt-dev/browser';
import {
  checkHeldSubresource,
  checkScriptStageSnapshot,
  readScriptStageSnapshot,
  scriptStageDocumentReady,
  startScriptStageServer,
} from './script-stages.ts';
import type {
  ScriptStageOptions,
  ScriptStageServer,
  ScriptStageSnapshot,
} from './script-stages.ts';
import {
  checkTimingInstallation,
  checkTimingRegistration,
  readTimingRegistration,
} from './script-timing.ts';

interface StagePages {
  readonly extension: string;
  readonly source: string;
  readonly fixture: ScriptStageServer;
}

export async function checkFirefoxScriptStages(driver: Driver, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startScriptStageServer();
  cleanup.defer(() => fixture.close());
  const extension = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(extension);
  });
  const pages = { extension, source, fixture };
  const observations = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    for (const runAt of ['document_start', 'document_end', 'document_idle'] as const) {
      observations.push(await checkRegistration(driver, pages, { world, runAt }));
      checks.push(`${world}: native ${runAt} timing, world visibility and disposal`);
      if (runAt !== 'document_start')
        checks.push(
          `${world}: ${runAt} disable preserves existing effects; enable injects fresh documents`,
        );
    }
  }
  await selectStage(driver, pages, 'document_start');
  await writeFile(
    `${artifactDirectory}/script-stages.json`,
    JSON.stringify(
      {
        browser: (await driver.getCapabilities()).getBrowserVersion(),
        observations,
        checks,
      },
      null,
      2,
    ),
  );
}

async function checkRegistration(driver: Driver, pages: StagePages, options: ScriptStageOptions) {
  const { world, runAt } = options;
  await selectStage(driver, pages, runAt);
  const installed = await control(driver, pages, {
    identifier: `script-${world.toLowerCase()}`,
    status: 'ready',
    generation: 1,
  });
  let initial;
  let lifecycle;
  let disposal;
  try {
    checkTimingRegistration(installed.registrations, world, { runAt });
    initial = await observeDocument(driver, pages, options);
    if (runAt !== 'document_start') lifecycle = await checkLifecycle(driver, pages, options);
  } finally {
    disposal = await control(driver, pages, { identifier: 'script-dispose', status: 'disposed' });
    assert.deepEqual(disposal.registrations, []);
  }
  await driver.switchTo().window(pages.source);
  const retained = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
  checkScriptStageSnapshot(retained, options);
  const disposed = await observeDocument(driver, pages, { ...options, active: false });
  return { ...options, installed, initial, lifecycle, disposal, retained, disposed };
}

async function observeDocument(driver: Driver, pages: StagePages, options: ScriptStageOptions) {
  const { fixture } = pages;
  fixture.hold();
  try {
    await navigate(driver, pages);
    if (options.active !== false && options.runAt !== 'document_idle')
      await waitForInjection(driver);
    const held = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
    checkHeldSubresource(held);
    if (options.active !== false && options.runAt !== 'document_idle')
      checkScriptStageSnapshot(held, options);
    fixture.release();
    await driver.wait(async () => {
      const snapshot = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
      return (
        snapshot.windowLoaded && (options.active === false || snapshot.injectedReadyState !== null)
      );
    }, 10_000);
    const complete = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
    checkScriptStageSnapshot(complete, options);
    assert.equal(complete.windowLoaded, true);
    assert.equal(complete.imageComplete, true);
    return { held, complete };
  } finally {
    fixture.release();
  }
}

async function navigate(driver: Driver, pages: StagePages): Promise<void> {
  await driver.switchTo().window(pages.source);
  /** Location assignment permits inspection before load without changing the driver's native strategy. */
  await driver.executeScript((url: string) => {
    document.documentElement.dataset.stageNavigating = 'true';
    location.href = url;
  }, pages.fixture.url);
  await driver.wait(
    async () => (await driver.executeScript<boolean | null>(scriptStageDocumentReady)) === true,
    10_000,
  );
}

async function waitForInjection(driver: Driver): Promise<void> {
  await driver.wait(async () => {
    const snapshot = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
    return snapshot.injectedReadyState !== null;
  }, 10_000);
}

async function checkLifecycle(driver: Driver, pages: StagePages, options: ScriptStageOptions) {
  const disabled = await control(driver, pages, {
    identifier: 'script-disable',
    status: 'disabled',
    generation: 1,
  });
  assert.deepEqual(disabled.registrations, []);
  await driver.switchTo().window(pages.source);
  const retained = await driver.executeScript<ScriptStageSnapshot>(readScriptStageSnapshot);
  checkScriptStageSnapshot(retained, options);
  const inactive = await observeDocument(driver, pages, { ...options, active: false });
  const enabled = await control(driver, pages, {
    identifier: 'script-enable',
    status: 'ready',
    generation: 2,
  });
  checkTimingRegistration(enabled.registrations, options.world, { runAt: options.runAt });
  const restored = await observeDocument(driver, pages, options);
  return { disabled, retained, inactive, enabled, restored };
}

async function selectStage(driver: Driver, pages: StagePages, runAt: chrome.extensionTypes.RunAt) {
  await driver.switchTo().window(pages.extension);
  await driver.findElement(By.css(`#script-run-at option[value="${runAt}"]`)).click();
}

async function control(
  driver: Driver,
  pages: StagePages,
  options: {
    identifier: string;
    status: string;
    generation?: number;
  },
) {
  await driver.switchTo().window(pages.extension);
  await driver.findElement(By.id(options.identifier)).click();
  const output = driver.findElement(By.id('result'));
  await driver.wait(async () => (await output.getText()) !== 'Pending', 10_000);
  const snapshot: unknown = JSON.parse(await output.getText());
  checkTimingInstallation(snapshot, options.status, options.generation);
  const registrations =
    await driver.executeScript<Browser.scripting.RegisteredContentScript[]>(readTimingRegistration);
  return { snapshot, registrations };
}
