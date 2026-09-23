import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { createServer, version } from './node_modules/vite/dist/node/index.js';
const directory = await mkdtemp(join(tmpdir(), 'devkit-vite-hook-trace-'));
const results = { vite: version, node: process.version, cases: [] };
function configuration(plugins) {
  return { root: directory, configFile: false, publicDir: false, appType: 'custom', logLevel: 'silent', server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins };
}
async function traceRestart() {
  const events = [];
  const bundleEntered = Promise.withResolvers();
  const bundleRelease = Promise.withResolvers();
  const closeEntered = Promise.withResolvers();
  const closeRelease = Promise.withResolvers();
  let setups = 0;
  let pausing = false;
  let restartSettled = false;
  const server = await createServer(configuration([{
    name: 'public-hook-trace',
    async configureServer() {
      setups += 1;
      const generation = setups;
      events.push(`configure:${generation}:start`);
      await Promise.resolve();
      events.push(`configure:${generation}:setup-complete`);
      return () => { events.push(`configure:${generation}:post`); };
    },
    buildEnd() { events.push(`buildEnd:${this.environment.name}`); },
    async closeBundle() {
      events.push(`closeBundle:${this.environment.name}:start`);
      if (pausing && this.environment.name === 'client') {
        bundleEntered.resolve();
        await bundleRelease.promise;
      }
      events.push(`closeBundle:${this.environment.name}:end`);
    },
    async closeServer({ reason }) {
      events.push(`closeServer:${reason}:start`);
      if (reason === 'restart') {
        closeEntered.resolve();
        await closeRelease.promise;
      }
      events.push(`closeServer:${reason}:end`);
    },
  }]));
  try {
    await server.listen();
    events.push('initial:listening');
    pausing = true;
    const restarting = server.restart().then(() => { restartSettled = true; events.push('restart:resolved'); });
    await bundleEntered.promise;
    assert.equal(setups, 2);
    assert.equal(restartSettled, false);
    assert.equal(events.some((event) => event.startsWith('closeServer:restart')), false);
    const beforeBundleRelease = [...events];
    bundleRelease.resolve();
    await closeEntered.promise;
    assert.equal(restartSettled, false);
    closeRelease.resolve();
    await restarting;
    pausing = false;
    await server.close();
    results.cases.push({ name: 'restart-order', beforeBundleRelease, events, assertions: { newSetupBeforeOldCleanup: true, awaitedCloseBundle: true, awaitedCloseServer: true }, listeningAfterClose: server.httpServer?.listening });
  } finally {
    bundleRelease.resolve();
    closeRelease.resolve();
    pausing = false;
    await server.close();
  }
}
async function traceFailure(hookName) {
  const events = [];
  const sentinel = new Error(`${hookName}-sentinel`);
  const server = await createServer(configuration([{
    name: `public-${hookName}-failure`,
    closeBundle() { events.push('closeBundle'); if (hookName === 'closeBundle') throw sentinel; },
    closeServer() { events.push('closeServer'); if (hookName === 'closeServer') throw sentinel; },
  }]));
  await server.listen();
  let outcome;
  try { await server.close(); outcome = 'resolved'; }
  catch (error) { assert.equal(error, sentinel); outcome = 'rejected-with-original'; }
  assert.equal(outcome, hookName === 'closeBundle' ? 'resolved' : 'rejected-with-original');
  assert.equal(server.httpServer?.listening, false);
  results.cases.push({ name: `${hookName}-failure`, outcome, events, listeningAfterClose: false });
}
try {
  await traceRestart();
  await traceFailure('closeBundle');
  await traceFailure('closeServer');
  console.info(styleText('cyan', '🧪 [vite-hook-trace]'), JSON.stringify(results, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
