import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import webExtension from 'web-ext';

const firefoxBinary = '/Applications/Firefox.app/Contents/MacOS/firefox';
const results = { firefoxVersion: execFileSync(firefoxBinary, ['--version'], { encoding: 'utf8' }).trim() };
let resolveReport;
const report = new Promise((resolveValue) => { resolveReport = resolveValue; });
const server = createServer((request, response) => {
  if (request.url === '/extension-report') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => { resolveReport(JSON.parse(body)); response.writeHead(200).end('ok'); });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><head><meta http-equiv="refresh" content="1"></head><body>Firefox extension fixture</body></html>');
});
let runner;
let timeout;
try {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const fixtureUrl = `http://127.0.0.1:${server.address().port}`;
  runner = await webExtension.cmd.run({
    sourceDir: resolve('fixtures/wxt/.output/firefox-mv3'),
    firefox: firefoxBinary,
    firefoxProfile: undefined,
    args: ['-headless'],
    startUrl: [fixtureUrl],
    noInput: true,
    noReload: true,
  }, { shouldExitProgram: false });
  const actualReport = await Promise.race([
    report,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('No Firefox extension report within 30 seconds')), 30000); }),
  ]);
  assert.equal(actualReport.value, 'background-ready');
  results.contentToBackground = actualReport;
} finally {
  clearTimeout(timeout);
  await runner?.exit();
  await new Promise((resolveClose) => server.close(resolveClose));
  await writeFile('../firefox-results.json', JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify(results, null, 2));
