import { By } from 'selenium-webdriver';
import type { Driver } from 'selenium-webdriver/firefox.js';
import { readNativeEncodedResponse } from './response-encoding.ts';
import { finishNativeResponse, readNativeResponse, startNativeResponse } from './response-body.ts';
import { cancelNativeResponse } from './response-cancellation.ts';

export function createResponseBrowser(driver: Driver, extension: string, source: string) {
  async function control(operation: 'install' | 'disable' | 'enable' | 'dispose' | 'snapshot') {
    await driver.switchTo().window(extension);
    await driver.findElement(By.id(`response-${operation}`)).click();
    await driver.wait(
      async () => (await driver.findElement(By.id('result')).getText()) !== 'Pending',
      10_000,
    );
    const snapshot: unknown = JSON.parse(await driver.findElement(By.id('result')).getText());
    return snapshot;
  }
  async function read(path: string) {
    await driver.switchTo().window(source);
    return driver.executeScript(readNativeResponse, path);
  }
  async function start(path: string, expected: string, abortable = false) {
    await driver.switchTo().window(source);
    return driver.executeScript(startNativeResponse, path, expected, abortable);
  }
  return {
    control,
    read,
    start,
    startAbortable: (path: string, expected: string) => start(path, expected, true),
    readEncoded: async (path: string) => {
      await driver.switchTo().window(source);
      return driver.executeScript(readNativeEncodedResponse, path);
    },
    finish: async () => {
      await driver.switchTo().window(source);
      return driver.executeScript(finishNativeResponse);
    },
    cancel: async (mode: 'reader' | 'fetch') => {
      await driver.switchTo().window(source);
      return driver.executeScript(cancelNativeResponse, mode);
    },
    waitForCompleted: (completed: number) =>
      waitForSnapshot(driver, control, (snapshot) => snapshot.completed === completed),
    waitForError: () => waitForSnapshot(driver, control, (snapshot) => snapshot.errors.length > 0),
  };
}

function waitForSnapshot(
  driver: Driver,
  control: (operation: 'snapshot') => Promise<unknown>,
  matches: (snapshot: { completed: number; errors: readonly unknown[] }) => boolean,
) {
  return driver.wait(async () => {
    const snapshot = await control('snapshot');
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      !('completed' in snapshot) ||
      typeof snapshot.completed !== 'number' ||
      !('errors' in snapshot) ||
      !Array.isArray(snapshot.errors)
    )
      return false;
    if (!matches({ completed: snapshot.completed, errors: snapshot.errors })) return false;
    return snapshot;
  }, 10_000);
}
