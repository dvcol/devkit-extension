import assert from 'node:assert/strict';
import { styleText } from 'node:util';
import { runRoutingDemo } from '@devkit/example-server-contexts';

const result = await runRoutingDemo();
assert.equal(result.first, 3);
assert.equal(result.fallback, 4);
assert.equal(result.callback, 6);
assert.equal(result.rejected.code, 'unmatched-selection');
assert.match(result.rejected.message, /not dispatched.*missing/u);
assert.deepEqual(result.rejected.selectors, [{ realm: 'devserver', provider: 'missing' }]);
assert.deepEqual(
  result.beforeBroadcast.map((outcome) => {
    assert.equal(outcome.status, 'fulfilled');
    return outcome.value;
  }),
  [3, 6],
);
assert.deepEqual(
  result.broadcast.map((outcome) => {
    assert.equal(outcome.status, 'fulfilled');
    return { provider: outcome.provider.id, value: outcome.value };
  }),
  [
    { provider: 'example.devframe-server', value: 4 },
    { provider: 'example.devtools-server', value: 7 },
  ],
);
assert.deepEqual(result.retained, [4, 7]);
console.info(
  styleText('green', '🚀 [server-routing]'),
  'Two native hosts passed routing, broadcast preflight and retained ownership checks.',
);
