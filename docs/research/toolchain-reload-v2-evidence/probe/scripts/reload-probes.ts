import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext } from '@playwright/test';
import { createServer as createWxtServer } from 'wxt';
import { cmd } from 'web-ext';
import { styleText } from 'node:util';
import { buildCustom, serveCustom } from './custom-build.ts';

interface Observation { count: number; memoryCount: number; backgroundVersion: string; boot: number; contentVersion?: string; contentBoot?: number; invocationCount?: number; pageTimeOrigin: number; viewVersion?: string; pageInvocations?: number; error?: string; }
function isObservation(value: unknown): value is Observation {
  if (typeof value !== 'object' || value === null) return false;
  return 'count' in value && typeof value.count === 'number' && 'memoryCount' in value && typeof value.memoryCount === 'number' && 'backgroundVersion' in value && typeof value.backgroundVersion === 'string' && 'boot' in value && typeof value.boot === 'number' && 'pageTimeOrigin' in value && typeof value.pageTimeOrigin === 'number';
}
interface Step { name: string; status: string; observation?: Observation; error?: string; }
interface CaseResult { candidate: string; browserName: string; mode: string; steps: Step[]; }
const chromeBinary = process.env.PROBE_CHROME_BINARY;
const firefoxBinary = process.env.PROBE_FIREFOX_BINARY;
if (!chromeBinary || !firefoxBinary) throw new Error('Set PROBE_CHROME_BINARY and PROBE_FIREFOX_BINARY');
const results: CaseResult[] = [];
const production = process.env.PROBE_MODE === 'production';
const outputName = production ? 'production-results.json' : 'reload-results-followup.json';
let contentReports: Observation[] = [];
let pageReports: Observation[] = [];
let commands: string[] = [];
const fixtureServer = createHttpServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  if (request.url?.endsWith('-report')) {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      const observation: unknown = JSON.parse(body);
      if (!isObservation(observation)) { response.writeHead(400).end('invalid observation'); return; }
      if (request.url === '/page-report') pageReports.push(observation);
      else contentReports.push(observation);
      response.writeHead(200).end('ok');
    });
    return;
  }
  if (request.url === '/command') { response.writeHead(200).end(commands.shift() ?? ''); return; }
  response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body>Reload probe<script>setInterval(async()=>{const command=await(await fetch("/command")).text();if(command)document.dispatchEvent(new Event("probe:"+command));},200);setTimeout(()=>{if(!document.documentElement.dataset.probe)location.reload()},3000)</script></body></html>');
});
await new Promise<void>((resolveListen) => fixtureServer.listen(39371, '127.0.0.1', resolveListen));
async function waitObservation(collection: () => Observation[], predicate: (value: Observation) => boolean, timeout = 18000): Promise<Observation> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = collection().findLast(predicate);
    if (match) return match;
    await delay(100);
  }
  throw new Error(`Observation timeout; content=${contentReports.length}, page=${pageReports.length}`);
}
async function step(result: CaseResult, name: string, work: () => Promise<Observation>): Promise<Observation | undefined> {
  try {
    const observation = await work();
    result.steps.push({ name, status: 'observed', observation });
    return observation;
  } catch (error) {
    result.steps.push({ name, status: 'unverified', error: String(error) });
    return undefined;
  }
}
const originals = new Map<string, string>();
for (const name of ['background', 'content', 'view']) {
  const path = resolve(`shared/${name}-version.ts`);
  originals.set(path, await readFile(path, 'utf8'));
}
const configurationPath = resolve('fixtures/wxt/wxt.config.ts');
originals.set(configurationPath, await readFile(configurationPath, 'utf8'));
async function restore(): Promise<void> { for (const [path, content] of originals) await writeFile(path, content); }

