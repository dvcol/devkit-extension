import { createEmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import { createSelectedTabPublisher } from '@dvcol/cdb-extension';

async function bounded(operation, description) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbe(targetUrl) {
  const trace = [];
  const pausedEvents = [];
  const bridge = createEmbeddedChromeDebuggerBridge();
  let signalFetchDisabled;
  const fetchDisabled = new Promise((resolve) => { signalFetchDisabled = resolve; });
  const fetchConfiguration = {
    patterns: [{ urlPattern: `${new URL(targetUrl).origin}/selected*`, requestStage: 'Response' }],
  };
  const chromeDebugger = {
    async attach(target, version) {
      const record = { method: 'attach', target, status: 'pending' };
      trace.push(record);
      await chrome.debugger.attach(target, version);
      record.status = 'fulfilled';
    },
    async detach(target) {
      const record = { method: 'detach', target, status: 'pending' };
      trace.push(record);
      await chrome.debugger.detach(target);
      record.status = 'fulfilled';
    },
    async sendCommand(target, method, parameters) {
      const configuredParameters = method === 'Fetch.enable' ? fetchConfiguration : parameters;
      const record = { method, target, parameters: configuredParameters, status: 'pending' };
      trace.push(record);
      try {
        const result = await chrome.debugger.sendCommand(target, method, configuredParameters) ?? {};
        record.status = 'fulfilled';
        if (method === 'Fetch.disable') signalFetchDisabled();
        return result;
      } catch (error) {
        record.status = 'rejected';
        record.error = String(error);
        throw error;
      }
    },
  };
  const publisher = createSelectedTabPublisher({
    scopeId: crypto.randomUUID(),
    capabilities: { level: 'debug' },
    chromeDebugger,
    publishTarget: bridge.broker.publishTarget,
    updateTarget: bridge.broker.updateTarget,
    revokeTarget: (target, reason) => bridge.broker.revokeTarget(target.id, target.generation, reason),
    publishEvent: bridge.broker.publishEvent,
    registerTargetExecutor: bridge.registerTargetExecutor,
  });
  const debuggerListener = (source, method, parameters) => {
    if (method === 'Fetch.requestPaused') pausedEvents.push({
      requestId: parameters.requestId,
      url: parameters.request.url,
      responseStatusCode: parameters.responseStatusCode,
      source,
    });
    publisher.debuggerEvent(source, method, parameters);
  };
  chrome.debugger.onEvent.addListener(debuggerListener);
  const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
  if (tab?.id === undefined) throw new Error('Owned fixture tab not found');
  let subscription;
  let targetLease;
  let result;
  let failure;
  try {
    const target = await publisher.publish({ tabId: tab.id, incognito: tab.incognito, url: targetUrl, title: 'Fetch fixture' });
    const lease = await bridge.client.acquireLease({
      targetId: target.id,
      targetGeneration: target.generation,
      durationMilliseconds: 30_000,
      mode: 'exclusive-control',
      requestedMethods: ['Fetch.requestPaused', 'Fetch.getResponseBody', 'Fetch.fulfillRequest', 'Runtime.evaluate'],
    });
    targetLease = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
    subscription = await bridge.client.subscribe({
      ...targetLease,
      match: { method: 'Fetch.requestPaused' },
      buffer: { capacity: 16, overflowStrategy: 'disconnect' },
    });
    async function execute(method, parameters, sessionId) {
      return bridge.client.executeCommand({
        ...targetLease,
        operationId: crypto.randomUUID(), method, parameters,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    }
    async function transformPausedResponse() {
      const event = await bounded(subscription[Symbol.asyncIterator]().next(), 'Fetch event');
      if (event.done) throw new Error('Fetch subscription ended before response');
      if (event.value.parameters.responseStatusCode !== 200) throw new Error('Expected Response-stage pause');
      const requestId = event.value.parameters.requestId;
      const body = await execute('Fetch.getResponseBody', { requestId }, event.value.sessionId);
      const decoded = body.value.base64Encoded ? atob(body.value.body) : body.value.body;
      await execute('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }, { name: 'X-Probe', value: 'fulfilled' }],
        body: btoa(`${decoded}:transformed`),
      }, event.value.sessionId);
      return { event: event.value, body };
    }
    const transform = transformPausedResponse();
    const requests = execute('Runtime.evaluate', {
      expression: `Promise.all(['/selected?phase=active', '/unmatched?phase=active'].map(async (path) => {
        const response = await fetch(path);
        return { path, status: response.status, body: await response.text(), probe: response.headers.get('X-Probe') };
      }))`,
      returnByValue: true,
      awaitPromise: true,
    });
    const [transformed, initialRequests] = await bounded(Promise.all([transform, requests]), 'Response transform');
    subscription.close();
    const fetchDisableCountAfterClose = trace.filter((entry) => entry.method === 'Fetch.disable').length;
    await bridge.client.releaseLease(targetLease);
    targetLease = undefined;
    await bounded(fetchDisabled, 'Fetch disable completion');
    const afterLease = await bridge.client.acquireLease({
      targetId: target.id, targetGeneration: target.generation, durationMilliseconds: 15_000,
      mode: 'exclusive-control', requestedMethods: ['Runtime.evaluate'],
    });
    const afterTargetLease = { targetId: target.id, targetGeneration: target.generation, leaseId: afterLease.id };
    targetLease = afterTargetLease;
    const afterRelease = await bounded(bridge.client.executeCommand({
      ...afterTargetLease,
      operationId: crypto.randomUUID(), method: 'Runtime.evaluate',
      parameters: {
        expression: `fetch('/selected?phase=after-release').then(async (response) => ({ status: response.status, body: await response.text(), probe: response.headers.get('X-Probe') }))`,
        returnByValue: true, awaitPromise: true,
      },
    }), 'Request after release');
    await bridge.client.releaseLease(afterTargetLease);
    targetLease = undefined;
    result = { target, fetchConfiguration, transformed, initialRequests, fetchDisableCountAfterClose, afterRelease, overflowed: subscription.overflowed, droppedCount: subscription.droppedCount };
  } catch (error) {
    failure = { message: error.message, code: error.code, stack: error.stack };
  } finally {
    subscription?.close();
    if (targetLease !== undefined) await bridge.client.releaseLease(targetLease).catch(() => {});
    await publisher.revoke();
    bridge.dispose();
    chrome.debugger.onEvent.removeListener(debuggerListener);
  }
  let afterDetachError;
  try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', { expression: '1' }); }
  catch (error) { afterDetachError = error.message; }
  return { passed: failure === undefined, failure, result, trace, pausedEvents, afterDetachError, listenerRemoved: !chrome.debugger.onEvent.hasListener(debuggerListener) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('control.html')) return false;
  if (message?.kind !== 'run' || typeof message.targetUrl !== 'string') return false;
  runProbe(message.targetUrl).then(respond, (error) => respond({ passed: false, error: String(error) }));
  return true;
});
