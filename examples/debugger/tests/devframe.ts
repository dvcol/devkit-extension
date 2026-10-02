import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { checkNativeBackend } from './remote/backend.ts';
import { checkNativeDevTools } from './remote/devtools.ts';
import { createNativeHost } from './remote/host.ts';

const receipt = await checkNativeBackend(await createNativeHost());
await mkdir('artifacts', { recursive: true });
receipt.checks.push({
  name: 'Native DevTools opening and closing preserves CDB operations in both attachment orders',
  details: await checkNativeDevTools(),
});
await writeFile('artifacts/devframe.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(
  styleText('green', '🧪 [debugger/devframe]'),
  'Authenticated native browser operation and cleanup passed',
  receipt.browserVersion,
);
