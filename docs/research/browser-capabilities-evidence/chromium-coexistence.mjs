import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const outputDirectory = resolve(process.env.BROWSER_RESEARCH_OUTPUT ?? '.browser-v2/results');
await mkdir(outputDirectory, { recursive: true });
const results = { timestamp: new Date().toISOString(), controller: 'Node browser CDP plus explicit own extension control-page session; no inspected-target attachment or auto-attachment', cases: [] };

async function waitFor(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out: ${description}`);
}

async function connectBrowser(endpoint) {
  const connection = new WebSocket(endpoint);
  const pending = new Map();
  let nextIdentifier = 0;
  await new Promise((resolveOpen, rejectOpen) => {
    connection.addEventListener('open', resolveOpen, { once: true });
    connection.addEventListener('error', rejectOpen, { once: true });
  });
  connection.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    callback?.(message);
  });
  return {
    close: () => connection.close(),
    send(method, parameters = {}, sessionId) {
      const identifier = ++nextIdentifier;
      return new Promise((resolveResponse, rejectResponse) => {
        const timeout = setTimeout(() => {
          pending.delete(identifier);
          rejectResponse(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(identifier, message => {
          clearTimeout(timeout);
          if (message.error) rejectResponse(new Error(JSON.stringify(message.error)));
          else resolveResponse(message.result);
        });
        connection.send(JSON.stringify({ id: identifier, method, params: parameters, sessionId }));
      });
    },
  };
}

async function runCase(order, interception) {
  const scratchDirectory = await mkdtemp(resolve('.browser-v2/coexistence-'));
  const extensionDirectory = resolve(scratchDirectory, 'extension');
  await mkdir(extensionDirectory);
  const caseResult = { order, interception, headless: Boolean(process.env.BROWSER_RESEARCH_HEADLESS), events: [], httpRequests: [] };
  let commandIdentifier = 0;
  const fixtureServer = createServer((request, response) => {
    caseResult.httpRequests.push(request.url);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/body') response.end('original-response');
    else response.end('<!doctype html><title>Isolated coexistence fixture</title><body>fixture</body>');
  });
  await new Promise((resolveListen, rejectListen) => {
    fixtureServer.once('error', rejectListen);
    fixtureServer.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${fixtureServer.address().port}`;
  const backgroundSource = `
const origin = ${JSON.stringify(origin)};
let selectedTabId;
let pausedRequest;
let reportSequence = Promise.resolve();
const events = [];
function report(value) {
  events.push(value);
  reportSequence = reportSequence.then(() => chrome.storage.local.set({ events: [...events] }));
  return reportSequence;
}
chrome.debugger.onDetach.addListener((source, reason) => { void report({ kind: 'detach', source, reason }); });
chrome.debugger.onEvent.addListener((source, method, parameters) => {
  if (method !== 'Fetch.requestPaused') return;
  pausedRequest = { source, requestId: parameters.requestId };
  void report({ kind: 'paused', source, url: parameters.request.url });
});
async function execute(command) {
  if (command.kind === 'events') return events;
  if (command.kind === 'tab-status') return chrome.tabs.get(selectedTabId);
  if (command.kind === 'initialize') {
    selectedTabId = (await chrome.tabs.create({ url: origin + '/fixture' })).id;
    return { tabId: selectedTabId };
  }
  if (command.kind === 'attach') {
    await chrome.debugger.attach({ tabId: selectedTabId }, '1.3');
    return { attached: true };
  }
  if (command.kind === 'evaluate') {
    return chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Runtime.evaluate', { expression: '6 * 7', returnByValue: true });
  }
  if (command.kind === 'enable-fetch') {
    return chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Fetch.enable', { patterns: [{ urlPattern: origin + '/body', requestStage: 'Response' }] });
  }
  if (command.kind === 'request') {
    chrome.scripting.executeScript({ target: { tabId: selectedTabId }, func: async () => {
      const response = await fetch('/body', { signal: AbortSignal.timeout(10000) });
      return { body: await response.text(), status: response.status };
    } }).then(value => report({ kind: 'request-result', value }), error => report({ kind: 'request-error', error: String(error) }));
    return { requested: true };
  }
  if (command.kind === 'fulfill') {
    const original = await chrome.debugger.sendCommand(pausedRequest.source, 'Fetch.getResponseBody', { requestId: pausedRequest.requestId });
    await chrome.debugger.sendCommand(pausedRequest.source, 'Fetch.fulfillRequest', {
      requestId: pausedRequest.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
      body: btoa('transformed-response'),
    });
    return { original };
  }
  if (command.kind === 'detach') {
    await chrome.debugger.sendCommand({ tabId: selectedTabId }, 'Fetch.disable');
    await chrome.debugger.detach({ tabId: selectedTabId });
    return { detached: true };
  }
  throw new Error('Unknown command');
}
chrome.runtime.onMessage.addListener((command, sender, reply) => {
  execute(command).then(value => reply({ kind: 'command-result', id: command.id, command: command.kind, value }), error => reply({ kind: 'command-error', id: command.id, command: command.kind, error: String(error) }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.command?.newValue) return;
  const command = changes.command.newValue;
  execute(command).then(value => report({ kind: 'command-result', id: command.id, command: command.kind, value }), error => report({ kind: 'command-error', id: command.id, command: command.kind, error: String(error) }));
});

`;
  await writeFile(resolve(extensionDirectory, 'background.js'), backgroundSource);
  await writeFile(resolve(extensionDirectory, 'control.html'), '<!doctype html><title>Isolated extension controller</title>');
  await writeFile(resolve(extensionDirectory, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Isolated debugger coexistence audit',
    version: '0.0.1',
    permissions: ['debugger', 'scripting', 'tabs', 'storage'],
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
  }, null, 2));
  let browserProcess;
  let browserConnection;
  let browserLogs = '';
  let extensionId;
  let controlSession;
  async function refreshEvents() {
    const stored = await browserConnection.send('Runtime.evaluate', { expression: 'chrome.runtime.sendMessage({ kind: \'events\' })', awaitPromise: true, returnByValue: true }, controlSession);
    caseResult.events = stored.result.value?.value ?? [];
  }
  async function command(kind) {
    const identifier = ++commandIdentifier;
    const evaluation = await browserConnection.send('Runtime.evaluate', { expression: `chrome.runtime.sendMessage(${JSON.stringify({ id: identifier, kind })})`, awaitPromise: true, returnByValue: true }, controlSession);
    if (evaluation.exceptionDetails) throw new Error(JSON.stringify(evaluation.exceptionDetails));
    await refreshEvents();
    return evaluation.result.value;
  }
  async function openDevTools(targetId) {
    const frontend = await browserConnection.send('Target.openDevTools', { targetId, panelId: 'network' });
    const verified = await browserConnection.send('Target.getDevToolsTarget', { targetId });
    assert.equal(verified.targetId, frontend.targetId);
    const information = await browserConnection.send('Target.getTargetInfo', { targetId: frontend.targetId });
    assert.match(information.targetInfo.url, /^devtools:\/\//);
    caseResult.frontend = information.targetInfo;
    const frontendSession = (await browserConnection.send('Target.attachToTarget', { targetId: frontend.targetId, flatten: true })).sessionId;
    try {
      caseResult.frontendReadiness = await waitFor(async () => {
        const snapshot = await browserConnection.send('Runtime.evaluate', {
          expression: `import('devtools://devtools/bundled/core/sdk/sdk.js').then(developerToolsSdk => ({ ready: document.readyState, targets: developerToolsSdk.TargetManager.TargetManager.instance().targets().map(target => ({ id: target.id(), url: target.inspectedURL(), type: target.type() })) }))`,
          awaitPromise: true, returnByValue: true,
        }, frontendSession);
        const value = snapshot.result.value;
        return value?.ready === 'complete' && value.targets.some(target => target.url === origin + '/fixture') && value;
      }, 'native frontend connected to fixture target');
    } finally {
      await browserConnection.send('Target.detachFromTarget', { sessionId: frontendSession });
    }
  }
  try {
    browserProcess = spawn(process.env.BROWSER_RESEARCH_CHROMIUM, [
      `--user-data-dir=${resolve(scratchDirectory, 'profile')}`,
      ...(process.env.BROWSER_RESEARCH_HEADLESS ? ['--headless=new'] : []),
      '--password-store=basic', '--use-mock-keychain',
      '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    browserProcess.stderr.on('data', chunk => { browserLogs += chunk; });
    const endpoint = await waitFor(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(browserLogs)?.[1], 'browser endpoint');
    browserConnection = await connectBrowser(endpoint);
    caseResult.browserVersion = await browserConnection.send('Browser.getVersion');
    assert.equal(caseResult.browserVersion.product, 'Chrome/153.0.8010.52');
    caseResult.extensions = await browserConnection.send('Extensions.getExtensions');
    if (caseResult.extensions.extensions.length === 0) {
      caseResult.explicitLoad = await browserConnection.send('Extensions.loadUnpacked', { path: extensionDirectory });
    }
    extensionId = caseResult.extensions.extensions[0]?.id ?? caseResult.explicitLoad.id;
    caseResult.initialTargets = await browserConnection.send('Target.getTargets');
    const controlTarget = await browserConnection.send('Target.createTarget', { url: `chrome-extension://${extensionId}/control.html` });
    controlSession = (await browserConnection.send('Target.attachToTarget', { targetId: controlTarget.targetId, flatten: true })).sessionId;
    caseResult.control = { targetId: controlTarget.targetId, sessionId: controlSession };
    await delay(500);
    caseResult.controlPreflight = await browserConnection.send('Runtime.evaluate', { expression: '({ ready: document.readyState, extension: chrome.runtime.id })', returnByValue: true }, controlSession);
    caseResult.initialization = await command('initialize');
    caseResult.loadedTab = await waitFor(async () => { const observed = await command('tab-status'); return observed.value?.status === 'complete' && observed; }, 'fixture document complete');
    let target;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const targets = await browserConnection.send('Target.getTargets');
      target = targets.targetInfos.find(information => information.url === origin + '/fixture');
      if (target) break;
      await delay(100);
    }
    assert.ok(target, 'fixture page target exists');
    if (order === 'devtools-first') await openDevTools(target.targetId);
    caseResult.attachment = await command('attach');
    if (interception && caseResult.attachment.kind === 'command-result') {
      caseResult.fetchEnable = await command('enable-fetch');
      await command('request');
      await waitFor(async () => { await refreshEvents(); return caseResult.events.find(event => event.kind === 'paused'); }, 'response pause');
    }
    if (order === 'extension-first') await openDevTools(target.targetId);
    const verificationSession = (await browserConnection.send('Target.attachToTarget', { targetId: caseResult.frontend.targetId, flatten: true })).sessionId;
    try {
      const frontendEvaluation = await browserConnection.send('Runtime.evaluate', {
        expression: `import('devtools://devtools/bundled/core/sdk/sdk.js').then(developerToolsSdk => developerToolsSdk.TargetManager.TargetManager.instance().targets().find(target => target.type() === 'frame' && target.inspectedURL() === ${JSON.stringify(origin + '/fixture')}).runtimeAgent().invoke_evaluate({ expression: '6 * 9', returnByValue: true }))`,
        awaitPromise: true, returnByValue: true,
      }, verificationSession);
      caseResult.frontendAfterBoth = frontendEvaluation.result.value;
      assert.equal(caseResult.frontendAfterBoth?.result?.value, 54);
    } finally {
      await browserConnection.send('Target.detachFromTarget', { sessionId: verificationSession });
    }
    caseResult.afterBoth = await command('evaluate');
    if (interception && caseResult.attachment.kind === 'command-result') {
      caseResult.fulfillment = await command('fulfill');
      caseResult.request = await waitFor(async () => { await refreshEvents(); return caseResult.events.find(event => event.kind === 'request-result' || event.kind === 'request-error'); }, 'request settlement');
    }
    caseResult.cleanup = await command('detach');
    assert.equal(caseResult.attachment.kind, 'command-result');
    assert.equal(caseResult.afterBoth.value?.result?.value, 42);
    assert.equal(caseResult.cleanup.kind, 'command-result');
    if (interception) {
      assert.equal(caseResult.fetchEnable.kind, 'command-result');
      assert.equal(caseResult.fulfillment.kind, 'command-result');
      assert.equal(caseResult.request.value?.[0]?.result?.body, 'transformed-response');
    }
    assert.equal(caseResult.events.filter(event => event.kind === 'detach').length, 0);
    caseResult.status = 'passed';
  } catch (error) {
    caseResult.status = 'probe-failed';
    caseResult.error = String(error.stack ?? error);
    caseResult.browserLogs = browserLogs.replaceAll(scratchDirectory, '<isolated-profile>');

  } finally {
    if (browserConnection) {
      try { await browserConnection.send('Browser.close'); } catch { /* Browser may already have closed. */ }
      browserConnection.close();
    }
    if (browserProcess && browserProcess.exitCode === null) {
      browserProcess.kill('SIGTERM');
      await delay(300);
      if (browserProcess.exitCode === null) browserProcess.kill('SIGKILL');
    }
    fixtureServer.closeAllConnections();
    await new Promise(resolveClose => fixtureServer.close(resolveClose));
    await rm(scratchDirectory, { recursive: true, force: true });
  }
  return caseResult;
}

for (const order of ['extension-first', 'devtools-first']) {
  for (const interception of [false, true]) {
    const caseResult = await runCase(order, interception);
    results.cases.push(caseResult);
    await writeFile(resolve(outputDirectory, 'chromium-coexistence.json'), JSON.stringify(results, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ order, interception, status: caseResult.status, attachment: caseResult.attachment, afterBoth: caseResult.afterBoth, request: caseResult.request, error: caseResult.error }) + '\n');
    if (caseResult.status === 'probe-failed') break;
  }
  if (results.cases.some(caseResult => caseResult.status === 'probe-failed')) break;
}
if (results.cases.some(caseResult => caseResult.status !== 'passed')) process.exitCode = 1;
