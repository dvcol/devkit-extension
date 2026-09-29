import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { styleText } from 'node:util';
import { Driver, Options, ServiceBuilder } from 'selenium-webdriver/firefox.js';
import { assertFirefoxReceipt } from './receipt.ts';

const extensionUuid = crypto.randomUUID();
const options = new Options()
  .addArguments('-headless')
  .setPreference(
    'extensions.webextensions.uuids',
    JSON.stringify({ 'devkit-debugger@example.invalid': extensionUuid }),
  );
if (process.env.FIREFOX_BINARY !== undefined) options.setBinary(process.env.FIREFOX_BINARY);
const service = new ServiceBuilder().addArguments('--allow-system-access');
const driver = Driver.createSession(options, service.build());
try {
  await driver.installAddon(resolve('dist/firefox'), true);
  await driver.get(`moz-extension://${extensionUuid}/probe.html`);
  const receipt = await driver.executeAsyncScript<unknown>(
    'const done = arguments[arguments.length - 1]; chrome.runtime.sendMessage({kind:"run",targetUrl:"https://example.invalid/"}).then(done, error => done({passed:false,error:String(error)}));',
  );
  const version: unknown = (await driver.getCapabilities()).get('browserVersion');
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/firefox.json',
    JSON.stringify({ browser: version, receipt }, null, 2) + '\n',
  );
  assertFirefoxReceipt(receipt);
  console.info(
    styleText('green', '🧪 [debugger/firefox]'),
    'Unsupported capability and waiting contribution verified',
    version,
  );
} finally {
  await driver.quit();
}
