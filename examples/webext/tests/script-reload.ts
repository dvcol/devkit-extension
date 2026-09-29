import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Edit the owned fixture's actual imported source so WXT selects its native reload behavior. */
export async function updateTimingScript(fixture: string): Promise<void> {
  const path = join(fixture, 'src/script-timing.ts');
  const original = await readFile(path, 'utf8');
  const updated = original.replace(
    'export function recordScriptTiming(): void {',
    "export function recordScriptTiming(): void {\n  Reflect.set(globalThis, 'exampleScriptRevision', 'updated');",
  );
  assert.notEqual(updated, original);
  await writeFile(path, updated);
}

export function timingRegistrations() {
  return chrome.scripting.getRegisteredContentScripts({ ids: ['example-script-timing'] });
}

/** Serialized into the page by either driver; no imported functions or extension APIs. */
export function scriptDocument() {
  const revision: unknown = Reflect.get(globalThis, 'exampleScriptRevision');
  const injectedGlobal: unknown = Reflect.get(globalThis, 'exampleScriptTiming');
  return {
    timeOrigin: performance.timeOrigin,
    firstScript: JSON.parse(document.documentElement.dataset.firstScript ?? 'null') as unknown,
    injectedGlobal: injectedGlobal ?? null,
    revision: revision ?? null,
  };
}
