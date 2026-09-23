import assert from 'node:assert/strict';
import { styleText } from 'node:util';

import { runDevframeDemo, runDevToolsDemo } from '@devkit/example-server-contexts';

const demos = [
  { expectedHost: 'devframe', runDemo: runDevframeDemo },
  { expectedHost: 'devtools', runDemo: runDevToolsDemo },
];

for (const { expectedHost, runDemo } of demos) {
  const result = await runDemo();
  assert.equal(result.host, expectedHost);
  assert.equal(result.provider.id, `example.${expectedHost}-server`);
  assert.match(result.provider.incarnation, /^[\da-f-]{36}$/u);
  assert.equal(result.provider.realm.id, 'devserver');
  assert.equal(result.execution.id, 'devkit.server');
  assert.deepEqual(result.native, {
    devframe: true,
    hub: true,
    devtools: expectedHost === 'devtools',
  });
  assert.equal(result.firstActionValue, 3);
  assert.equal(result.firstReadValue, 3);
  assert.deepEqual(result.disabled, {
    service: 'inactive',
    action: 'waiting',
    commandRegistered: false,
  });
  assert.deepEqual(result.enabled, {
    service: 'ready',
    plugin: 'ready',
    incarnation: result.provider.incarnation,
    commandRegistered: true,
  });
  assert.equal(result.secondActionValue, 7);
  assert.equal(result.commandValue, 7);
  assert.deepEqual(result.disposed, {
    service: 'disposed',
    plugin: 'disposed',
    commandRegistered: false,
    retainedHostState: 7,
  });
  console.info(
    styleText('green', '🚀 [server-contexts]'),
    'Executable checks passed:',
    result.host,
  );
}
