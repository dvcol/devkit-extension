import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import type { Browser } from '@wxt-dev/browser';
import {
  checkScriptContexts,
  readOptionalHostPermission,
  readScriptContextSnapshot,
  scriptContextReady,
  startScriptContextServer,
} from './script-contexts.ts';
import type {
  ScriptContextOptions,
  ScriptContextServer,
  ScriptContextSnapshot,
} from './script-contexts.ts';
import {
  checkTimingInstallation,
  checkTimingRegistration,
  readTimingRegistration,
} from './script-timing.ts';

interface ContextPages {
  readonly extension: string;
  readonly source: string;
}

interface ContextRegistration extends Pick<ScriptContextOptions, 'world' | 'allFrames'> {
  readonly pages: ContextPages;
  readonly fixture: ScriptContextServer;
}

export async function checkFirefoxScriptContexts(driver: Driver, artifactDirectory: string) {
  await using cleanup = new AsyncDisposableStack();
  const fixture = await startScriptContextServer();
  cleanup.defer(() => fixture.close());
  const extension = await driver.getWindowHandle();
  const optionalHostBefore = await driver.executeScript<boolean>(readOptionalHostPermission);
  assert.equal(optionalHostBefore, false);
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  const pages = { extension, source };
  cleanup.defer(async () => {
    await driver.switchTo().window(source);
    await driver.close();
    await driver.switchTo().window(extension);
  });
  const observations = [];
  const checks = [];
  for (const world of ['MAIN', 'ISOLATED'] as const) {
    for (const allFrames of [false, true]) {
      const result = await checkRegistration(driver, { pages, fixture, world, allFrames });
      observations.push(...result.observations);
      checks.push(...result.checks);
    }
  }
  await driver.switchTo().window(extension);
  await driver.findElement(By.id('script-all-frames')).click();
  const optionalHostAfter = await driver.executeScript<boolean>(readOptionalHostPermission);
  assert.equal(optionalHostAfter, false);
  await writeFile(
    `${artifactDirectory}/script-contexts.json`,
    JSON.stringify(
      {
        browser: (await driver.getCapabilities()).getBrowserVersion(),
        optionalHostPermissions: { before: optionalHostBefore, after: optionalHostAfter },
        observations,
        checks,
      },
      null,
      2,
    ),
  );
}

async function checkRegistration(driver: Driver, options: ContextRegistration) {
  const { pages, fixture, world, allFrames } = options;
  const observations = [];
  const checks = [];
  let disposal: Awaited<ReturnType<typeof control>> | undefined;
  await driver.switchTo().window(pages.extension);
  const checkbox = driver.findElement(By.id('script-all-frames'));
  if ((await checkbox.isSelected()) !== allFrames) await checkbox.click();
  const installed = await control(driver, pages, `script-${world.toLowerCase()}`, 'ready', 1);
  try {
    checkTimingRegistration(installed.registrations, world, { allFrames });
    for (const strictCsp of [false, true]) {
      fixture.setStrictCsp(strictCsp);
      await driver.switchTo().window(pages.source);
      await driver.get(fixture.url);
      const current = { world, allFrames, strictCsp, active: true };
      observations.push({ ...current, installed, snapshots: await readFrames(driver, current) });
      checks.push(
        `${world}: allFrames=${allFrames} strictCsp=${strictCsp} native frame matching and host permissions`,
      );
    }
    if (allFrames) {
      observations.push(await checkLifecycle(driver, pages, world));
      checks.push(`${world}: native child-frame registration disable and enable under page CSP`);
    }
  } finally {
    disposal = await control(driver, pages, 'script-dispose', 'disposed');
    assert.deepEqual(disposal.registrations, []);
  }
  await driver.switchTo().window(pages.source);
  await driver.navigate().refresh();
  const disposed = { world, allFrames, strictCsp: true, active: false };
  observations.push({
    ...disposed,
    stage: 'disposed',
    disposal,
    snapshots: await readFrames(driver, disposed),
  });
  checks.push(
    `${world}: allFrames=${allFrames} disposed registration leaves fresh documents uninjected`,
  );
  return { observations, checks };
}

async function readFrames(driver: Driver, options: ScriptContextOptions) {
  const snapshots: ScriptContextSnapshot[] = [];
  await driver.switchTo().defaultContent();
  for (const name of [undefined, 'same', 'cross', 'denied']) {
    if (name !== undefined) await driver.switchTo().frame(await driver.findElement(By.name(name)));
    await driver.wait(
      () => driver.executeScript<boolean>(scriptContextReady, options.strictCsp),
      10_000,
    );
    snapshots.push(await driver.executeScript<ScriptContextSnapshot>(readScriptContextSnapshot));
    await driver.switchTo().defaultContent();
  }
  checkScriptContexts(snapshots, options);
  return snapshots;
}

function registrations(driver: Driver) {
  return driver.executeScript<Browser.scripting.RegisteredContentScript[]>(readTimingRegistration);
}

async function control(
  driver: Driver,
  pages: ContextPages,
  identifier: string,
  status: string,
  generation?: number,
) {
  await driver.switchTo().window(pages.extension);
  await driver.findElement(By.id(identifier)).click();
  const output = driver.findElement(By.id('result'));
  await driver.wait(async () => (await output.getText()) !== 'Pending', 10_000);
  const snapshot: unknown = JSON.parse(await output.getText());
  checkTimingInstallation(snapshot, status, generation);
  return { snapshot, registrations: await registrations(driver) };
}

async function checkLifecycle(
  driver: Driver,
  pages: ContextPages,
  world: `${chrome.scripting.ExecutionWorld}`,
) {
  const options = { world, allFrames: true, strictCsp: true, active: true };
  const disabled = await control(driver, pages, 'script-disable', 'disabled', 1);
  assert.deepEqual(disabled.registrations, []);
  await driver.switchTo().window(pages.source);
  const retained = await readFrames(driver, options);
  await driver.navigate().refresh();
  const inactive = await readFrames(driver, { ...options, active: false });
  const enabled = await control(driver, pages, 'script-enable', 'ready', 2);
  checkTimingRegistration(enabled.registrations, world, { allFrames: true });
  await driver.switchTo().window(pages.source);
  await driver.navigate().refresh();
  const restored = await readFrames(driver, options);
  return { world, stage: 'lifecycle', disabled, retained, inactive, enabled, restored };
}
