import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverApi } from './inventory.ts';

describe('public declaration inventory', () => {
  it('discovers reexports, inherited and nested hooks, union members and anonymous factory handles', async () => {
    expect.assertions(5);
    const directory = await mkdtemp(join(tmpdir(), 'devkit-api-inventory-'));
    try {
      await writeFile(join(directory, 'base.d.ts'), 'export interface Base { dispose(): void }');
      const entry = join(directory, 'index.d.ts');
      await writeFile(
        entry,
        `
        import type { Base } from './base.js';
        export type { Base as Reexported } from './base.js';
        declare const brand: unique symbol;
        export interface Client extends Base {
          providers: { attach(): void; subscribe(): void };
          recursive?: Client;
          [brand]: string;
          label: string;
        }
        export type Binding = { native: { get(): void } } | { remote: true };
        export declare const definition: { nested: { install(): void } };
        export declare function createScope(): { cancel(): void; scope: { onDispose(): void } };
        export declare class Controller extends Error {
          private secret;
          protected hidden(): void;
          #private;
          static create(): Controller;
          invoke(): void;
        }
      `,
      );
      const entries = [{ id: '@fixture/api', path: entry }];
      const inventory = discoverApi(entries, directory);
      expect(inventory).toEqual(
        expect.arrayContaining([
          '@fixture/api:Reexported.dispose',
          '@fixture/api:Client.dispose',
          '@fixture/api:Client.providers.attach',
          '@fixture/api:Client.providers.subscribe',
          '@fixture/api:Client.recursive',
          '@fixture/api:Client.[brand]',
          '@fixture/api:Binding.native.get',
          '@fixture/api:Binding.remote',
          '@fixture/api:definition.nested.install',
          '@fixture/api:createScope().cancel',
          '@fixture/api:createScope().scope.onDispose',
          '@fixture/api:Controller.create',
          '@fixture/api:Controller.invoke',
        ]),
      );
      expect(
        inventory.some((item) => /secret|hidden|private|\.stack|\.charAt|__@/u.test(item)),
      ).toBe(false);
      expect(inventory).not.toContain('@fixture/api:Client.recursive.recursive');
      expect(discoverApi(entries, directory)).toEqual(inventory);
      await writeFile(entry, 'export interface Added { activate(): void }');
      expect(discoverApi(entries, directory)).toEqual([
        '@fixture/api:Added',
        '@fixture/api:Added.activate',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
