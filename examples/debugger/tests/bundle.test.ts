import { build } from 'vite';
import { expect, it } from 'vitest';

it.each([
  { mode: 'production', permissions: ['debugger', 'tabs'] },
  { mode: 'firefox', permissions: [] },
])(
  'bundles only browser-compatible released CDB entry points in $mode',
  async ({ mode, permissions }) => {
    expect.assertions(4);
    const { modules, imports, manifest } = await inspectBundle(mode);
    expect(
      modules.filter((id) => /(?:^node:|browser-external|@modelcontextprotocol)/u.test(id)),
    ).toEqual([]);
    expect(imports).toEqual([]);
    expect(modules).toEqual(
      expect.arrayContaining([expect.stringMatching(/@dvcol\/cdb\/dist\/embedded\.js$/u)]),
    );
    expect(manifest).toMatchObject({ permissions });
  },
);

async function inspectBundle(mode: string) {
  const modules: string[] = [];
  const imports: string[] = [];
  let manifest: unknown;
  await build({
    configFile: './vite.config.ts',
    mode,
    logLevel: 'silent',
    build: { write: false },
    plugins: [
      {
        name: 'inspect-debugger-bundle',
        enforce: 'post',
        generateBundle(_options, bundle) {
          modules.push(...this.getModuleIds());
          for (const output of Object.values(bundle)) {
            if (output.type === 'chunk') imports.push(...output.imports, ...output.dynamicImports);
            if (output.type !== 'asset' || output.fileName !== 'manifest.json') continue;
            const source =
              typeof output.source === 'string'
                ? output.source
                : new TextDecoder().decode(output.source);
            manifest = JSON.parse(source) as unknown;
          }
        },
      },
    ],
  });
  return { modules, imports, manifest };
}
