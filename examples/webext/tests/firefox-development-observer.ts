import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';

/** Attach an observer to Firefox owned by WXT; never launch or install a second extension. */
export async function attachFirefox(marionettePort: number): Promise<{
  driver: Driver;
  origin: string;
  browserVersion: string;
  dispose: () => Promise<void>;
}> {
  const service = new ServiceBuilder(process.env.GECKODRIVER_BINARY)
    .addArguments(
      '--connect-existing',
      '--marionette-port',
      String(marionettePort),
      '--allow-system-access',
    )
    .setStdio('inherit')
    .build();
  try {
    const driver = Driver.createSession(new Options().setPageLoadStrategy('none'), service);
    const capabilities = await driver.getCapabilities();
    const browserVersion = capabilities.getBrowserVersion();
    assert.ok(typeof browserVersion === 'string');
    const profile: unknown = capabilities.get('moz:profile');
    const processId: unknown = capabilities.get('moz:processID');
    assert.ok(typeof profile === 'string');
    assert.ok(typeof processId === 'number');
    const extensionUuid = await readExtensionUuid(profile);
    await driver.manage().setTimeouts({ pageLoad: 15_000, script: 10_000 });
    return {
      driver,
      origin: `moz-extension://${extensionUuid}`,
      browserVersion,
      dispose: () => disposeObserver(processId, service),
    };
  } catch (error) {
    await service.kill();
    throw error;
  }
}

async function disposeObserver(
  processId: number,
  service: ReturnType<ServiceBuilder['build']>,
): Promise<void> {
  try {
    await waitForFirefoxExit(processId);
  } finally {
    await service.kill();
  }
}

async function readExtensionUuid(profile: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const preferences = await readFile(`${profile}/prefs.js`, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    });
    const prefix = 'user_pref("extensions.webextensions.uuids", ';
    const line = preferences.split('\n').find((candidate) => candidate.startsWith(prefix));
    if (line !== undefined) {
      const serialized: unknown = JSON.parse(line.slice(prefix.length, -2));
      assert.ok(typeof serialized === 'string');
      const identities: unknown = JSON.parse(serialized);
      assert.ok(identities !== null && typeof identities === 'object');
      const identity: unknown = Object.getOwnPropertyDescriptor(
        identities,
        'devkit-native-port@example.invalid',
      )?.value;
      if (typeof identity === 'string') return identity;
    }
    await setTimeout(100);
  }
  throw new Error('Firefox did not persist the native development extension UUID');
}

async function waitForFirefoxExit(processId: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
      throw error;
    }
    await setTimeout(100);
  }
  throw new Error(`Native WXT stop did not close its Firefox process ${processId}`);
}
