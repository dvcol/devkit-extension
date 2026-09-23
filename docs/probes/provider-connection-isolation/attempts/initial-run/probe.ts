import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { initHub } from '@devframes/hub/initiate';
import type { HubInstance } from '@devframes/hub/initiate';
import { createHubContext } from '@devframes/hub/node';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';
import { createDefineWrapperWithContext } from 'devframe/rpc';
import type { DevframeNodeContext } from 'devframe';
import { s } from 'devframe/utils/simple-schema';
import { build, preview } from 'vite';
import type { PreviewServer } from 'vite';
import type { CounterReceipt } from './contracts.js';

const directory = import.meta.dirname;
const credentials = { endpointA: randomBytes(32).toString('hex'), endpointB: randomBytes(32).toString('hex') };
const defineRpc = createDefineWrapperWithContext<DevframeNodeContext>();
const hubs: HubInstance[] = [];
const detachFunctions: (() => void)[] = [];
const serverReceipts: CounterReceipt[] = [];
const serverValues: Record<string, number> = { endpointA: 0, endpointB: 0 };
const result: Record<string, unknown> = { startedAt: new Date().toISOString(), passed: false, nodeVersion: process.version, packages: { devframe: '1.0.0', hub: '1.0.0', kit: '0.7.5', vite: '8.3.0' } };
let previewServer: PreviewServer | undefined;
let origin = 'http://127.0.0.1';
let resolveBrowserResult: (value: Record<string, unknown>) => void;
const browserResult = new Promise<Record<string, unknown>>(resolve => { resolveBrowserResult = resolve; });

function sanitized(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const credential of Object.values(credentials)) message = message.replaceAll(credential, '[credential]');
  return message.replaceAll(directory, '<probe-directory>');
}

async function createEndpoint(server: PreviewServer, endpoint: keyof typeof credentials, base: string): Promise<void> {
  const context = await createHubContext({
    cwd: directory, mode: 'dev', host: {
      mountStatic() { throw new Error('This headless probe does not mount devframe assets'); },
      resolveOrigin: () => origin,
      getStorageDir: scope => join(directory, 'storage', endpoint, scope),
    },
  });
  const state = await context.rpc.sharedState.get('probe:counter', { initialValue: { endpoint, value: 0 } });
  function receipt(): CounterReceipt {
    const value = state.value().value;
    serverValues[endpoint] = value;
    const current = { endpoint, value, credentialMatched: context.rpc.getCurrentRpcSession()?.meta.clientAuthToken === credentials[endpoint] };
    serverReceipts.push(current);
    return current;
  }
  const receiptSchema = s.object({ endpoint: s.string(), value: s.number(), credentialMatched: s.boolean() });
  context.rpc.register(defineRpc({ name: 'probe:increment', type: 'action', args: [s.number()] as const, returns: receiptSchema, jsonSerializable: true,
    handler(amount) { state.mutate(current => { current.value += amount; }); return receipt(); },
  }));
  context.rpc.register(defineRpc({ name: 'probe:receipt', type: 'query', args: [] as const, returns: receiptSchema, jsonSerializable: true, handler: receipt }));
  const auth = createInteractiveAuth(context, { clientAuthTokens: [credentials[endpoint]], banner() { console.info(styleText('yellow', '🧪 [connection-probe]'), 'Unexpected interactive authorization request', endpoint); } });
  const hub = initHub({ context, base, auth, mcp: false, register: false, sse: false, origin: () => origin });
  hubs.push(hub);
  assert.ok(server.httpServer instanceof HttpServer);
  detachFunctions.push(hub.attach(server.httpServer));
  server.middlewares.use(hub.nodeMiddleware);
  await hub.ready;
}

async function main(): Promise<void> {
  await build({ root: directory, configFile: false, logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } });
  previewServer = await preview({ root: directory, configFile: false, logLevel: 'warn', preview: { host: '127.0.0.1', port: 0, strictPort: true }, plugins: [{
    name: 'two-public-hub-connections',
    async configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/__probe-control/bootstrap') {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ credentials }));
          return;
        }
        if (request.url !== '/__probe-control/result' || request.method !== 'POST') return next();
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        request.on('end', () => {
          const received = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          response.setHeader('Content-Type', 'application/json'); response.end('{}');
          resolveBrowserResult(received);
        });
      });
      await createEndpoint(server, 'endpointA', '/__endpoint-a/');
      await createEndpoint(server, 'endpointB', '/__endpoint-b/');
    },
  }] });
  const address = previewServer.httpServer.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(join(directory, 'running.json'), JSON.stringify({ origin, processId: process.pid }));
  console.info(styleText('cyan', '🧪 [connection-probe]'), 'Open built preview:', origin);
  const browser = await browserResult;
  result.browser = browser;
  assert.equal(browser.passed, true);
  assert.deepEqual(serverValues, { endpointA: 7, endpointB: 15 });
  assert.ok(serverReceipts.every(receipt => receipt.credentialMatched));
  result.passed = true;
}

try { await main(); }
catch (error) { result.error = sanitized(error); process.exitCode = 1; }
finally {
  const cleanupErrors: string[] = [];
  for (const detach of detachFunctions) detach();
  for (const hub of hubs) { try { await hub.close(); } catch (error) { cleanupErrors.push(sanitized(error)); } }
  if (previewServer) { try { await previewServer.close(); } catch (error) { cleanupErrors.push(sanitized(error)); } }
  result.cleanup = { hubsClosed: cleanupErrors.length === 0, previewStopped: previewServer ? !previewServer.httpServer.listening : true, errors: cleanupErrors };
  if (cleanupErrors.length > 0) { result.passed = false; process.exitCode = 1; }
  result.serverValues = serverValues;
  result.serverReceipts = serverReceipts;
  result.finishedAt = new Date().toISOString();
  let serialized = JSON.stringify(result, null, 2);
  for (const credential of Object.values(credentials)) serialized = serialized.replaceAll(credential, '[credential]');
  await writeFile(join(directory, 'result.json'), `${serialized}\n`);
  console.info(styleText('cyan', '🧪 [connection-probe]'), serialized);
}
