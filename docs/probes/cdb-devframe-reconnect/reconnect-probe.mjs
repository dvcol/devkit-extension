import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCdbConnection } from '@dvcol/cdb-devframe/connection';
import { createCdbClient } from '@dvcol/cdb-devframe/client';
import { RpcFunctionsCollectorBase } from 'devframe/rpc';
import { createScopedClientContext } from 'devframe/client';

const unexpectedTransportCalls = [];
function unexpected(method) {
  return (...parameters) => {
    unexpectedTransportCalls.push({ method, parameters });
    throw new Error(`Unexpected transport call: ${method}`);
  };
}
function peerFixture() {
  const collector = new RpcFunctionsCollectorBase({});
  collector.register({ name: 'fixture:echo', type: 'query', handler: (value) => value });
  const peer = {
    client: collector,
    call: unexpected('call'),
    callEvent: unexpected('callEvent'),
    callOptional: unexpected('callOptional'),
    close: unexpected('close'),
    sharedState: { get: unexpected('sharedState.get') },
    streaming: {},
    scope(namespace) { return createScopedClientContext(peer, namespace); },
  };
  return { collector, peer };
}
const expectedNames = ['fixture:echo', 'cdb:broker:state-changed', 'cdb:broker:provider-frame', 'cdb:broker:provider-closed'];
const same = peerFixture();
const connection = createCdbConnection();
connection.attach(same.peer);
assert.equal(connection.status, 'connected');
assert.deepEqual(same.collector.list(), expectedNames);
connection.disconnected();
assert.equal(connection.status, 'disconnected');
assert.deepEqual(same.collector.list(), expectedNames);
let observedError;
try { connection.attach(same.peer); } catch (error) { observedError = error; }
assert.ok(observedError instanceof Error);
assert.match(observedError.message, /already registered/);
assert.match(observedError.message, /cdb:broker:state-changed/);
assert.equal(connection.status, 'disconnected');
await connection.dispose();

const first = peerFixture();
const replacement = peerFixture();
const freshConnection = createCdbConnection();
freshConnection.attach(first.peer);
freshConnection.disconnected();
freshConnection.attach(replacement.peer);
assert.equal(freshConnection.status, 'connected');
assert.deepEqual(first.collector.list(), expectedNames);
assert.deepEqual(replacement.collector.list(), expectedNames);
await freshConnection.dispose();
assert.equal(freshConnection.status, 'disposed');

const direct = peerFixture();
const directClient = createCdbClient(direct.peer);
directClient.disconnected();
assert.equal(createCdbClient(direct.peer), directClient);
assert.deepEqual(direct.collector.list(), expectedNames);
await directClient.dispose();
assert.deepEqual(unexpectedTransportCalls, []);

const sourceImports = ['@dvcol/cdb-devframe/client', '@dvcol/cdb-devframe/connection', 'devframe/rpc', 'devframe/client', '@dvcol/cdb'];
const imports = [];
for (const specifier of sourceImports) {
 const path = await realpath(fileURLToPath(import.meta.resolve(specifier)));
 const contents = await readFile(path);
 imports.push({ specifier, path, sha256: createHash('sha256').update(contents).digest('hex') });
}
const receipt = {
  date: new Date().toISOString(), node: process.version,
  scope: 'Registration-boundary reproduction using released CDB and real installed public Devframe collector/scoped client context. No socket, browser, authentication, or reconnection transport was exercised.',
  versions: { cdbDevframe: JSON.parse(await readFile(new URL('./package/package.json', import.meta.url), 'utf8')).version, devframe: JSON.parse(await readFile(new URL('./node_modules/devframe/package.json', import.meta.url), 'utf8')).version },
  imports,
  samePeer: { firstAttach: 'connected', afterDisconnect: 'disconnected', secondAttach: { name: observedError.name, message: observedError.message, stack: observedError.stack, code: observedError.code }, registeredNames: same.collector.list() },
  freshPeer: { replacement: 'connected', cleanup: freshConnection.status, firstNames: first.collector.list(), replacementNames: replacement.collector.list() },
  directClient: { sameObjectAfterDisconnected: true, registeredNames: direct.collector.list() },
  unexpectedTransportCalls,
};
await writeFile(new URL('./reconnect-receipt.json', import.meta.url), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
