import { styleText } from 'node:util';

import { runRemoteDemo } from '@devkit/example-server-contexts';

for (const mode of ['devframe', 'devtools'] as const) {
  const result = await runRemoteDemo(mode);
  console.info(styleText('cyan', '🚀 [native-remote]'), result);
}
