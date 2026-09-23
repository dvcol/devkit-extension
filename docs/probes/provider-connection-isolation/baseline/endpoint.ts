import assert from 'node:assert/strict';
import { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { initHub } from '@devframes/hub/initiate';
import { createHubContext } from '@devframes/hub/node';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';
import { createDefineWrapperWithContext } from 'devframe/rpc';
import type { DevframeNodeContext, DevframeRpcServerFunctions } from 'devframe';
import { s } from 'devframe/utils/simple-schema';
import type { PreviewServer } from 'vite';
const defineRpc = createDefineWrapperWithContext<DevframeNodeContext>();
async function createCounter(context: DevframeNodeContext, endpoint: string, credential: string) {
  const receipts: ReturnType<DevframeRpcServerFunctions['probe:receipt']>[] = [];
  const issuedCredentials = new Set<string>();
  const state = await context.rpc.sharedState.get<{ endpoint: string; value: number }>(
    'probe:counter',
    { initialValue: { endpoint, value: 0 } },
  );
  function receipt() {
    const token = context.rpc.getCurrentRpcSession()?.meta.clientAuthToken;
    let credentialKind = 'unknown';
    if (token === credential) credentialKind = 'static';
    else if (typeof token === 'string' && issuedCredentials.has(token)) credentialKind = 'issued';
    const current = { endpoint, value: state.value().value, credentialKind };
    receipts.push(current);
    return current;
  }
  const receiptSchema = s.object({
    endpoint: s.string(),
    value: s.number(),
    credentialKind: s.string(),
  });
  context.rpc.register(
    defineRpc({
      name: 'probe:increment',
      type: 'action',
      args: [s.number()] as const,
      returns: receiptSchema,
      jsonSerializable: true,
      handler(amount) {
        state.mutate((current) => {
          current.value += amount;
        });
        return receipt();
      },
    }),
  );
  context.rpc.register(
    defineRpc({
      name: 'probe:receipt',
      type: 'query',
      args: [] as const,
      returns: receiptSchema,
      jsonSerializable: true,
      handler: receipt,
    }),
  );
  return { receipts, issuedCredentials, state };
}

export async function createEndpoint(
  server: PreviewServer,
  endpoint: string,
  base: string,
  credential: string,
  resolveOrigin: () => string,
) {
  const context = await createHubContext({
    cwd: import.meta.dirname,
    mode: 'dev',
    host: {
      mountStatic() {
        throw new Error('This headless probe does not mount devframe assets');
      },
      resolveOrigin,
      getStorageDir: (scope) => join(import.meta.dirname, 'storage', endpoint, scope),
    },
  });
  const { receipts, issuedCredentials, state } = await createCounter(context, endpoint, credential);
  let code: string | undefined;
  const auth = createInteractiveAuth(context, {
    clientAuthTokens: [credential],
    banner(info) {
      code = info.code;
    },
    onTrusted(info) {
      issuedCredentials.add(info.authToken);
    },
  });
  const hub = initHub({
    context,
    base,
    auth,
    mcp: false,
    register: false,
    sse: false,
    origin: resolveOrigin,
  });
  assert.ok(server.httpServer instanceof HttpServer);
  const detach = hub.attach(server.httpServer);
  server.middlewares.use(hub.nodeMiddleware);
  await hub.ready;
  return { endpoint, hub, detach, receipts, value: () => state.value().value, code: () => code };
}
