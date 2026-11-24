import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import { z } from 'zod';
import {
  acquireSyncVendorLock,
  assertSafeSyncWorktree,
  writeBufferAtomicIfChanged,
} from './sync-vendor-guards.js';
import { hasHostScriptReferences, neutralizeVendoredDoc } from './vendor-doc-neutralizer.js';

function collectModuleSpecifiers(source: string): string[] {
  const sf = ts.createSourceFile('vendor.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length >= 1
    ) {
      const firstArg = node.arguments[0];
      if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
        specifiers.push(firstArg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specifiers;
}

/**
 * Extract relative and third-party package specifiers from a single TypeScript AST parse.
 */
function classifyVendorSpecifiers(source: string): { relative: string[]; packages: Set<string> } {
  const relativeSpecifiers: string[] = [];
  const packages = new Set<string>();
  for (const specifier of collectModuleSpecifiers(source)) {
    if (specifier.startsWith('.')) {
      relativeSpecifiers.push(specifier);
      continue;
    }
    if (specifier.startsWith('/') || specifier.startsWith('node:') || specifier.startsWith('bun:')) {
      continue;
    }
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
    if (builtinModules.includes(name)) continue;
    packages.add(name);
  }
  return { relative: relativeSpecifiers, packages };
}

function resolveUpstreamRoot(cwd: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (explicit.trim() === '') {
      throw new Error('Invalid blank --upstream-root path.');
    }
    return resolve(cwd, explicit);
  }
  const configured = process.env['VENDOR_UPSTREAM_ROOT'];
  if (configured !== undefined && configured.trim() !== '') {
    return resolve(cwd, configured);
  }
  const parentDir = resolve(cwd, '..');
  if (existsSync(parentDir)) {
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(parentDir, entry.name);
      if (existsSync(join(candidate, '.agents', 'scripts', 'lib-agent-exec', 'agent-exec.ts'))) {
        return candidate;
      }
    }
  }
  throw new Error(
    'Upstream vendor repository not found. Pass --upstream-root <path> or set VENDOR_UPSTREAM_ROOT.'
  );
}

const VendorLibSchema = z
  .object({
    source: z.string().min(1),
    files: z.array(z.string().min(1)),
    syncedAt: z.string().optional(),
    syncedFromCommit: z.string().optional(),
  })
  .loose();

const VendorManifestSchema = z
  .object({
    libs: z.record(z.string(), VendorLibSchema),
  })
  .loose();

const PackageJsonDepsSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
  })
  .loose();

type VendorManifest = z.infer<typeof VendorManifestSchema>;
type StagedWrite =
  | { kind: 'ts'; destFile: string; content: string }
  | { kind: 'doc'; destFile: string; content: string }
  | { kind: 'copy'; srcFile: string; destFile: string };

