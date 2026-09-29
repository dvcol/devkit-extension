import { createEmbeddedChromeDebuggerBridge } from '@dvcol/cdb/embedded';
import { createSelectedTabPublisher } from '@dvcol/cdb-extension';

async function runProbe(targetUrl) {
  const trace = [];
  const bridge = createEmbeddedChromeDebuggerBridge();
  const nativePort = {
    async attach(target, version) {
      trace.push({ method: 'attach', target });
      await chrome.debugger.attach(target, version);
    },
    async detach(target) {
      trace.push({ method: 'detach', target });
      await chrome.debugger.detach(target);
    },
    async sendCommand(target, method, parameters) {
      const record = { method, target, status: 'pending' };
      trace.push(record);
      try {
        const result = await chrome.debugger.sendCommand(target, method, parameters) ?? {};
        record.status = 'fulfilled';
        return result;
      } catch (error) { record.status = 'rejected'; throw error; }
    },
  };
  const publisher = createSelectedTabPublisher({
    scopeId: crypto.randomUUID(),
    capabilities: { level: 'debug', allow: ['Runtime.evaluate', 'Runtime.consoleAPICalled'] },
    chromeDebugger: nativePort,
    publishTarget: bridge.broker.publishTarget,
    updateTarget: bridge.broker.updateTarget,
    revokeTarget: (target, reason) => bridge.broker.revokeTarget(target.id, target.generation, reason),
    publishEvent: bridge.broker.publishEvent,
    registerTargetExecutor: bridge.registerTargetExecutor,
  });
  const debuggerListener = (source, method, parameters) => publisher.debuggerEvent(source, method, parameters);
  chrome.debugger.onEvent.addListener(debuggerListener);
  const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === targetUrl);
  if (tab?.id === undefined) throw new Error('Owned fixture tab not found');
  let subscription;
  let result;
  try {
    const target = await publisher.publish({ tabId: tab.id, incognito: tab.incognito, url: targetUrl, title: 'Owned CDB fixture' });
    const lease = await bridge.client.acquireLease({
      targetId: target.id,
      targetGeneration: target.generation,
      durationMilliseconds: 30_000,
      mode: 'exclusive-control',
      requestedMethods: ['Runtime.evaluate', 'Runtime.consoleAPICalled'],
    });
    const targetLease = { targetId: target.id, targetGeneration: target.generation, leaseId: lease.id };
    subscription = await bridge.client.subscribe({
      ...targetLease,
      match: { method: 'Runtime.consoleAPICalled' },
      buffer: { capacity: 10, overflowStrategy: 'disconnect' },
    });
    const eventPromise = nextEvent(subscription);
    const command = await bridge.client.executeCommand({
      ...targetLease,
      operationId: crypto.randomUUID(),
      method: 'Runtime.evaluate',
      parameters: { expression: 'console.log("cdb-owned-fixture-event"); 6 * 7', returnByValue: true },
    });
    const event = await eventPromise;
    const nativeWhileSubscribed = await nativePort.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', { expression: '6 * 9', returnByValue: true });
    subscription.close();
    await bridge.client.releaseLease(targetLease);
    bridge.client.dispose();
    let disposedClientError;
    try { await bridge.client.listTargets(); } catch (error) { disposedClientError = error.message; }
    const nativeAfterClientDisposal = await nativePort.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', { expression: '7 * 9', returnByValue: true });
    result = { target, leaseMode: lease.mode, command, event, nativeWhileSubscribed, nativeAfterClientDisposal, disposedClientError };
  } finally {
    subscription?.close();
    try { await publisher.revoke(); }
    finally {
      bridge.dispose();
      chrome.debugger.onEvent.removeListener(debuggerListener);
    }
  }
  const debuggingTargets = await chrome.debugger.getTargets();
  let nativeAfterDetachError;
  try { await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', { expression: '1' }); }
  catch (error) { nativeAfterDetachError = error.message; }
  let disposedBrokerError;
  try { bridge.broker.listTargets(); } catch (error) { disposedBrokerError = error.message; }
  await publisher.revoke();
  bridge.dispose();
  return { ...result, trace, nativeAfterDetachError, disposedBrokerError, targetHasAnyDebugger: debuggingTargets.find((target) => target.tabId === tab.id)?.attached, listenerRemoved: !chrome.debugger.onEvent.hasListener(debuggerListener) };
}

async function nextEvent(subscription) {
  let timeout;
  try {
    return await Promise.race([
      subscription[Symbol.asyncIterator]().next(),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Native CDB event not received')), 10_000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('control.html')) return false;
  if (message?.kind !== 'run' || typeof message.targetUrl !== 'string') return false;
  runProbe(message.targetUrl).then(
    (result) => respond({ passed: true, result }),
    (error) => respond({ passed: false, error: { message: error.message, code: error.code, stack: error.stack } }),
  );
  return true;
});
