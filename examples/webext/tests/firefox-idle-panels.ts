import assert from 'node:assert/strict';
import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import {
  checkPeers,
  completeDiagnosticAction,
  increase,
  openPanel,
  readCaller,
  readProvider,
  readRecord,
  saved,
  waitText,
} from './firefox-restart-fixture.ts';

export async function prepareClients(driver: Driver, origin: string, storageKey: string) {
  const first = await openPanel(driver, origin, 0);
  assert.equal(
    await driver.executeScript('return chrome.runtime.id'),
    'devkit-native-port@example.invalid',
  );
  assert.equal(
    await driver.executeScript(
      'return chrome.runtime.getManifest().permissions.includes("storage")',
    ),
    true,
  );
  const provider = await readProvider(driver);
  const firstCaller = await readCaller(driver, origin);
  const second = await openPanel(driver, origin, 0);
  assert.deepEqual(await readProvider(driver), provider);
  const secondCaller = await readCaller(driver, origin);
  assert.notEqual(firstCaller.id, secondCaller.id);
  await driver.findElement(By.id('write')).click();
  await checkPeers(driver, [first.handle, second.handle], 10);
  await saved(driver, storageKey, 10);
  await driver.executeScript(
    'return chrome.storage.local.set({ [arguments[0]]: { value: 44 } })',
    `${storageKey}.independent`,
  );
  await completeDiagnosticAction(driver, first.handle, second.handle);
  const executions = await driver.findElement(By.id('result')).getText();
  await driver.switchTo().window(first.handle);
  await driver.executeScript(`
    const input = document.querySelector('#renderer').shadowRoot.querySelector('input');
    input.value = 'ephemeral.example.test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.equal((await snapshot(driver)).domain, 'ephemeral.example.test');
  return {
    provider,
    documents: [first, second],
    callers: [firstCaller, secondCaller],
    confirmedCounter: await readRecord(driver, storageKey),
    independentCounter: await readRecord(driver, `${storageKey}.independent`),
    executions,
  };
}

export async function checkDisconnected(
  driver: Driver,
  documents: readonly { handle: string; timeOrigin: number }[],
) {
  const disconnected = [];
  for (const document of documents) {
    await driver.switchTo().window(document.handle);
    await waitText(driver, '#status', 'Disconnected');
    const state = await snapshot(driver);
    assert.equal(state.counterMounts, 0);
    assert.equal(state.managementMounts, 0);
    assert.equal(state.timeOrigin, document.timeOrigin);
    disconnected.push({ handle: document.handle, ...state });
  }
  return disconnected;
}

export async function restoreClients(
  driver: Driver,
  origin: string,
  storageKey: string,
  previous: Awaited<ReturnType<typeof prepareClients>>,
) {
  const first = await openPanel(driver, origin, 10);
  const provider = await readProvider(driver);
  assert.equal(provider.id, previous.provider.id);
  assert.deepEqual(provider.realm, previous.provider.realm);
  assert.notEqual(provider.incarnation, previous.provider.incarnation);
  const firstCaller = await readCaller(driver, origin);
  const second = await openPanel(driver, origin, 10);
  assert.deepEqual(await readProvider(driver), provider);
  const secondCaller = await readCaller(driver, origin);
  assert.notEqual(firstCaller.id, secondCaller.id);
  for (const document of [first, second]) {
    assert.ok(
      !previous.documents.some(
        (prior) => prior.handle === document.handle || prior.timeOrigin === document.timeOrigin,
      ),
    );
    await driver.switchTo().window(document.handle);
    assert.equal((await snapshot(driver)).domain, 'shared.example.test');
  }
  assert.deepEqual(await readRecord(driver, storageKey), { value: 10 });
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":0,"completed":0}');
  await increase(driver);
  await checkPeers(driver, [first.handle, second.handle], 11);
  await saved(driver, storageKey, 11);
  assert.deepEqual(await readRecord(driver, `${storageKey}.independent`), { value: 44 });
  await driver.findElement(By.id('release')).click();
  await driver.findElement(By.id('executions')).click();
  await waitText(driver, '#result', '{"started":0,"completed":0}');
  return {
    provider,
    documents: [first, second],
    callers: [firstCaller, secondCaller],
    restored: 10,
    savedCounter: await readRecord(driver, storageKey),
    independentCounter: await readRecord(driver, `${storageKey}.independent`),
    executions: await driver.findElement(By.id('result')).getText(),
  };
}

interface PanelSnapshot {
  status: string;
  timeOrigin: number;
  counterMounts: number;
  managementMounts: number;
  domain: string;
}

export function snapshot(driver: Driver): Promise<PanelSnapshot> {
  return driver.executeScript<PanelSnapshot>(`
    const counter = document.querySelector('#renderer')?.shadowRoot;
    const management = document.querySelector('#management')?.shadowRoot;
    return {
      status: document.querySelector('#status').textContent, timeOrigin: performance.timeOrigin,
      counterMounts: counter?.querySelectorAll('.devframes-json-render-scroll-root').length ?? 0,
      managementMounts: management?.querySelectorAll('.devframes-json-render-scroll-root').length ?? 0,
      domain: counter?.querySelector('input')?.value ?? ''
    };
  `);
}
