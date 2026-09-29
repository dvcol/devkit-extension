import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { counterCapability } from '@devkit/example-contribution';
import { createRemoteHost } from '@devkit/example-server-contexts';
import { By, until } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { Select } from 'selenium-webdriver/lib/select.js';
import { createServer } from 'vite';

export async function checkFirefoxSelectedPage(driver: Driver): Promise<void> {
  await using cleanup = new AsyncDisposableStack();
  const extension = await driver.getWindowHandle();
  const host = await createRemoteHost('devframe', {
    providerId: 'example.page',
    allowedOrigins: [await driver.executeScript<string>('return location.origin')],
  });
  cleanup.defer(host.close);
  const publisher = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./publisher/', import.meta.url)),
    define: { PUBLISHER_AUTH_TOKEN: JSON.stringify(host.token) },
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: { '/__devkit-remote/': { target: host.origin, ws: true } },
    },
  });
  cleanup.defer(() => publisher.close());
  await publisher.listen();
  const url = publisher.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('Missing publisher URL');
  await driver.switchTo().newWindow('tab');
  const source = await driver.getWindowHandle();
  cleanup.defer(() => closeSource(driver, source, extension));
  await checkMissingConnection(driver, { extension, source, url });
  await checkPublishedConnection(driver, { extension, source, url });
  const resolution = await host.provider.resolve({ capability: counterCapability });
  if (resolution.status !== 'available') throw new Error('Page provider counter is unavailable');
  assert.equal(await resolution.binding.api.read({}), 2);
  await checkDeniedPage(driver);
}

interface SelectedPage {
  readonly extension: string;
  readonly source: string;
  readonly url: string;
}

async function checkPublishedConnection(driver: Driver, page: SelectedPage): Promise<void> {
  await driver.switchTo().window(page.source);
  await driver.get(page.url);
  await waitText(driver, '#status', 'Ready');
  await driver.switchTo().window(page.extension);
  await selectPage(driver, page.url);
  await fill(driver, '#server-id', 'example.page');
  await click(driver, '#connect-page');
  await waitText(driver, '#server-result', '"Connected example.page"');
  await fill(driver, '#preferred-server', 'example.page');
  await click(driver, '#fallback-increase');
  await waitText(driver, '#server-result', '1');
  await closeSource(driver, page.source, page.extension);
  await click(driver, '#connect-page');
  await waitMatching(driver, '#page-result', /No tab with id|Invalid tab ID/iu);
  await click(driver, '#fallback-increase');
  await waitText(driver, '#server-result', '2');
}

async function checkMissingConnection(driver: Driver, page: SelectedPage): Promise<void> {
  for (const mode of ['absent', 'malformed']) {
    const selectedUrl = `${page.url}?mode=${mode}`;
    await driver.switchTo().window(page.source);
    await driver.get(selectedUrl);
    await waitText(driver, '#status', 'Ready');
    await driver.switchTo().window(page.extension);
    await selectPage(driver, selectedUrl);
    await click(driver, '#connect-page');
    await waitMatching(driver, '#page-result', /no published|malformed/iu);
    assert.doesNotMatch(await driver.findElement(By.css('#providers')).getText(), /example\.page/u);
  }
}

async function selectPage(driver: Driver, url: string): Promise<void> {
  await click(driver, '#refresh-pages');
  const selection = new Select(await driver.findElement(By.css('#local-pages')));
  await driver.wait(async () => {
    const options = await Promise.all(
      (await selection.getOptions()).map((option) => option.getText()),
    );
    return options.filter((option) => option === url).length === 1;
  }, 10_000);
  await selection.selectByVisibleText(url);
}

async function closeSource(driver: Driver, source: string, extension: string): Promise<void> {
  if ((await driver.getAllWindowHandles()).includes(source)) {
    await driver.switchTo().window(source);
    await driver.close();
  }
  await driver.switchTo().window(extension);
}

async function checkDeniedPage(driver: Driver): Promise<void> {
  const tabId = await driver.executeScript<number>(async () => {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    if (tab.id === undefined) throw new Error('Missing denied tab ID');
    document
      .querySelector<HTMLSelectElement>('#local-pages')!
      .add(new Option('Denied page', String(tab.id)));
    return tab.id;
  });
  try {
    const selection = new Select(await driver.findElement(By.css('#local-pages')));
    await selection.selectByValue(String(tabId));
    await click(driver, '#connect-page');
    await waitMatching(driver, '#page-result', /Cannot access|permission/iu);
  } finally {
    await driver.executeScript((id: number) => chrome.tabs.remove(id), tabId);
  }
}

async function click(driver: Driver, selector: string): Promise<void> {
  await driver.findElement(By.css(selector)).click();
}

async function fill(driver: Driver, selector: string, value: string): Promise<void> {
  const input = await driver.findElement(By.css(selector));
  await input.clear();
  await input.sendKeys(value);
}

async function waitText(driver: Driver, selector: string, expected: string): Promise<void> {
  await driver.wait(until.elementTextIs(driver.findElement(By.css(selector)), expected), 10_000);
}

async function waitMatching(driver: Driver, selector: string, expected: RegExp): Promise<void> {
  await driver.wait(
    async () => expected.test(await driver.findElement(By.css(selector)).getText()),
    10_000,
  );
}
