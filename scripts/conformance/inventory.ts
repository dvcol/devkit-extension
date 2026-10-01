import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { API, ModifierFlags, SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, Symbol as CompilerSymbol, Type } from 'typescript/unstable/sync';
import {
  isGetAccessorDeclaration,
  isMethodDeclaration,
  isMethodSignatureDeclaration,
  isPrivateIdentifier,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isSetAccessorDeclaration,
} from 'typescript/unstable/ast/is';

export interface DeclarationEntry {
  readonly id: string;
  readonly path: string;
}

interface Inspection {
  readonly checker: Checker;
  readonly directory: string;
  readonly items: Set<string>;
}

/** Manifest exports are authoritative, including subpaths and adapter-internal packages. */
export async function declarationEntries(repository: string): Promise<DeclarationEntry[]> {
  const entries: DeclarationEntry[] = [];
  for (const directory of await readdir(join(repository, 'packages'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const packageDirectory = join(repository, 'packages', directory.name);
    const manifest: unknown = JSON.parse(
      await readFile(join(packageDirectory, 'package.json'), 'utf8'),
    );
    assert.ok(
      typeof manifest === 'object' &&
        manifest !== null &&
        'name' in manifest &&
        'exports' in manifest,
    );
    assert.ok(typeof manifest.name === 'string');
    assert.ok(typeof manifest.exports === 'object' && manifest.exports !== null);
    for (const [subpath, value] of Object.entries(manifest.exports)) {
      const conditions: unknown = value;
      assert.ok(!subpath.includes('*'), `Expand wildcard declarations for ${manifest.name}`);
      assert.ok(typeof conditions === 'object' && conditions !== null && 'types' in conditions);
      assert.ok(
        typeof conditions.types === 'string',
        `Missing public declaration entry: ${manifest.name}/${subpath}`,
      );
      const suffix = subpath === '.' ? '' : subpath.slice(1);
      entries.push({
        id: `${manifest.name}${suffix}`,
        path: resolve(packageDirectory, conditions.types),
      });
    }
  }
  return entries.toSorted((left, right) => left.id.localeCompare(right.id));
}

/** Only SDK-owned declarations are expanded; native aliases do not duplicate vendor inventories. */
function publicMemberName(symbol: CompilerSymbol, directory: string): string | undefined {
  for (const handle of symbol.declarations) {
    const declaration = handle.resolve();
    if (
      declaration === undefined ||
      !declaration.getSourceFile().fileName.startsWith(`${directory}${sep}`)
    )
      continue;
    if (
      'modifierFlags' in declaration &&
      typeof declaration.modifierFlags === 'number' &&
      (declaration.modifierFlags & (ModifierFlags.Private | ModifierFlags.Protected)) !== 0
    )
      continue;
    if (
      isPropertySignatureDeclaration(declaration) ||
      isPropertyDeclaration(declaration) ||
      isMethodSignatureDeclaration(declaration) ||
      isMethodDeclaration(declaration) ||
      isGetAccessorDeclaration(declaration) ||
      isSetAccessorDeclaration(declaration)
    ) {
      if (isPrivateIdentifier(declaration.name)) continue;
      /** Compiler symbol IDs change between runs; source names keep computed hooks stable. */
      if (symbol.name.startsWith('__@')) return declaration.name.getText();
    }
    return symbol.name;
  }
  return undefined;
}

function collectMembers(
  inspection: Inspection,
  type: Type,
  path: string,
  ancestors: ReadonlySet<number> = new Set(),
): void {
  if (ancestors.has(type.id)) return;
  const nextAncestors = new Set(ancestors).add(type.id);
  if (type.isUnionType() || type.isIntersectionType()) {
    for (const constituent of type.getTypes()) {
      collectMembers(inspection, constituent, path, nextAncestors);
    }
    return;
  }
  for (const property of inspection.checker.getPropertiesOfType(type)) {
    const name = publicMemberName(property, inspection.directory);
    if (name === undefined) continue;
    const memberPath = `${path}.${name}`;
    inspection.items.add(memberPath);
    const memberType = inspection.checker.getTypeOfSymbol(property);
    if (memberType) collectMembers(inspection, memberType, memberPath, nextAncestors);
  }
}

function collectExport(inspection: Inspection, exported: CompilerSymbol, moduleId: string): void {
  const { checker, items } = inspection;
  const symbol =
    (exported.flags & SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
  assert.ok(
    !checker.isUnknownSymbol(symbol),
    `Unresolved public export: ${moduleId}:${exported.name}`,
  );
  const path = `${moduleId}:${exported.name}`;
  items.add(path);
  if ((symbol.flags & SymbolFlags.Type) !== 0) {
    collectMembers(inspection, checker.getDeclaredTypeOfSymbol(symbol), path);
  }
  const valueType = checker.getTypeOfSymbol(symbol);
  if (!valueType) return;
  collectMembers(inspection, valueType, path);
  for (const signature of checker.getSignaturesOfType(valueType, SignatureKind.Call)) {
    const returned = checker.getReturnTypeOfSignature(signature);
    /** Named return contracts are inventoried under their own exports. */
    if (returned?.getSymbol()?.name === '__type' && !returned.getAliasSymbol()) {
      collectMembers(inspection, returned, `${path}()`);
    }
  }
}

/** Uses the pinned compiler's public API without loading package runtime code. */
export function discoverApi(entries: readonly DeclarationEntry[], directory: string): string[] {
  const compiler = new API({ cwd: directory });
  const items = new Set<string>();
  try {
    using snapshot = compiler.updateSnapshot({ openFiles: entries.map((entry) => entry.path) });
    for (const entry of entries) {
      const project = snapshot.getDefaultProjectForFile(entry.path);
      const source = project?.program.getSourceFile(entry.path);
      assert.ok(project && source, `Build the declaration entry before inventory: ${entry.path}`);
      const moduleSymbol = project.checker.getSymbolAtLocation(source);
      assert.ok(moduleSymbol, `Missing declaration module: ${entry.path}`);
      for (const exported of project.checker.getExportsOfModule(moduleSymbol)) {
        collectExport({ checker: project.checker, directory, items }, exported, entry.id);
      }
    }
  } finally {
    compiler.close();
  }
  return [...items].toSorted();
}