try {
  for (const candidate of ['wxt', 'custom'] as const) {
    if (process.env.PROBE_CANDIDATE && process.env.PROBE_CANDIDATE !== candidate) continue;
    for (const browserName of ['chrome', 'firefox'] as const) {
      const result: CaseResult = { candidate, browserName, mode: production ? 'production' : 'development', steps: [] };
      results.push(result);
      let context: BrowserContext | undefined;
      let firefoxRunner: Awaited<ReturnType<typeof cmd.run>> | undefined;
      let wxtServer: Awaited<ReturnType<typeof createWxtServer>> | undefined;
      let customServer: Awaited<ReturnType<typeof serveCustom>> | undefined;
      contentReports = []; pageReports = []; commands = [];
      await restore();
      try {
        let extensionPath: string;
        if (production && candidate === 'wxt') {
          extensionPath = resolve(`fixtures/wxt/.output/${browserName}-mv3`);
        } else if (candidate === 'wxt') {
          wxtServer = await createWxtServer({ root: resolve('fixtures/wxt'), browser: browserName, manifestVersion: 3, webExt: { disabled: true }, dev: { server: { host: 'localhost', port: 39373 } } });
          await wxtServer.start();
          extensionPath = resolve(`fixtures/wxt/.output/${browserName}-mv3-dev`);
        } else {
          extensionPath = await buildCustom(browserName, !production);
          if (!production) customServer = await serveCustom();
        }
        if (browserName === 'chrome') {
          context = await chromium.launchPersistentContext(resolve(`profiles/${candidate}-${browserName}`), { executablePath: chromeBinary, headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
          const page = await context.newPage();
          await page.goto('http://127.0.0.1:39371/fixture');
        } else {
          firefoxRunner = await cmd.run({ sourceDir: extensionPath, firefox: firefoxBinary, args: ['-headless'], startUrl: ['http://127.0.0.1:39371/fixture'], noInput: true, noReload: true }, { shouldExitProgram: false });
        }
        const initial = await step(result, 'initial-content-background', () => waitObservation(() => contentReports, (value) => value.contentVersion === 'content-initial'));
        if (!initial) continue;
        const initialCount = initial.count;
        commands.push('increment');
        await step(result, 'action-state', () => waitObservation(() => contentReports, (value) => value.count === initialCount + 1 && value.invocationCount === 1));
        commands.push('open');
        commands.push('fail');
        await step(result, 'intentional-action-failure', () => waitObservation(() => contentReports, (value) => value.error === 'intentional failure'));
        const initialPage = await step(result, 'extension-page', () => waitObservation(() => pageReports, (value) => value.viewVersion === 'view-initial'));
        if (production) continue;
        await writeFile(resolve('shared/view-version.ts'), "export const version = 'view-updated';\n");
        const updatedPage = await step(result, 'page-update', () => waitObservation(() => pageReports, (value) => value.viewVersion === 'view-updated'));
        if (initialPage && updatedPage) result.steps.push({ name: 'page-HMR-timeOrigin', status: initialPage.pageTimeOrigin === updatedPage.pageTimeOrigin ? 'unchanged' : 'reloaded' });
        if (candidate === 'custom') {
          result.steps.push({ name: 'content-background-manifest-auto-reload', status: 'not-provided-by-minimal-packager' });
          continue;
        }
        await writeFile(resolve('shared/content-version.ts'), "export const version = 'content-updated';\n");
        const updatedContent = await step(result, 'content-update', () => waitObservation(() => contentReports, (value) => value.contentVersion === 'content-updated'));
        if (updatedContent) {
          commands.push('increment');
          await step(result, 'single-listener-after-content-update', () => waitObservation(() => contentReports, (value) => value.contentVersion === 'content-updated' && value.count === updatedContent.count + 1 && value.invocationCount === 1));
        }
        await writeFile(resolve('shared/background-version.ts'), "export const version = 'background-updated';\n");
        const backgroundUpdate = await step(result, 'background-update', () => waitObservation(() => contentReports, (value) => value.backgroundVersion === 'background-updated', 6000));
        if (!backgroundUpdate) {
          const entryPath = resolve('fixtures/wxt/entrypoints/background.ts');
          const entrySource = await readFile(entryPath, 'utf8');
          await writeFile(entryPath, entrySource.replace('main: startBackground', 'main() { startBackground(); }'));
          await step(result, 'direct-background-entry-update', () => waitObservation(() => contentReports, (value) => value.backgroundVersion === 'background-updated', 8000));
          wxtServer?.reloadExtension();
          await step(result, 'explicit-extension-reload', () => waitObservation(() => contentReports, (value) => value.backgroundVersion === 'background-updated', 8000));
          await writeFile(entryPath, entrySource);
        }
        const beforeManifest = contentReports.at(-1);
        const source = originals.get(configurationPath)!;
        await writeFile(configurationPath, source.replace("version: '0.0.0'", "version: '0.0.1'"));
        await step(result, 'manifest-update', () => waitObservation(() => contentReports, (value) => beforeManifest !== undefined && value.boot !== beforeManifest.boot));
      } catch (error) {
        result.steps.push({ name: 'case-execution', status: 'failed', error: String(error) });
      } finally {
        await context?.close();
        await firefoxRunner?.exit();
        await wxtServer?.stop();
        await customServer?.close();
        await restore();
        await writeFile(`../${outputName}`, JSON.stringify(results, null, 2));
      }
    }
  }
} finally {
  await new Promise<void>((resolveClose) => fixtureServer.close(() => resolveClose()));
  await restore();
  await writeFile(`../${outputName}`, JSON.stringify(results, null, 2));
}
assert.equal(results.length, process.env.PROBE_CANDIDATE ? 2 : 4);
console.info(styleText('cyan', '🧪 [toolchain]'), 'observations', results);
