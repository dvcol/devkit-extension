import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Observe the actual toolbar popup through its native options-page peer during native module and HTML updates. */
export async function checkChromiumPopupDevelopment(page: Page, fixture: string): Promise<void> {
  await page.evaluate(() => chrome.action.openPopup());
  try {
    await expect.poll(() => popupText(page, '#status')).toBe('Connected');
    const before = await snapshot(page);
    const previousCaller = await identity(page);
    await page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: 'popup' })[0]!;
      popup.document.querySelector<HTMLInputElement>('#server-id')!.value = 'popup-hmr-form';
      popup.document.querySelector<HTMLButtonElement>('#wait')!.click();
    });
    await executions(page, '{"started":1,"completed":0}');
    await updateModule(page, fixture);
    await expect.poll(() => popupText(page, '#status')).toBe('Connected');
    const after = await snapshot(page);
    assert.equal(after.timeOrigin, before.timeOrigin);
    assert.equal(after.provider, before.provider);
    assert.equal(after.counter, before.counter);
    assert.equal(after.form, 'popup-hmr-form');
    assert.equal(after.buttons, 1);
    const caller = await identity(page);
    assert.notEqual(caller, previousCaller);
    await page.evaluate(() => {
      chrome.extension
        .getViews({ type: 'popup' })[0]!
        .document.querySelector('#renderer')!
        .shadowRoot!.querySelector('button')!
        .click();
    });
    await expect(page.getByText('Counter: 2', { exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).counter).toBe('2');
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('#release')!.click();
    });
    await executions(page, '{"started":1,"completed":1}');
    assert.equal(await popupText(page, '#result'), caller);
    await checkHtmlReload(page, fixture);
  } finally {
    await page.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0]?.close());
    await expect
      .poll(() => page.evaluate(() => chrome.extension.getViews({ type: 'popup' }).length))
      .toBe(0);
  }
}

async function checkHtmlReload(page: Page, fixture: string): Promise<void> {
  const before = await snapshot(page);
  const previousCaller = await identity(page);
  const path = join(fixture, 'entrypoints/panel.html');
  const html = await readFile(path, 'utf8');
  const heading = 'Popup native HTML reload';
  const updated = html.replace(/<h1>[^<]+<\/h1>/u, `<h1>${heading}</h1>`);
  assert.notEqual(updated, html);
  await writeFile(path, updated);
  await expect.poll(() => popupText(page, 'h1'), { timeout: 30_000 }).toBe(heading);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect.poll(() => popupText(page, '#status')).toBe('Connected');
  const after = await snapshot(page);
  assert.notEqual(after.timeOrigin, before.timeOrigin);
  assert.equal(after.provider, before.provider);
  assert.equal(after.counter, before.counter);
  assert.equal(after.form, '');
  assert.equal(after.buttons, 1);
  assert.notEqual(await identity(page), previousCaller);
  await page.evaluate(() => {
    chrome.extension
      .getViews({ type: 'popup' })[0]!
      .document.querySelector('#renderer')!
      .shadowRoot!.querySelector('button')!
      .click();
  });
  await expect(page.getByText('Counter: 3', { exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).counter).toBe('3');
}

async function updateModule(page: Page, fixture: string): Promise<void> {
  const marker = crypto.randomUUID();
  await appendFile(
    join(fixture, 'src/panel.ts'),
    `\ndocument.body.dataset.popupDevelopment = ${JSON.stringify(marker)};\n`,
  );
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [window, ...chrome.extension.getViews({ type: 'popup' })].map(
            (view) => view.document.body.dataset.popupDevelopment,
          ),
        ),
      { timeout: 30_000 },
    )
    .toEqual([marker, marker]);
}

function snapshot(page: Page) {
  return page.evaluate(() => {
    const popup = chrome.extension.getViews({ type: 'popup' })[0]!;
    const renderer = popup.document.querySelector('#renderer')!.shadowRoot!;
    return {
      timeOrigin: popup.performance.timeOrigin,
      provider: popup.document.querySelector('#provider')!.textContent,
      form: popup.document.querySelector<HTMLInputElement>('#server-id')!.value,
      counter: renderer
        .querySelector('.devframes-json-render-scroll-root')!
        .textContent.match(/Counter:\s*(\d+)/u)?.[1],
      buttons: renderer.querySelectorAll('button').length,
    };
  });
}

function popupText(page: Page, selector: string) {
  return page.evaluate(
    (value) =>
      chrome.extension.getViews({ type: 'popup' })[0]?.document.querySelector(value)?.textContent,
    selector,
  );
}

async function identity(page: Page): Promise<string> {
  await page.evaluate(() => {
    chrome.extension
      .getViews({ type: 'popup' })[0]!
      .document.querySelector<HTMLButtonElement>('#identity')!
      .click();
  });
  await expect.poll(() => popupText(page, '#result')).toContain('panel.html');
  const caller = await popupText(page, '#result');
  assert.ok(typeof caller === 'string');
  return caller;
}

async function executions(page: Page, expected: string): Promise<void> {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#executions')!.click();
  });
  await expect(page.locator('#result')).toHaveText(expected);
}
