import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, version } from '/private/tmp/devkit-host-constraints-20260924/patched/node_modules/vite/dist/node/index.js';
import { defineService } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/core/dist/index.js';
import { counterCapability } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/contribution/dist/index.js';
import { counterService } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/server-contexts/dist/index.js';
import { serverExecution } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/server/dist/index.js';
import { providerFromVite } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/vite-hosts/dist/index.js';
const results = { vite: version, node: process.version, cases: [] };
for (const host of ['devframe', 'devtools']) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'devkit-failed-restart-')));
  const configFile = join(directory, 'vite.config.mts');
  const clientFile=join(directory,'client.js');
  await writeFile(clientFile,'export const value = 1;\n');
  globalThis.__devkitProbe = { servers: [], events: [] };
  await writeFile(configFile, `import { counterHostPlugins } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/vite-hosts/dist/index.js';
export default async () => ({plugins: [{name:'candidate-trace',configureServer(server){const generation=globalThis.__devkitProbe.servers.length+1;globalThis.__devkitProbe.servers.push(server);globalThis.__devkitProbe.events.push('configure:'+generation);},closeServer({reason}){globalThis.__devkitProbe.events.push('close:'+reason);if(reason==='close')throw new Error('Candidate close sentinel');}},...await counterHostPlugins('${host}')]});\n`);
  const server = await createServer({root:directory,configFile,logLevel:'silent',publicDir:false,server:{host:'127.0.0.1',port:0,watch:{},hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
  let candidate;
  try {
    await server.listen();
    const provider = await providerFromVite(server);
    await provider.services.replace(provider.startup.services[0].handle, defineService(counterCapability, {id:'example.failed-restart',execution:serverExecution,setup(context){ context.scope.onDispose(() => {throw new Error('Cleanup probe sentinel');});return counterService.setup(context);}}));
    const oldConfig = server.config;
    let rejection;let rejectionDetails;
    try {await server.restart();} catch(error){rejection=error.message;rejectionDetails=error.errors?.map(nested=>nested.message);}
    assert.equal(rejection,'Restart and candidate cleanup failed');assert.deepEqual(rejectionDetails,['Provider cleanup is blocked','Candidate close sentinel']);
    candidate=globalThis.__devkitProbe.servers[1];
    assert.ok(candidate);
    assert.equal(server.config,oldConfig);
    let candidateReadiness='pending';
    providerFromVite(candidate).then(() => {candidateReadiness='resolved'}, () => {candidateReadiness='rejected'});
    await Promise.resolve();
    assert.equal(candidate.watcher.closed,true);
    assert.equal(candidateReadiness,'rejected');
    const beforeManualClose={events:[...globalThis.__devkitProbe.events],watchedDirectoryCount:Object.keys(candidate.watcher.getWatched()).length,oldListening:server.httpServer.listening,candidateListening:candidate.httpServer.listening,candidateWatcherClosed:candidate.watcher.closed,candidateReadiness,candidateListeningCallbacks:candidate.httpServer.listenerCount('listening')};
    assert.equal(candidateReadiness,'rejected');
    assert.equal(globalThis.__devkitProbe.events.filter(event=>event.startsWith('close')).length,2);
    await candidate.close().catch(()=>{});
    await Promise.resolve();
    const afterManualClose={events:[...globalThis.__devkitProbe.events],watchedDirectoryCount:Object.keys(candidate.watcher.getWatched()).length,candidateWatcherClosed:candidate.watcher.closed,candidateReadiness,candidateListeningCallbacks:candidate.httpServer.listenerCount('listening')};
    assert.equal(candidateReadiness,'rejected');
    assert.equal(afterManualClose.candidateListeningCallbacks,beforeManualClose.candidateListeningCallbacks);
    results.cases.push({host,rejection,rejectionDetails,beforeManualClose,afterManualClose});
  } finally {
    await candidate?.close().catch(()=>{});
    await server.close().catch(()=>{});
    await rm(directory,{recursive:true,force:true});
  }
}
console.info(JSON.stringify(results,null,2));
