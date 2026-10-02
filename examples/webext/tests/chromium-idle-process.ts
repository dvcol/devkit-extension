import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { waitFor } from './chromium-idle-cdp.ts';
import type { BrowserConnection } from './chromium-idle-cdp.ts';

export async function startBrowser(extensionPath: string) {
  const executable = chromium.executablePath();
  const profile = await mkdtemp(join(tmpdir(), 'chromium-native-idle-'));
  const processStart = Date.now();
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-extensions-with-background-pages',
      '--password-store=basic',
      '--use-mock-keychain',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const errors: { stderr: string; launchError?: Error } = { stderr: '' };
  browser.stderr.on('data', (data: Buffer) => {
    errors.stderr = `${errors.stderr}${data.toString()}`.slice(-4000);
  });
  browser.once('error', (error) => {
    errors.launchError = error;
  });
  return { browser, executable, profile, processStart, errors };
}

export async function browserEndpoint(
  session: Awaited<ReturnType<typeof startBrowser>>,
): Promise<string> {
  let endpoint: string | undefined;
  await waitFor(async () => {
    if (session.errors.launchError !== undefined) throw session.errors.launchError;
    assert.equal(session.browser.exitCode, null, session.errors.stderr);
    try {
      const [port, path] = (await readFile(join(session.profile, 'DevToolsActivePort'), 'utf8'))
        .trim()
        .split('\n');
      assert.ok(port !== undefined && path !== undefined);
      endpoint = `ws://127.0.0.1:${port}${path}`;
      return true;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }, 'the native Chromium debugging endpoint').catch((error: unknown) => {
    throw new Error(`Chromium endpoint unavailable: ${session.errors.stderr}`, { cause: error });
  });
  assert.ok(endpoint !== undefined);
  return endpoint;
}

export async function closeBrowser(
  session: Awaited<ReturnType<typeof startBrowser>>,
  control: BrowserConnection | undefined,
): Promise<void> {
  try {
    await closeProcess(session.browser, control);
  } finally {
    control?.close();
    await rm(session.profile, { recursive: true, force: true });
  }
}

async function closeProcess(
  browser: ChildProcess,
  control: BrowserConnection | undefined,
): Promise<void> {
  if (browser.pid === undefined || browser.exitCode !== null || browser.signalCode !== null) return;
  const exit = once(browser, 'exit');
  if (control === undefined) browser.kill('SIGTERM');
  else await control.command('Browser.close').catch(() => {});
  await waitFor(
    () => browser.exitCode !== null || browser.signalCode !== null,
    'native browser cleanup',
    10_000,
  ).catch(async (error: unknown) => {
    /** A failed runner cleanup never counts as evidence of native worker suspension. */
    browser.kill('SIGKILL');
    await exit;
    throw error;
  });
  assert.throws(() => process.kill(browser.pid!, 0), { code: 'ESRCH' });
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
