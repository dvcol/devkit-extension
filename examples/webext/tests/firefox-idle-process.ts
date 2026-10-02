import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';

export async function startSession(
  extensionUuid: string,
  nativePreferences: Readonly<Record<string, string | number | boolean>> = {},
) {
  const profile = await mkdtemp(join(tmpdir(), 'firefox-native-idle-'));
  const options = new Options().addArguments('-headless', '-profile', profile).setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({
      'devkit-native-port@example.invalid': extensionUuid,
    }),
  );
  for (const [preferenceName, value] of Object.entries(nativePreferences))
    options.setPreference(preferenceName, value);
  if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
  const service = new ServiceBuilder()
    .addArguments(
      '--allow-system-access',
      '--marionette-port',
      String(await availablePort()),
      '--log',
      'warn',
    )
    .setStdio('inherit')
    .build();
  const driver = Driver.createSession(options, service);
  try {
    const capabilities = await driver.getCapabilities();
    const processId: unknown = capabilities.get('moz:processID');
    assert.ok(typeof processId === 'number' && Number.isSafeInteger(processId));
    assert.equal(capabilities.get('moz:profile'), profile);
    await driver.manage().setTimeouts({ script: 130_000, pageLoad: 30_000 });
    return {
      driver,
      browser: capabilities.getBrowserVersion(),
      processId,
      profile,
      sessionId: (await driver.getSession()).getId(),
    };
  } catch (error) {
    await driver.quit();
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

export async function closeSession(
  session: Awaited<ReturnType<typeof startSession>>,
): Promise<void> {
  await session.driver.quit();
  assert.throws(() => process.kill(session.processId, 0), { code: 'ESRCH' });
  await rm(session.profile, { recursive: true, force: true });
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

export async function hashArtifact(extensionPath: string): Promise<string> {
  const hash = createHash('sha256');
  const filenames = (await readdir(extensionPath, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
  for (const filename of filenames) {
    hash.update(filename.slice(extensionPath.length));
    hash.update(await readFile(filename));
  }
  return hash.digest('hex');
}