function readDeclaredPackages(cwd: string): Set<string> {
  const pkg = PackageJsonDepsSchema.parse(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')));
  const declared = new Set<string>();
  for (const section of [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
    pkg.peerDependencies,
  ]) {
    if (section !== undefined) {
      for (const name of Object.keys(section)) declared.add(name);
    }
  }
  return declared;
}

function readUpstreamDepRanges(upstreamRoot: string | undefined): Record<string, string> {
  if (upstreamRoot === undefined) return {};
  try {
    const pkg = PackageJsonDepsSchema.parse(
      JSON.parse(readFileSync(join(upstreamRoot, 'package.json'), 'utf8'))
    );
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

function stageVendorWrites(
  cwd: string,
  upstreamRoot: string,
  headSha: string,
  libsToSync: string[],
  manifest: VendorManifest
): {
  writes: StagedWrite[];
  stagedTsSources: Map<string, string>;
  stagedPaths: Set<string>;
  nextManifest: VendorManifest;
} {
  const writes: StagedWrite[] = [];
  const stagedTsSources = new Map<string, string>();
  const stagedPaths = new Set<string>();
  const nextManifest = structuredClone(manifest);
  const syncedAt = new Date().toISOString();

  for (const lib of libsToSync) {
    const libConfig = nextManifest.libs[lib];
    if (libConfig === undefined) continue;
    const vendorRoot = resolve(join(cwd, 'src', 'vendor'));
    const upstreamResolved = resolve(upstreamRoot);
    const sourceDir = resolve(join(upstreamResolved, libConfig.source));
    const sourceDirRel = relative(upstreamResolved, sourceDir);
    if (sourceDirRel === '..' || sourceDirRel.startsWith('..' + sep) || isAbsolute(sourceDirRel)) {
      throw new Error(`Vendor library source path escapes upstream root: ${lib}`);
    }
    const destDir = resolve(join(vendorRoot, lib));
    const destDirRel = relative(vendorRoot, destDir);
    if (destDirRel === '..' || destDirRel.startsWith('..' + sep) || isAbsolute(destDirRel)) {
      throw new Error(`Vendor library path escapes src/vendor: ${lib}`);
    }
    for (const file of libConfig.files) {
      const srcFile = resolve(join(sourceDir, file));
      const srcRel = relative(sourceDir, srcFile);
      if (srcRel === '..' || srcRel.startsWith('..' + sep) || isAbsolute(srcRel)) {
        throw new Error(`Vendor source path escapes upstream library root: ${file}`);
      }
      if (lstatSync(srcFile, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in vendor source: ${file}`);
      }
      const destFile = resolve(join(destDir, file));
      const destRel = relative(destDir, destFile);
      if (destRel === '..' || destRel.startsWith('..' + sep) || isAbsolute(destRel)) {
        throw new Error(`Vendor destination path escapes src/vendor/${lib}: ${file}`);
      }
      if (lstatSync(destFile, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link at vendor destination: ${file}`);
      }
      stagedPaths.add(destFile);
      if (file.endsWith('.ts')) {
        const content = readFileSync(srcFile, 'utf8');
        // Vendor files are standalone scripts synced from upstream tooling; prepend @ts-nocheck for app tsc
        const cleanContent = content.startsWith('// @ts-nocheck') ? content : '// @ts-nocheck\n' + content;
        stagedTsSources.set(destFile, cleanContent);
        writes.push({ kind: 'ts', destFile, content: cleanContent });
      } else if (file.endsWith('.md')) {
        // [INTENT] Upstream docs cite host-only `.agents/scripts` wrappers; ship path-neutral wording instead.
        writes.push({ kind: 'doc', destFile, content: neutralizeVendoredDoc(readFileSync(srcFile, 'utf8')) });
      } else {
        writes.push({ kind: 'copy', srcFile, destFile });
      }
    }
    libConfig.syncedAt = syncedAt;
    libConfig.syncedFromCommit = headSha;
  }
  return { writes, stagedTsSources, stagedPaths, nextManifest };
}

function validateVendorLibraries(
  cwd: string,
  libsToSync: string[],
  manifest: VendorManifest,
  declared: ReadonlySet<string>,
  stagedTsSources?: ReadonlyMap<string, string>,
  stagedPaths?: ReadonlySet<string>
): { unresolved: Map<string, Set<string>>; missing: Map<string, Set<string>> } {
  const missing = new Map<string, Set<string>>();
  const unresolved = new Map<string, Set<string>>();
  for (const lib of libsToSync) {
    const libConfig = manifest.libs[lib];
    if (libConfig === undefined) continue;
    for (const file of libConfig.files) {
      if (!file.endsWith('.ts')) continue;
      const filePath = resolve(join(cwd, 'src', 'vendor', lib, file));
      const source = stagedTsSources?.get(filePath) ?? readFileSync(filePath, 'utf8');
      const { relative: relativeSpecifiers, packages } = classifyVendorSpecifiers(source);
      for (const specifier of relativeSpecifiers) {
        const target = resolve(dirname(filePath), specifier.replace(/\.js$/, '.ts'));
        if ((stagedPaths?.has(target) ?? false) || existsSync(target)) continue;
        const normalizedSpecifier = specifier.replace(/\\/g, '/');
        const normalizedFile = file.replace(/\\/g, '/');
        const users = unresolved.get(`${lib}/${normalizedSpecifier}`) ?? new Set<string>();
        users.add(`${lib}/${normalizedFile}`);
        unresolved.set(`${lib}/${normalizedSpecifier}`, users);
      }
      for (const pkg of packages) {
        if (declared.has(pkg)) continue;
        const users = missing.get(pkg) ?? new Set<string>();
        users.add(`${lib}/${file}`);
        missing.set(pkg, users);
      }
    }
  }
  return { unresolved, missing };
}

function findNonNeutralVendorDocs(cwd: string, libsToSync: string[], manifest: VendorManifest): string[] {
  const offenders: string[] = [];
  for (const lib of libsToSync) {
    const libConfig = manifest.libs[lib];
    if (libConfig === undefined) continue;
    for (const file of libConfig.files) {
      if (!file.endsWith('.md')) continue;
      const filePath = resolve(join(cwd, 'src', 'vendor', lib, file));
      if (!existsSync(filePath)) continue;
      if (hasHostScriptReferences(readFileSync(filePath, 'utf8'))) {
        offenders.push(`${lib}/${file.replace(/\\/g, '/')}`);
      }
    }
  }
  return offenders;
}

function assertNoVendorIssues(
  unresolved: Map<string, Set<string>>,
  missing: Map<string, Set<string>>,
  upstreamDeps: Record<string, string>
): void {
  if (unresolved.size > 0) {
    console.error('\nVendored files import sibling modules that are not synced (add them to src/vendor/VENDOR.json "files"):');
    for (const [specifier, users] of unresolved) {
      console.error(`  - ${specifier}  <- ${[...users].slice(0, 3).join(', ')}`);
    }
  }
  if (missing.size > 0) {
    console.error('\nVendored code imports packages that are not declared in package.json:');
    for (const [pkg, users] of missing) {
      const range = upstreamDeps[pkg];
      console.error(`  - ${pkg}${range !== undefined ? ` (upstream uses ${range})` : ''}  <- ${[...users].slice(0, 3).join(', ')}`);
    }
    console.error(`\nAdd them, e.g.: pnpm add -D ${[...missing.keys()].map((pkg) => (upstreamDeps[pkg] !== undefined ? `${pkg}@${upstreamDeps[pkg]}` : pkg)).join(' ')}`);
  }
  if (unresolved.size > 0 || missing.size > 0) {
    throw new Error('Vendor library validation failed.');
  }
}

function commitStagedVendorWrites(
  vendorJsonPath: string,
  prevManifest: VendorManifest,
  libsToSync: readonly string[],
  staged: ReturnType<typeof stageVendorWrites>
): void {
  const createdDirs = new Set<string>();
  let writtenCount = 0;
  let unchangedCount = 0;
  for (const item of staged.writes) {
    const dir = dirname(item.destFile);
    if (!createdDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    const nextContent = item.kind === 'copy' ? readFileSync(item.srcFile) : Buffer.from(item.content, 'utf8');
    if (writeBufferAtomicIfChanged(item.destFile, nextContent)) writtenCount++;
    else unchangedCount++;
  }
  const commitChanged = libsToSync.some(
    (lib) => prevManifest.libs[lib]?.syncedFromCommit !== staged.nextManifest.libs[lib]?.syncedFromCommit
  );
  const manifestUpdated =
    (writtenCount > 0 || commitChanged) &&
    writeBufferAtomicIfChanged(vendorJsonPath, Buffer.from(JSON.stringify(staged.nextManifest, null, 2) + '\n', 'utf8'));
  console.log(
    `\nSynced ${String(writtenCount)} changed file(s), ${String(unchangedCount)} unchanged, VENDOR.json ${manifestUpdated ? 'updated' : 'unchanged'}`
  );
}

function runVendorSelfTests(cwd: string, rawLib?: string): void {
  console.log('\nRunning tests...');
  const checkArgs = [join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(cwd, 'scripts', 'sync-vendor.ts'), '--check'];
  if (rawLib !== undefined) checkArgs.push('--lib', rawLib);
  execFileSync(process.execPath, checkArgs, { stdio: 'inherit', shell: false });
  const testFiles =
    rawLib === 'lib-agent-exec'
      ? ['tests/unit/vendor-doc-neutralizer.test.ts']
      : ['tests/unit/git-tools.test.ts', 'tests/unit/vendor-doc-neutralizer.test.ts'];
  execFileSync(process.execPath, [join(cwd, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...testFiles], {
    stdio: 'inherit',
    shell: false,
  });
}

function resolveSelectedLibs(vendorData: VendorManifest, rawLib?: string): string[] {
  const available = Object.keys(vendorData.libs);
  if (rawLib === undefined) return available;
  if (!available.includes(rawLib)) throw new Error(`Library ${rawLib} not found in VENDOR.json`);
  return [rawLib];
}

function validateAndAssertLibraries(
  cwd: string,
  libsToSync: string[],
  manifest: VendorManifest,
  upstreamRoot: string | undefined,
  staged?: ReturnType<typeof stageVendorWrites>
): void {
  const declared = readDeclaredPackages(cwd);
  const upstreamDeps = readUpstreamDepRanges(upstreamRoot);
  const { unresolved, missing } = validateVendorLibraries(
    cwd,
    libsToSync,
    manifest,
    declared,
    staged?.stagedTsSources,
    staged?.stagedPaths
  );
  assertNoVendorIssues(unresolved, missing, upstreamDeps);
}

function runCheckMode(cwd: string, vendorJsonPath: string, rawLib?: string, rawUpstream?: string): void {
  const vendorData = VendorManifestSchema.parse(JSON.parse(readFileSync(vendorJsonPath, 'utf8')));
  const libsToSync = resolveSelectedLibs(vendorData, rawLib);
  let upstreamRoot: string | undefined;
  try {
    upstreamRoot = resolveUpstreamRoot(cwd, rawUpstream);
  } catch {
    upstreamRoot = undefined;
  }
  validateAndAssertLibraries(cwd, libsToSync, vendorData, upstreamRoot);

  // [INVARIANT] Synced docs are neutralized at stage time; --check guards against hand-copied upstream READMEs.
  const nonNeutralDocs = findNonNeutralVendorDocs(cwd, libsToSync, vendorData);
  if (nonNeutralDocs.length > 0) {
    console.error('\nVendored docs still reference host-only `.agents/scripts` wrappers (re-run `pnpm run sync:vendor`):');
    for (const doc of nonNeutralDocs) console.error(`  - ${doc}`);
    throw new Error('Non-neutral vendored docs found.');
  }
}

function runWriteMode(
  cwd: string,
  vendorJsonPath: string,
  rawLib: string | undefined,
  rawUpstream: string | undefined,
  allowDirty: boolean
): void {
  const releaseLock = acquireSyncVendorLock(cwd, rawLib !== undefined ? [rawLib] : ['*']);
  try {
    const vendorData = VendorManifestSchema.parse(JSON.parse(readFileSync(vendorJsonPath, 'utf8')));
    const libsToSync = resolveSelectedLibs(vendorData, rawLib);
    assertSafeSyncWorktree(cwd, libsToSync, allowDirty);
    const upstreamRoot = resolveUpstreamRoot(cwd, rawUpstream);
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamRoot, encoding: 'utf8', windowsHide: true }).trim();
    const staged = stageVendorWrites(cwd, upstreamRoot, headSha, libsToSync, vendorData);
    validateAndAssertLibraries(cwd, libsToSync, staged.nextManifest, upstreamRoot, staged);
    commitStagedVendorWrites(vendorJsonPath, vendorData, libsToSync, staged);
  } finally {
    releaseLock();
  }
}

function runSyncVendor(): void {
  const args = parseArgs({
    options: {
      lib: { type: 'string' },
      'upstream-root': { type: 'string' },
      test: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      'allow-dirty': { type: 'boolean', default: false },
    },
  });
  const cwd = process.cwd();
  const vendorJsonPath = join(cwd, 'src', 'vendor', 'VENDOR.json');
  const rawLib = typeof args.values.lib === 'string' ? args.values.lib : undefined;
  const rawUpstream = typeof args.values['upstream-root'] === 'string' ? args.values['upstream-root'] : undefined;

  if (args.values.check) {
    runCheckMode(cwd, vendorJsonPath, rawLib, rawUpstream);
  } else {
    runWriteMode(cwd, vendorJsonPath, rawLib, rawUpstream, args.values['allow-dirty']);
  }

  if (args.values.test) {
    runVendorSelfTests(cwd, rawLib);
  }
}

try {
  runSyncVendor();
} catch (err: unknown) {
  console.error('\nSync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
