import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { styleText } from 'node:util';
import { checkChildSessions } from './remote/child-sessions.ts';

const receipt = await checkChildSessions();
assert.deepEqual(receipt.hostErrors, []);
assert.deepEqual(receipt.pageErrors, []);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/child-sessions.json', JSON.stringify(receipt, null, 2) + '\n');
console.info(
  styleText('green', '🧪 [debugger/child-sessions]'),
  'Native child routing and cleanup passed',
  receipt.browserVersion,
);
