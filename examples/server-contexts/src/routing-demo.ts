import { styleText } from 'node:util';
import { runRoutingDemo } from './routing.js';

console.info(
  styleText('cyan', '🚀 [server-routing]'),
  JSON.stringify(await runRoutingDemo(), null, 2),
);
