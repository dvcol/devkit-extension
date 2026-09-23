import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const { default: webExtension } = await import(pathToFileURL(process.env.BROWSER_RESEARCH_WEB_EXT));
const outputDirectory = resolve(process.env.BROWSER_RESEARCH_OUTPUT ?? '.browser-v2/results');
await mkdir(outputDirectory, { recursive: true });
const results = { timestamp: new Date().toISOString(), firefoxVersion: execFileSync(process.env.BROWSER_RESEARCH_FIREFOX, ['--version'], { encoding: 'utf8' }).trim(), cases: [] };
assert.match(results.firefoxVersion, /156\.0\.1/);

async function runCase(filterPermission) {
  const scratchDirectory = await mkdtemp(resolve('.browser-v2/firefox-'));
  const reports = [];
  const fixtureServer = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/report') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { reports.push(JSON.parse(body)); response.end('ok'); });
      return;
    }
    if (request.url === '/text') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('original-text');
      return;
    }
    if (request.url === '/chunked') {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const bytes = Buffer.from('original-café-世界');
      response.write(bytes.subarray(0, 14));
      setTimeout(() => { response.write(bytes.subarray(14, 16)); }, 30);
      setTimeout(() => response.end(bytes.subarray(16)), 60);
      return;
    }
    if (request.url !== '/fixture') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><script>
