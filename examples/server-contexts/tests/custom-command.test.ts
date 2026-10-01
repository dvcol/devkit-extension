import { runDevframeDemo, runDevToolsDemo } from '@devkit/example-server-contexts';
import { describe, expect, it } from 'vitest';

describe.each([
  { host: 'devframe', runDemo: runDevframeDemo },
  { host: 'devtools', runDemo: runDevToolsDemo },
])('$host custom contribution kind', ({ runDemo }) => {
  it('registers the native command, disables, reenables and disposes it', async () => {
    expect.assertions(1);
    const result = await runDemo();
    expect(result.customCommand).toEqual({
      initial: { status: 'ready', result: 'Hello from a custom contribution' },
      disabled: { status: 'inactive', registered: false },
      reenabled: { status: 'ready', result: 'Hello from a custom contribution' },
      disposed: { status: 'disposed', registered: false },
    });
  });
});
