import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Change only the disposable registration module and expose its native document title. */
export async function updateDevtoolsRegistration(fixture: string): Promise<void> {
  const sourcePath = join(fixture, 'src/devtools.ts');
  const source = await readFile(sourcePath, 'utf8');
  const updated = source.replace("panels.create('Devkit'", "panels.create('Devkit updated'");
  assert.notEqual(updated, source);
  await writeFile(sourcePath, `${updated}\ndocument.title = 'Updated Devkit DevTools';\n`);
}

/** Change the actual registration HTML entry so WXT rebuilds its native output. */
export async function updateDevtoolsRegistrationHtml(fixture: string): Promise<void> {
  const path = join(fixture, 'entrypoints/devtools.html');
  const source = await readFile(path, 'utf8');
  const updated = source.replace('<body>', '<body data-registration-html="updated">');
  assert.notEqual(updated, source);
  await writeFile(path, updated);
}
