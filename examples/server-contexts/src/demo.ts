import { styleText } from 'node:util';

import { runDevframeDemo, runDevToolsDemo } from '@devkit/example-server-contexts';

const mode = process.argv[2];
if (mode !== 'devframe' && mode !== 'devtools')
  throw new Error('Choose devframe or devtools as the demo argument');
const runDemo = mode === 'devframe' ? runDevframeDemo : runDevToolsDemo;
const result = await runDemo();
console.info(styleText('cyan', '🚀 [server-contexts]'), 'Completed local integration:', result);
