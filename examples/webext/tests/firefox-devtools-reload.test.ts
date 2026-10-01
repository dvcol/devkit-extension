import { Session, error } from 'selenium-webdriver';
import { Driver } from 'selenium-webdriver/firefox.js';
import type { Executor } from 'selenium-webdriver/lib/command.js';
import { expect, it, vi } from 'vitest';
import { panelReloaded } from './firefox-devtools-development.ts';
import { panelScript } from './firefox-devtools.ts';

const destroyedActor =
  "AbortError: Actor 'MarionetteCommands' destroyed before query 'MarionetteCommandsParent:executeScript' was resolved";

/** Replay real actor responses at the driver I/O boundary, preserving Selenium's bounded wait. */
function createDriver() {
  const execute = vi.fn<Executor['execute']>();
  const driver = new Driver(new Session('reload-fixture', {}), { execute });
  return { driver, execute };
}

it('keeps observing a replacement document after the previous actor was destroyed', async () => {
  expect.assertions(2);
  const { driver, execute } = createDriver();
  execute
    .mockResolvedValueOnce({ error: destroyedActor })
    .mockResolvedValueOnce({ value: false })
    .mockResolvedValueOnce({ value: true });
  await expect(
    driver.wait(() => panelReloaded(driver, 'fixture'), 1000, undefined, 0),
  ).resolves.toBe(true);
  expect(execute).toHaveBeenCalledTimes(3);
});

it('still times out when no replacement document becomes observable', async () => {
  expect.assertions(2);
  const { driver, execute } = createDriver();
  execute.mockResolvedValue({ error: destroyedActor });
  await expect(
    driver.wait(() => panelReloaded(driver, 'fixture'), 5, undefined, 0),
  ).rejects.toThrow(error.TimeoutError);
  expect(execute).toHaveBeenCalled();
});

it('preserves unrelated script errors without retrying the read', async () => {
  expect.assertions(2);
  const { driver, execute } = createDriver();
  const scriptError = 'TypeError: document.querySelector(...) is null';
  execute.mockResolvedValue({ error: scriptError });
  await expect(panelReloaded(driver, 'fixture')).rejects.toMatchObject({ actual: scriptError });
  expect(execute).toHaveBeenCalledTimes(1);
});

it('preserves driver transport failures without retrying the read', async () => {
  expect.assertions(2);
  const { driver, execute } = createDriver();
  const transportError = new Error('The Firefox connection closed');
  execute.mockRejectedValue(transportError);
  await expect(panelReloaded(driver, 'fixture')).rejects.toBe(transportError);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('never retries an effectful panel script after actor destruction', async () => {
  expect.assertions(2);
  const { driver, execute } = createDriver();
  execute.mockResolvedValue({ error: destroyedActor });
  await expect(
    panelScript(driver, "document.querySelector('#routed').click(); return true;"),
  ).rejects.toMatchObject({ actual: destroyedActor });
  expect(execute).toHaveBeenCalledTimes(1);
});
