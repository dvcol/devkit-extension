import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { checkNativeBackend } from './remote/backend.ts';
import { createNativeDevToolsHost } from './remote/devtools-host.ts';

const host = await createNativeDevToolsHost();
assert.equal(await host.hub.context, host.context);
const receipt = await checkNativeBackend(host);
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/devtools-backend.json',
  JSON.stringify({ backend: 'native-devtools', ...receipt }, null, 2) + '\n',
);
console.info(
  styleText('green', '🧪 [debugger/devtools]'),
  'Authenticated CDB contribution and cleanup through the actual DevTools backend passed',
  receipt.browserVersion,
);
