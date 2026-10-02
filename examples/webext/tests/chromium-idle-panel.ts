import assert from 'node:assert/strict';
import type { ProviderDescriptor } from '@devkit/core';
import { evaluate, readNumber, readObject, readString, waitFor } from './chromium-idle-cdp.ts';
import type { BrowserConnection } from './chromium-idle-cdp.ts';

export interface Panel {
  targetId: string;
  sessionId: string;
}
const rendererRoot =
  '(document.querySelector("#renderer")?.shadowRoot ?? document.querySelector("#renderer"))';
const managementRoot =
  '(document.querySelector("#management")?.shadowRoot ?? document.querySelector("#management"))';

export async function createPage(control: BrowserConnection, url: string): Promise<Panel> {
  const target = readObject(await control.command('Target.createTarget', { url: 'about:blank' }));
  const targetId = readString(target.targetId);
  const session = readObject(
    await control.command('Target.attachToTarget', { targetId, flatten: true }),
  );
  const sessionId = readString(session.sessionId);
  await control.command('Runtime.enable', {}, sessionId);
  const navigation = readObject(await control.command('Page.navigate', { url }, sessionId));
  assert.equal(
    navigation.errorText,
    undefined,
    `Native navigation to ${url}: ${JSON.stringify(navigation)}`,
  );
  return { targetId, sessionId };
}

export async function openPanel(
  control: BrowserConnection,
  url: string,
  value: number,
): Promise<Panel> {
  const panel = await createPage(control, url);
  await checkClients(control, [panel], value);
  assert.deepEqual(
    await evaluate(
      control,
      panel.sessionId,
      '({ id:chrome.runtime.id, name:chrome.runtime.getManifest().name, storage:chrome.runtime.getManifest().permissions.includes("storage") })',
    ),
    { id: new URL(url).host, name: 'Devkit native Port example', storage: true },
  );
  return panel;
}

export async function snapshot(control: BrowserConnection, panel: Panel) {
  const value = readObject(
    await evaluate(
      control,
      panel.sessionId,
      `({ status: document.querySelector('#status')?.textContent, catalog: document.querySelector('#catalog')?.textContent, provider: document.querySelector('#provider')?.textContent, counter: ${rendererRoot}?.querySelector('.devframes-json-render-scroll-root')?.innerText, counterMounts: ${rendererRoot}?.querySelectorAll('.devframes-json-render-scroll-root').length, managementMounts: ${managementRoot}?.querySelectorAll('.devframes-json-render-scroll-root').length, result: document.querySelector('#result')?.textContent, timeOrigin: performance.timeOrigin, domain: ${rendererRoot}?.querySelector('input')?.value })`,
    ),
  );
  return {
    status: readString(value.status ?? ''),
    catalog: readString(value.catalog ?? ''),
    provider: readString(value.provider ?? ''),
    counter: readString(value.counter ?? ''),
    counterMounts: readNumber(value.counterMounts ?? 0),
    managementMounts: readNumber(value.managementMounts ?? 0),
    result: readString(value.result ?? ''),
    timeOrigin: readNumber(value.timeOrigin),
    domain: readString(value.domain ?? ''),
  };
}

export async function checkClients(
  control: BrowserConnection,
  panels: readonly Panel[],
  value: number,
): Promise<void> {
  for (const panel of panels)
    await waitFor(async () => {
      const state = await snapshot(control, panel);
      return (
        state.status === 'Connected' &&
        state.catalog === 'active' &&
        new RegExp(`Counter: ${value}\\b`, 'u').test(state.counter) &&
        state.counterMounts === 1 &&
        state.managementMounts === 1
      );
    }, `one counter/management mount with saved value ${value}`).catch(async (error: unknown) => {
      throw new Error(
        `Panel did not become ready: ${JSON.stringify(await snapshot(control, panel))}; ${JSON.stringify(await evaluate(control, panel.sessionId, '({url:location.href,title:document.title,text:document.body?.innerText.slice(0,200)})'))}`,
        { cause: error },
      );
    });
}

export async function readProvider(
  control: BrowserConnection,
  panel: Panel,
): Promise<ProviderDescriptor> {
  const value: unknown = JSON.parse((await snapshot(control, panel)).provider);
  const provider = readObject(value);
  return {
    id: readString(provider.id),
    incarnation: readString(provider.incarnation),
    realm: { id: readString(readObject(provider.realm).id) },
  };
}

export function click(control: BrowserConnection, panel: Panel, selector: string) {
  return evaluate(
    control,
    panel.sessionId,
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
}

export function record(control: BrowserConnection, panel: Panel, key: string): Promise<unknown> {
  return evaluate(
    control,
    panel.sessionId,
    `chrome.storage.local.get(${JSON.stringify(key)}).then(record => record[${JSON.stringify(key)}])`,
  );
}

export function saved(
  control: BrowserConnection,
  panel: Panel,
  key: string,
  value: number,
): Promise<void> {
  return waitFor(
    async () => JSON.stringify(await record(control, panel, key)) === JSON.stringify({ value }),
    'confirmed native saved counter',
  );
}

export async function readCaller(control: BrowserConnection, panel: Panel) {
  await click(control, panel, '#identity');
  await waitFor(
    async () => (await snapshot(control, panel)).result.startsWith('{'),
    'native caller identity',
  );
  const value: unknown = JSON.parse((await snapshot(control, panel)).result);
  const identity = readObject(value);
  return { id: readNumber(identity.id), url: readString(identity.url) };
}

export async function prepareCounter(
  control: BrowserConnection,
  panels: readonly Panel[],
  key: string,
): Promise<void> {
  await click(control, panels[0]!, '#write');
  await checkClients(control, panels, 10);
  await saved(control, panels[0]!, key, 10);
  await evaluate(
    control,
    panels[0]!.sessionId,
    `chrome.storage.local.set({ [${JSON.stringify(`${key}.independent`)}]: { value: 44 } })`,
  );
  await click(control, panels[0]!, '#wait');
  await click(control, panels[1]!, '#executions');
  await waitFor(
    async () => (await snapshot(control, panels[1]!)).result === '{"started":1,"completed":0}',
    'one pending diagnostic action',
  );
  await click(control, panels[1]!, '#release');
  await click(control, panels[1]!, '#executions');
  await waitFor(
    async () => (await snapshot(control, panels[1]!)).result === '{"started":1,"completed":1}',
    'one completed diagnostic action before idle',
  );
  await evaluate(
    control,
    panels[0]!.sessionId,
    `${rendererRoot}.querySelector('input').value = 'ephemeral.example.test'; ${rendererRoot}.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }))`,
  );
  await waitFor(
    async () => (await snapshot(control, panels[0]!)).domain === 'ephemeral.example.test',
    'the ephemeral domain',
  );
}

export async function checkRecoveredCounter(
  control: BrowserConnection,
  panels: readonly Panel[],
  key: string,
): Promise<void> {
  await click(control, panels[0]!, '#executions');
  await waitFor(
    async () => (await snapshot(control, panels[0]!)).result === '{"started":0,"completed":0}',
    'discarded diagnostic execution state',
  );
  await evaluate(control, panels[0]!.sessionId, `${rendererRoot}.querySelector('button').click()`);
  await checkClients(control, panels, 11);
  await saved(control, panels[0]!, key, 11);
  assert.deepEqual(await record(control, panels[1]!, `${key}.independent`), { value: 44 });
  await click(control, panels[0]!, '#release');
  await click(control, panels[0]!, '#executions');
  await waitFor(
    async () => (await snapshot(control, panels[0]!)).result === '{"started":0,"completed":0}',
    'no replay of completed work',
  );
}
