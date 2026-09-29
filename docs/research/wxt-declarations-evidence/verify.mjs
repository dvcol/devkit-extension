import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const configurations = ['minimum/tsconfig.with-chrome.json', 'minimum/tsconfig.without-chrome.json', 'tsconfig.with-chrome.json', 'tsconfig.without-chrome.json'];
const results = [];
function execute(label, arguments_) {
  const result = spawnSync('pnpm', arguments_, { encoding: 'utf8' });
  writeFileSync('logs/' + label + '.log', result.stdout + result.stderr);
  results.push({ label, arguments: ['pnpm', ...arguments_], status: result.status });
  if (result.status !== 0) throw new Error(label + ' failed; inspect logs/' + label + '.log');
  return result.stdout;
}
for (const [index, configuration] of configurations.entries()) {
  const compilerConfiguration = JSON.parse(execute('final-configuration-' + index, ['exec', 'tsc', '--showConfig', '-p', configuration]));
  if (compilerConfiguration.compilerOptions.skipLibCheck !== false || compilerConfiguration.compilerOptions.strict !== true) throw new Error('Strict declaration checks were disabled');
}
for (const browser of ['chrome', 'firefox']) {
  execute('final-prepare-' + browser, ['exec', 'node', '--input-type=module', '-e', 'import { prepare } from "wxt"; await prepare({ browser: ' + JSON.stringify(browser) + ', manifestVersion: 3 });']);
  for (const [index, configuration] of configurations.entries()) execute('final-' + browser + '-' + index, ['exec', 'tsc', '--noEmit', '-p', configuration]);
}
writeFileSync('results.json', JSON.stringify(results, null, 2) + '\n');
console.info('Passed all eight strict declaration checks after fresh Chrome/Firefox preparation; strict options confirmed in all four configurations.');
