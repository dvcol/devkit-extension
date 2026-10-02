import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { checkNativeBackend } from './remote/backend.ts';
import { createNativeDevToolsHost } from './remote/devtools-host.ts';
import { checkChildSessions } from './remote/child-sessions.ts';

const host = await createNativeDevToolsHost();
assert.equal(await host.hub.context, host.context);
const receipt = await checkNativeBackend(host);
const childSessions = await checkChildSessions(await createNativeDevToolsHost());
assert.deepEqual(childSessions.hostErrors, []);
assert.deepEqual(childSessions.pageErrors, []);
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/devtools-backend.json',
  JSON.stringify({ backend: 'native-devtools', ...receipt, childSessions }, null, 2) + '\n',
);
console.info(
  styleText('green', '🧪 [debugger/devtools]'),
  'Authenticated CDB contribution, child sessions and cleanup through the actual DevTools backend passed',
  receipt.browserVersion,
);
