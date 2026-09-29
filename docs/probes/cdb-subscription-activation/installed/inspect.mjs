import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repository = '/Users/dinh-van.colomban/Workspace/private/devkit-extension';
const expectedPatchHash = '4c884d928efbd1c3c72f51e95e01cd51abef4285ddc314a94f0d624b08638c5c';
const coreRoot = await realpath('node_modules/@dvcol/cdb');
const extensionRoot = await realpath('node_modules/@dvcol/cdb-extension');
const coreManifest = JSON.parse(await readFile(`${coreRoot}/package.json`, 'utf8'));
const extensionManifest = JSON.parse(await readFile(`${extensionRoot}/package.json`, 'utf8'));
const brokerFiles = (await readdir(`${coreRoot}/dist`)).filter((name) => /^broker-.*\.js$/u.test(name));
assert.equal(brokerFiles.length, 1);
const brokerPath = `${coreRoot}/dist/${brokerFiles[0]}`;
const brokerBytes = await readFile(brokerPath);
const brokerSource = brokerBytes.toString('utf8');
const patchPath = `${repository}/patches/@dvcol__cdb@0.3.0.patch`;
const patchBytes = await readFile(patchPath);
const patchSha256 = createHash('sha256').update(patchBytes).digest('hex');
assert.equal(coreManifest.version, '0.3.0');
assert.equal(extensionManifest.version, '0.3.0');
assert.equal(patchSha256, expectedPatchHash);
assert.ok(coreRoot.includes(expectedPatchHash));
const subscriptionStart = brokerSource.indexOf('async subscribe(request');
const sinkIndex = brokerSource.indexOf('subscriptions.set(id', subscriptionStart);
const activationIndex = brokerSource.indexOf('await incrementDomainDemand(target, demand, request.sessionId)', subscriptionStart);
assert.ok(subscriptionStart >= 0 && sinkIndex >= subscriptionStart && activationIndex > sinkIndex);
const publicEntries = {};
for (const specifier of ['@dvcol/cdb/embedded', '@dvcol/cdb-extension']) publicEntries[specifier] = await realpath(fileURLToPath(import.meta.resolve(specifier)));
const evidence = {
  checkedAt: new Date().toISOString(), nodeVersion: process.version,
  coreVersion: coreManifest.version, extensionVersion: extensionManifest.version,
  coreRoot, extensionRoot, publicEntries,
  patchPath, patchSha256, brokerPath,
  brokerSha256: createHash('sha256').update(brokerBytes).digest('hex'),
  eventSinkPrecedesActivation: true,
  aliases: [],
};
await writeFile('dependency-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.info(JSON.stringify(evidence));
