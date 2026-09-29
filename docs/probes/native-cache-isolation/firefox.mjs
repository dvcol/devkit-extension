import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'wxt';
import { availablePort, createDevelopmentFixture } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/webext/tests/development-fixture.ts';
import { attachFirefox } from '/Users/dinh-van.colomban/Workspace/private/devkit-extension/examples/webext/tests/firefox-development-observer.ts';

const root = await createDevelopmentFixture();
const marionettePort = await availablePort();
const observations = [];
const failures = [];
let observer;
let phase = 'startup';
const server = await createServer({ root, vite: () => ({ cacheDir: `${root}/.wxt/vite-cache` }), browser: 'firefox', dev: { server: { port: await availablePort() } }, webExt: { firefoxArgs: ['--headless','--marionette','--remote-allow-system-access'], firefoxPref: {'marionette.port':marionettePort} } });
try {
  await server.start();
  for (let iteration=0;iteration<10;iteration++) {
    observer = await attachFirefox(marionettePort);
    const {driver,origin}=observer;
    await driver.get(`${origin}/panel.html`);
    await driver.wait(()=>driver.executeScript("return document.querySelector('#status')?.textContent === 'Connected'"),30000);
    await driver.executeScript("document.querySelector('#identity').click()");
    await driver.wait(()=>driver.executeScript("return document.querySelector('#result').textContent.includes('panel.html')"),10000);
    observations.push(await driver.executeScript(`return {iteration:arguments[0], provider:document.querySelector('#provider').textContent, caller:document.querySelector('#result').textContent, manifest:browser.runtime.getManifest().version}`,iteration));
    if(iteration===9)break;
    phase=`restart-${iteration+1}`;
    const path=`${root}/wxt.config.ts`;
    await writeFile(path,(await readFile(path,'utf8')).replace(`version: '0.0.${iteration+1}'`, `version: '0.0.${iteration+2}'`));
    await observer.dispose();
    observer=undefined;
  }
} catch(error) {
  failures.push({error:String(error),phase,html:await observer?.driver.executeScript('return document.documentElement.outerHTML').catch(error=>String(error))});
  process.exitCode=1;
} finally {
  await writeFile('/private/tmp/devkit-startup-diagnosis/firefox-receipt.json',JSON.stringify({observations,failures},null,2));
  await server.stop();
  await observer?.dispose();
  await rm(root,{recursive:true,force:true});
}
