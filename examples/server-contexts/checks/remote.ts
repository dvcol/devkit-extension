import assert from 'node:assert/strict';
import { styleText } from 'node:util';

import { runRemoteDemo } from '@devkit/example-server-contexts';

for (const mode of ['devframe', 'devtools'] as const) {
  const result = await runRemoteDemo(mode);
  assert.equal(result.mode, mode);
  assert.match(result.unauthorized, /not authorized/u);
  assert.deepEqual(result.accepted, { value: 3, trusted: true });
  assert.match(result.invalidInput, /valid/u);
  assert.match(result.disposed, /dispos|unavailable/u);
  assert.equal(result.hostAlive, 'host-alive');
  assert.match(result.stale, /incarnation changed/u);
  assert.deepEqual(result.replaced, { value: 7, trusted: true });
  assert.ok(result.disconnected.length > 0);
  assert.equal(result.clientClosed, true);
  assert.equal(result.serverCompletedAfterDisconnect, true);
  assert.equal(result.nativeMethodCount, 2);
  console.info(styleText('green', '🚀 [native-remote]'), 'Authenticated RPC checks passed:', mode);
}
