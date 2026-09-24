import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const { createLogger, createServer, version } = await import(pathToFileURL(process.argv[2]).href);
const expectFixed = process.argv[3] === 'fixed';
const results = { vite: version, node: process.version, expectFixed, imports: ['Node builtins', 'vite'], cases: [] };
async function until(predicate, message) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  console.error(JSON.stringify({message,events:globalThis.__plainViteProbe?.events}));
  assert.fail(message);
}
for (const trigger of ['programmatic', 'watched-config']) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'plain-vite-failed-restart-')));
  const configFile = join(directory, 'vite.config.mts');
  const clientFile = join(directory, 'client.js');
  globalThis.__plainViteProbe = { nextGeneration: 0, servers: [], events: [], activeTimers: new Set(), watcherErrors: [] };
  const configSource = `export default () => {
    const state = globalThis.__plainViteProbe;
    const generation = ++state.nextGeneration;
    let timer;
    return { devtools: false, plugins: [{
      name: 'ordinary-resource-plugin',
      configureServer(server) {
        state.servers.push(server);
        state.events.push('configure:' + generation);
        server.watcher.on('error', error => state.watcherErrors.push(String(error)));
        timer = setInterval(() => {}, 60000);
        state.activeTimers.add(generation);
      },
      closeServer({ reason }) {
        state.events.push('close:' + generation + ':' + reason);
        clearInterval(timer);
        state.activeTimers.delete(generation);
        if (generation === 1 && reason === 'restart') throw new Error('Ordinary plugin cleanup failure');
      }
    }] };
  };\n`;
  await writeFile(configFile, configSource);
  await writeFile(clientFile, 'export const value = 1;\n');
  const loggedErrors = [];
  const logger = createLogger('silent');
  logger.error = error => loggedErrors.push(String(error));
  const server = await createServer({
    root: directory, configFile, customLogger: logger, logLevel: 'silent', devtools: false,
    publicDir: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, watch: {}, hmr: trigger === 'watched-config' },
  });
  try {
    await server.listen();
    const oldConfig = server.config;
    let rejection;
    if (trigger === 'programmatic') {
      try { await server.restart(); }
      catch (error) { rejection = error.message; }
      assert.equal(rejection, 'Ordinary plugin cleanup failure');
    } else {
      await until(() => server.watcher.getWatched()[directory]?.includes('vite.config.mts'), 'Initial config watcher not ready');
      await delay(200);
      await writeFile(configFile, (await readFile(configFile, 'utf8')) + '// real watched config edit\n');
      await until(() => loggedErrors.some(message => message.includes('Ordinary plugin cleanup failure')), 'Vite did not log failure');
    }
    const candidate = globalThis.__plainViteProbe.servers[1];
    assert.ok(candidate);
    assert.equal(server.config, oldConfig);
    assert.equal(server.httpServer.listening, false);
    assert.equal(candidate.httpServer.listening, false);
    assert.equal(candidate.watcher.closed, expectFixed);
    let observedClientEdit;
    if (!expectFixed) {
      await until(() => Object.hasOwn(candidate.watcher.getWatched(), directory), 'Candidate watcher not ready');
      observedClientEdit = false;
      candidate.watcher.on('change', filename => { if (filename === clientFile) observedClientEdit = true; });
      await writeFile(clientFile, 'export const value = 2;\n');
      await until(() => observedClientEdit, 'Candidate did not observe edit');
      assert.deepEqual([...globalThis.__plainViteProbe.activeTimers], [2]);
    } else {
      assert.deepEqual([...globalThis.__plainViteProbe.activeTimers], []);
      assert.deepEqual(candidate.watcher.getWatched(), {});
    }
    assert.deepEqual(globalThis.__plainViteProbe.watcherErrors, []);
    const beforeManualCleanup = {
      events: [...globalThis.__plainViteProbe.events], candidateWatcherClosed: candidate.watcher.closed,
      watchedDirectories: Object.keys(candidate.watcher.getWatched()).length,
      activePluginTimers: [...globalThis.__plainViteProbe.activeTimers], observedClientEdit,
      oldListening: server.httpServer.listening, candidateListening: candidate.httpServer.listening,
    };
    await candidate.close();
    assert.equal(candidate.watcher.closed, true);
    assert.deepEqual([...globalThis.__plainViteProbe.activeTimers], []);
    results.cases.push({ trigger, rejection, loggedErrors, watcherErrors: [...globalThis.__plainViteProbe.watcherErrors], processContinuedAfterFailure: true, beforeManualCleanup });
  } finally {
    for (const instance of globalThis.__plainViteProbe.servers) await instance.close().catch(() => {});
    await server.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
console.info(JSON.stringify(results, null, 2));
