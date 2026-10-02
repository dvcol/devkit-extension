import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const repositoryDirectory = resolve(import.meta.dirname, '../../..');
const exampleDirectory = resolve(import.meta.dirname, '..');
const compiler = join(repositoryDirectory, 'node_modules/.bin/tsc');

/** The example owns the installed browser declarations and the real SDK package dependency. */
async function compileConsumer(source: string) {
  const evidenceDirectory = join(exampleDirectory, '.conformance');
  await mkdir(evidenceDirectory, { recursive: true });
  const directory = await mkdtemp(join(evidenceDirectory, 'port-declarations-'));
  try {
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(repositoryDirectory, 'tsconfig.base.json'),
        compilerOptions: { noEmit: true, types: ['chrome'], lib: ['ES2023', 'DOM'] },
        include: ['consumer.ts'],
      }),
    );
    await writeFile(join(directory, 'consumer.ts'), source);
    const result = spawnSync(compiler, ['--project', directory, '--pretty', 'false'], {
      cwd: exampleDirectory,
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { error: result.error, status: result.status, output: result.stdout + result.stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it('accepts Chrome and WXT Port declarations through the built public exports', async () => {
  expect.assertions(2);
  const result = await compileConsumer(`
import { createPortChannel } from '@devkit/webext';
import type { PortChannel, PortChannelOptions, RuntimePort } from '@devkit/webext';
import type { Browser } from '@wxt-dev/browser';
import { createRpcClient } from 'devframe/rpc/client';
import { createRpcServer } from 'devframe/rpc/server';

declare const chromePort: chrome.runtime.Port;
declare const wxtPort: Browser.runtime.Port;
const chromeRuntimePort: RuntimePort = chromePort;
const wxtRuntimePort: RuntimePort = wxtPort;
const chromeOptions: PortChannelOptions = { port: chromeRuntimePort, onDisconnect: () => {} };
const wxtOptions: PortChannelOptions = { port: wxtRuntimePort, onDisconnect: () => {} };
const chromeChannel: PortChannel = createPortChannel(chromeOptions);
const wxtChannel: PortChannel = createPortChannel(wxtOptions);
createRpcClient({}, { channel: chromeChannel });
createRpcClient({}, { channel: wxtChannel });
const server = createRpcServer({});
server.updateChannels((channels) => { channels.push(chromeChannel, wxtChannel); });

declare const nativeChannel: Parameters<typeof createRpcClient>[1]['channel'];
export const unchangedNativeChannel: PortChannel = nativeChannel;
`);
  expect(result.error).toBeUndefined();
  expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
});

const rejectedConsumers = [
  {
    name: 'a numeric native Firefox response request id',
    source: `
import type { WebRequest } from 'webextension-polyfill';
declare const requests: Pick<WebRequest.Static, 'filterResponseData'>;
requests.filterResponseData(1);
`,
    diagnostic: "Argument of type 'number' is not assignable to parameter of type 'string'",
    code: 'TS2345',
  },
  {
    name: 'string output for a native Firefox response filter',
    source: `
import type { WebRequest } from 'webextension-polyfill';
declare const response: WebRequest.StreamFilter;
response.write('body');
`,
    diagnostic: "Argument of type 'string' is not assignable to parameter of type",
    code: 'TS2345',
  },
  {
    name: 'a Port without disconnect events',
    source: `
import type { RuntimePort } from '@devkit/webext';
declare const incompletePort: Omit<chrome.runtime.Port, 'onDisconnect'>;
export const port: RuntimePort = incompletePort;
`,
    diagnostic: "Property 'onDisconnect' is missing",
    code: 'TS2741',
  },
  {
    name: 'a Port without message listener removal',
    source: `
import type { RuntimePort } from '@devkit/webext';
declare const incompletePort: Omit<chrome.runtime.Port, 'onMessage'> & {
  onMessage: Pick<chrome.runtime.Port['onMessage'], 'addListener'>;
};
export const port: RuntimePort = incompletePort;
`,
    diagnostic: "Property 'removeListener' is missing",
    code: 'TS2322',
  },
  {
    name: 'options without the owner disconnect callback',
    source: `
import type { PortChannelOptions } from '@devkit/webext';
declare const chromePort: chrome.runtime.Port;
export const options: PortChannelOptions = { port: chromePort };
`,
    diagnostic: "Property 'onDisconnect' is missing",
    code: 'TS2741',
  },
  {
    name: 'a disconnect callback requiring a payload',
    source: `
import type { PortChannelOptions } from '@devkit/webext';
declare const chromePort: chrome.runtime.Port;
declare const onDisconnect: (reason: Error) => void;
export const options: PortChannelOptions = { port: chromePort, onDisconnect };
`,
    diagnostic: "Type '(reason: Error) => void' is not assignable to type '() => void'",
    code: 'TS2322',
  },
  {
    name: 'a channel without the native listener hook',
    source: `
import type { PortChannel } from '@devkit/webext';
declare const incompleteChannel: Omit<PortChannel, 'on'>;
export const channel: PortChannel = incompleteChannel;
`,
    diagnostic: "Property 'on' is missing",
    code: 'TS2741',
  },
];

it('accepts native Firefox response declarations beside Chrome and WXT through built setup exports', async () => {
  expect.assertions(2);
  const result = await compileConsumer(`
import { defineExecution, defineTransform } from '@devkit/core';
import { browser } from '@wxt-dev/browser';
import type { Browser } from '@wxt-dev/browser';
import type { WebRequest } from 'webextension-polyfill';

type FirefoxFiltering = Pick<WebRequest.Static, 'filterResponseData'>;
function supportsFiltering(value: unknown): value is FirefoxFiltering {
  return typeof value === 'object' && value !== null &&
    'filterResponseData' in value && typeof value.filterResponseData === 'function';
}
export const contribution = defineTransform({
  id: 'consumer.response',
  execution: defineExecution({ id: 'background' }),
  setup({ scope }) {
    const requests = browser.webRequest;
    if (!supportsFiltering(requests)) return;
    const listener = (details: Browser.webRequest.OnBeforeRequestDetails) => {
      const filter: WebRequest.StreamFilter = requests.filterResponseData(details.requestId);
      filter.ondata = (event) => filter.write(event.data);
      filter.onstop = () => filter.close();
      return undefined;
    };
    requests.onBeforeRequest.addListener(listener, { urls: ['http://127.0.0.1/*'] }, ['blocking']);
    scope.onDispose(() => requests.onBeforeRequest.removeListener(listener));
  },
});
`);
  expect(result.error).toBeUndefined();
  expect({ status: result.status, output: result.output }).toEqual({ status: 0, output: '' });
});

for (const { name, source, diagnostic, code } of rejectedConsumers) {
  it(`rejects ${name} at the public declaration boundary`, async () => {
    expect.assertions(4);
    const result = await compileConsumer(source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.output).toContain(diagnostic);
    expect(result.output.match(/error TS\d+/gu)).toEqual([`error ${code}`]);
  });
}
