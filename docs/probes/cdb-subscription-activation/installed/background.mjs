import { createEmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import { createSelectedTabPublisher } from '@dvcol/cdb-extension';

let activeProbe;

async function prepareProbe(targetUrl, scenario) {
  const state = { scenario, trace: [], rawPausedEvents: [], deliveredEvents: [], nativeEnableComplete: false, subscriptionReady: false, errors: [] };
  const bridge = createEmbeddedChromeDebuggerBridge();
  let allowEnableCompletion;
  const enableCompletionGate = new Promise((resolve) => { allowEnableCompletion = resolve; });
  if (scenario !== 'activation-window') allowEnableCompletion();
  const chromeDebugger = {
    async attach(target, version) {
      const record = { method: 'attach', target, startedAt: Date.now(), status: 'pending' };
      state.trace.push(record);
      await chrome.debugger.attach(target, version);
      record.status = 'fulfilled';
      record.completedAt = Date.now();
    },
    async detach(target) {
      const record = { method: 'detach', target, startedAt: Date.now(), status: 'pending' };
      state.trace.push(record);
      await chrome.debugger.detach(target);
      record.status = 'fulfilled';
      record.completedAt = Date.now();
    },
    async sendCommand(target, method, parameters) {
      const nativeParameters = method === 'Fetch.enable' ? { patterns: [{ urlPattern: `${new URL(targetUrl).origin}/selected*`, requestStage: 'Response' }] } : parameters;
      const record = { method, target, parameters: nativeParameters, startedAt: Date.now(), status: 'pending' };
      state.trace.push(record);
      try {
        const result = await chrome.debugger.sendCommand(target, method, nativeParameters) ?? {};
        record.status = 'fulfilled';
        record.completedAt = Date.now();
        if (method === 'Fetch.enable') {
          state.nativeEnableComplete = true;
          await enableCompletionGate;
          state.portEnableCompletedAt = Date.now();
        }
        return result;
      } catch (error) {
        record.status = 'rejected';
        record.error = String(error);
        throw error;
      }
    },
  };
  const publisher = createSelectedTabPublisher({
    scopeId: crypto.randomUUID(), capabilities: { level: 'debug' }, chromeDebugger,
    publishTarget: bridge.broker.publishTarget,
    updateTarget: bridge.broker.updateTarget,
    revokeTarget: (target, reason) => bridge.broker.revokeTarget(target.id, target.generation, reason),
    publishEvent: bridge.broker.publishEvent,
    registerTargetExecutor: bridge.registerTargetExecutor,
  });
  const debuggerListener = (source, method, parameters) => {
    if (method === 'Fetch.requestPaused') state.rawPausedEvents.push({ source, requestId: parameters.requestId, url: parameters.request.url, responseStatusCode: parameters.responseStatusCode, at: Date.now() });
    publisher.debuggerEvent(source, method, parameters);
  };
  chrome.debugger.onEvent.addListener(debuggerListener);
  const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
  if (tab?.id === undefined) throw new Error('Owned fixture tab not found');
  const target = await publisher.publish({ tabId: tab.id, incognito: tab.incognito, url: targetUrl, title: 'Fetch lifecycle fixture' });
  const lease = await bridge.client.acquireLease({
    targetId: target.id, targetGeneration: target.generation,
    durationMilliseconds: 60_000, mode: 'exclusive-control',
    requestedMethods: ['Fetch.requestPaused', 'Fetch.getResponseBody', 'Fetch.fulfillRequest'],
  });
  const targetLease = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
  let subscription;
  let leaseReleased = false;
  let detached = false;
  async function consumeFirstEvent() {
    const iterator = subscription[Symbol.asyncIterator]();
    const result = await iterator.next();
    state.firstIteratorResult = result;
    if (result.done) return;
    state.deliveredEvents.push(result.value);
    if (scenario === 'cancel-after-body-read' || scenario === 'activation-window') {
      const body = await bridge.client.executeCommand({
        ...targetLease,
        operationId: crypto.randomUUID(),
        method: 'Fetch.getResponseBody',
        parameters: { requestId: result.value.parameters.requestId },
        ...(result.value.sessionId === undefined ? {} : { sessionId: result.value.sessionId }),
      });
      state.body = body;
      state.decodedBody = body.value.base64Encoded ? atob(body.value.body) : body.value.body;
      state.bodyCompletedAt = Date.now();
      if (scenario === 'activation-window') {
        await bridge.client.executeCommand({
          ...targetLease,
          operationId: crypto.randomUUID(),
          method: 'Fetch.fulfillRequest',
          parameters: {
            requestId: result.value.parameters.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
            body: btoa(`${state.decodedBody}:candidate`),
          },
        });
        state.fulfilledAt = Date.now();
      }
    }
    state.nextIteratorResult = await iterator.next();
  }
  const subscribing = bridge.client.subscribe({
    ...targetLease,
    match: { method: 'Fetch.requestPaused' },
    buffer: { capacity: 16, overflowStrategy: 'disconnect' },
  });
  subscribing.then((createdSubscription) => {
    subscription = createdSubscription;
    state.subscriptionReady = true;
    state.subscriptionReadyAt = Date.now();
    consumeFirstEvent().catch((error) => state.errors.push({ phase: 'consume', message: error.message, code: error.code }));
  }, (error) => state.errors.push({ phase: 'subscribe', message: error.message, code: error.code }));
  return {
    state,
    releaseEnable() { state.gateReleasedAt = Date.now(); allowEnableCompletion(); },
    close() {
      if (subscription === undefined) throw new Error('Subscription not ready');
      state.subscriptionCloseAt = Date.now();
      subscription.close();
      state.closeReturned = true;
    },
    async releaseLease() {
      state.leaseReleaseStartedAt = Date.now();
      await bridge.client.releaseLease(targetLease);
      leaseReleased = true;
      state.leaseReleaseReturnedAt = Date.now();
    },
    async detach() {
      allowEnableCompletion();
      await subscribing.catch(() => {});
      subscription?.close();
      if (!leaseReleased) await bridge.client.releaseLease(targetLease).catch((error) => state.errors.push({ phase: 'cleanup-release', message: error.message }));
      if (detached) return;
      await publisher.revoke();
      detached = true;
      bridge.dispose();
      chrome.debugger.onEvent.removeListener(debuggerListener);
      state.listenerRemoved = !chrome.debugger.onEvent.hasListener(debuggerListener);
      state.disposedAt = Date.now();
    },
  };
}

async function dispatch(message) {
  if (message.kind === 'prepare') {
    activeProbe = await prepareProbe(message.targetUrl, message.scenario);
    return activeProbe.state;
  }
  if (activeProbe === undefined) throw new Error('Probe not prepared');
  if (message.kind === 'state') return activeProbe.state;
  if (message.kind === 'release-enable') activeProbe.releaseEnable();
  else if (message.kind === 'close') activeProbe.close();
  else if (message.kind === 'release-lease') await activeProbe.releaseLease();
  else if (message.kind === 'detach') await activeProbe.detach();
  else throw new Error(`Unknown message: ${message.kind}`);
  return activeProbe.state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('control.html')) return false;
  dispatch(message).then((value) => respond({ success: true, value }), (error) => respond({ success: false, error: { message: error.message, code: error.code } }));
  return true;
});
