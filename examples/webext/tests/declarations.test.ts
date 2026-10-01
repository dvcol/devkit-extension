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
