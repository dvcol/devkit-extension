import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview, version } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/node_modules/vite/dist/node/index.js';
import { initHub } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/vite-hosts/node_modules/@devframes/hub/dist/node/initiate.mjs';
import { createDevToolsContext, createDevToolsHub } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/vite-hosts/node_modules/@vitejs/devtools/dist/index.js';
import { increaseCounterAction } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/contribution/dist/index.js';
import { counterActionsPlugin, counterService } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/server-contexts/dist/index.js';
import { installDevframeProvider, installDevToolsProvider } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/packages/server/dist/index.js';
const results = {vite: version,node: process.version,cases:[]};
for (const host of ['devframe','devtools']) {
  const directory=await mkdtemp(join(tmpdir(),'devkit-preview-'));
  await mkdir(join(directory,'dist'));
  await writeFile(join(directory,'dist/index.html'),'<main>Built preview receipt</main>');
  let provider;
  let nativeHost;
  let context;
  const events=[];
  const server=await preview({configFile:false,root:directory,logLevel:'silent',preview:{host:'127.0.0.1',port:0},plugins:[{
    name:'public-preview-host-probe',
    async configurePreviewServer(previewServer) {
      events.push('configure-preview');
      if(host==='devframe') {
        nativeHost=initHub({base:'/__devframes/',cwd:directory,server:previewServer.httpServer,register:false,mcp:false,configure(current){context=current;}});
        await nativeHost.ready;
        provider=await installDevframeProvider(context,{providerId:'example.preview',services:[counterService],plugins:[counterActionsPlugin]});
        previewServer.middlewares.use(nativeHost.nodeMiddleware);
      } else {
        context=await createDevToolsContext(previewServer.config);
        nativeHost=await createDevToolsHub({context,server:previewServer.httpServer,host:'127.0.0.1'});
        provider=await installDevToolsProvider(context,{providerId:'example.preview',services:[counterService],plugins:[counterActionsPlugin]});
        previewServer.middlewares.use(nativeHost.middleware);
      }
      events.push('provider-ready');
    },
    async closePreviewServer() {
      events.push('close-preview');
      try {await provider?.dispose();} finally {await nativeHost?.close();}
      events.push('cleanup-complete');
    }
  }]});
  try {
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    const staticResponse=await fetch(origin);
    assert.equal(await staticResponse.text(),'<main>Built preview receipt</main>');
    const metadata=await fetch(`${origin}/${host==='devframe'?'__devframes':'__devtools'}/__connection.json`);
    assert.equal(metadata.status,200);
    const connection=await metadata.json();
    assert.equal(await provider.invoke(increaseCounterAction,{amount:4}),4);
    assert.equal(context.commands.commands.has('example:read-server-counter'),true);
    await server.close();
    assert.equal(server.httpServer.listening,false);
    assert.equal(context.commands.commands.has('example:read-server-counter'),false);
    assert.equal(provider.startup.services[0].handle.snapshot().status,'disposed');
    results.cases.push({host,staticStatus:staticResponse.status,metadataStatus:metadata.status,connection,providerStatus:provider.startup.services[0].handle.snapshot().status,events});
  } finally {
    await server.close();
    await rm(directory,{recursive:true,force:true});
  }
}
console.info(JSON.stringify(results,null,2));