globalThis.parserSnapshot = { main: globalThis.mainMarker, isolated: globalThis.isolatedMarker, mainMessaging: globalThis.mainMessaging, byteMarker: globalThis.byteTransformMarker };
async function runPageProbe() {
  const text = await (await fetch('/text')).text();
  const chunked = await (await fetch('/chunked')).text();
  await fetch('/report', { method: 'POST', body: JSON.stringify({ kind: 'page', parser: globalThis.parserSnapshot, text, chunked, htmlBody: document.body.textContent.trim() }) });
}
addEventListener('load', () => { void runPageProbe(); }, { once: true });
</script></head><body>original-html</body></html>`);
  });
  await new Promise((resolveListen, rejectListen) => {
    fixtureServer.once('error', rejectListen);
    fixtureServer.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${fixtureServer.address().port}`;
  const backgroundSource = `
const origin = ${JSON.stringify(origin)};
async function report(value) { await fetch(origin + '/report', { method: 'POST', body: JSON.stringify(value) }); }
browser.runtime.onMessage.addListener(() => Promise.resolve({ kind: 'background-reply', debuggerType: typeof browser.debugger }));
browser.webRequest.onBeforeRequest.addListener(details => {
  if (!['/fixture', '/text', '/chunked'].includes(new URL(details.url).pathname)) return;
  void report({ kind: 'request-observed', path: new URL(details.url).pathname });
  try {
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const decoder = new TextDecoder('utf-8');
    const encoder = new TextEncoder();
    let original = '';
    let chunkCount = 0;
    filter.ondata = event => { original += decoder.decode(event.data, { stream: true }); chunkCount += 1; };
    filter.onstop = () => {
      original += decoder.decode();
      let replacement = original.replaceAll('original-', 'changed-');
      if (details.url.endsWith('/fixture')) replacement = replacement.replace('<head>', '<head><script>globalThis.byteTransformMarker = "before-parser";</script>');
      filter.write(encoder.encode(replacement));
      filter.close();
      void report({ kind: 'filter-complete', path: new URL(details.url).pathname, chunkCount, original, replacement });
    };
    filter.onerror = () => { void report({ kind: 'filter-error', path: new URL(details.url).pathname, error: filter.error }); };
  } catch (error) { void report({ kind: 'filter-rejected', path: new URL(details.url).pathname, error: String(error) }); }
}, { urls: ['http://127.0.0.1/*'] }, ['blocking']);
browser.permissions.getAll().then(permissions => report({ kind: 'permissions', permissions, filterType: typeof browser.webRequest.filterResponseData })).then(() => browser.tabs.create({ url: origin + '/fixture' }));
`;
  await writeFile(resolve(scratchDirectory, 'background.js'), backgroundSource);
  await writeFile(resolve(scratchDirectory, 'main.js'), 'globalThis.mainMarker = "before-parser"; globalThis.mainMessaging = typeof globalThis.browser?.runtime?.sendMessage;');
  await writeFile(resolve(scratchDirectory, 'isolated.js'), `
globalThis.isolatedMarker = 'isolated';
const isolatedAtStart = { mainMarker: globalThis.mainMarker, marker: globalThis.isolatedMarker, messaging: typeof browser.runtime.sendMessage };
browser.runtime.sendMessage({ probe: true }).then(background => fetch(${JSON.stringify(origin + '/report')}, { method: 'POST', body: JSON.stringify({ kind: 'isolated', isolatedAtStart, background }) }));
`);
  const permissions = ['scripting', 'storage', 'webRequest', 'webRequestBlocking'];
  if (filterPermission) permissions.push('webRequestFilterResponse');
  await writeFile(resolve(scratchDirectory, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Isolated Firefox browser capability audit',
    version: '0.0.1',
    browser_specific_settings: { gecko: { id: 'browser-capability-research@example.test' } },
    permissions,
    host_permissions: ['http://127.0.0.1/*'],
    background: { scripts: ['background.js'] },
    content_scripts: [
      { matches: ['http://127.0.0.1/*'], js: ['main.js'], run_at: 'document_start', world: 'MAIN' },
      { matches: ['http://127.0.0.1/*'], js: ['isolated.js'], run_at: 'document_start', world: 'ISOLATED' },
    ],
  }, null, 2));
  let runner;
  const caseResult = { filterPermission, reports };
  try {
    runner = await webExtension.cmd.run({ sourceDir: scratchDirectory, firefox: process.env.BROWSER_RESEARCH_FIREFOX, args: ['-headless'], noInput: true, noReload: true }, { shouldExitProgram: false });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !(reports.some(report => report.kind === 'page') && reports.some(report => report.kind === 'isolated') && reports.filter(report => report.kind === (filterPermission ? 'filter-complete' : 'filter-rejected')).length === 3)) await delay(50);
    const pageReport = reports.find(report => report.kind === 'page');
    const isolatedReport = reports.find(report => report.kind === 'isolated');
    assert.ok(pageReport, 'page submitted actual received bytes');
    assert.ok(isolatedReport, 'isolated script reported messaging');
    assert.equal(pageReport.parser.main, 'before-parser');
    assert.equal(pageReport.parser.isolated, undefined);
    assert.equal(pageReport.parser.mainMessaging, 'undefined');
    assert.equal(isolatedReport.isolatedAtStart.mainMarker, undefined);
    assert.equal(isolatedReport.isolatedAtStart.marker, 'isolated');
    assert.equal(isolatedReport.isolatedAtStart.messaging, 'function');
    assert.equal(isolatedReport.background.debuggerType, 'undefined');
    if (filterPermission) {
      assert.equal(pageReport.text, 'changed-text');
      assert.equal(pageReport.chunked, 'changed-café-世界');
      assert.equal(pageReport.htmlBody, 'changed-html');
      assert.equal(pageReport.parser.byteMarker, 'before-parser');
      assert.ok(reports.some(report => report.kind === 'filter-complete' && report.path === '/chunked' && report.chunkCount > 1));
    } else {
      assert.equal(pageReport.text, 'original-text');
      assert.equal(pageReport.chunked, 'original-café-世界');
      assert.equal(pageReport.htmlBody, 'original-html');
      assert.equal(pageReport.parser.byteMarker, undefined);
      assert.equal(reports.filter(report => report.kind === 'filter-rejected').length, 3);
    }
    caseResult.status = 'passed';
  } catch (error) {
    caseResult.status = 'failed';
    caseResult.error = String(error.stack ?? error);
  } finally {
    await runner?.exit();
    fixtureServer.closeAllConnections();
    await new Promise(resolveClose => fixtureServer.close(resolveClose));
    await rm(scratchDirectory, { recursive: true, force: true });
  }
  return caseResult;
}

for (const filterPermission of [true, false]) {
  const caseResult = await runCase(filterPermission);
  results.cases.push(caseResult);
  await writeFile(resolve(outputDirectory, 'firefox-filtering.json'), JSON.stringify(results, null, 2) + '\n');
  process.stdout.write(JSON.stringify(caseResult) + '\n');
}
if (results.cases.some(caseResult => caseResult.status !== 'passed')) process.exitCode = 1;
