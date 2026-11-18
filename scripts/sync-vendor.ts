import { parseArgs } from 'util';
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execFileSync } from 'child_process';
import { builtinModules } from 'module';
import { z } from 'zod';

/**
 * Extract third-party package names imported by a TypeScript source file.
 * Relative paths, node builtins, `node:` and `bun:` specifiers are ignored.
 */
function extractPackageImports(source: string): Set<string> {
  const packages = new Set<string>();
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    if (specifier.startsWith('node:') || specifier.startsWith('bun:')) continue;
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
    if (builtinModules.includes(name)) continue;
    packages.add(name);
  }
  return packages;
}

/**
 * Extract relative import specifiers (e.g. './command-utils.js') from a TypeScript source file.
 */
function extractRelativeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"](\.[^'"]*)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveUpstreamRoot(cwd: string, explicit?: string): string {
  const configured = explicit ?? process.env['VENDOR_UPSTREAM_ROOT'];
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
    const sourceDir = join(upstreamRoot, libConfig.source);
    const destDir = join(cwd, 'src', 'vendor', lib);
    for (const file of libConfig.files) {
      const srcFile = join(sourceDir, file);
      const destFile = resolve(join(destDir, file));
      stagedPaths.add(destFile);
      if (file.endsWith('.ts')) {
        const content = readFileSync(srcFile, 'utf8');
        // Vendor files are standalone scripts synced from upstream tooling; prepend @ts-nocheck for app tsc
        const cleanContent = content.startsWith('// @ts-nocheck') ? content : '// @ts-nocheck\n' + content;
        stagedTsSources.set(destFile, cleanContent);
        writes.push({ kind: 'ts', destFile, content: cleanContent });
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
      for (const specifier of extractRelativeImports(source)) {
        const target = resolve(dirname(filePath), specifier.replace(/\.js$/, '.ts'));
        if ((stagedPaths?.has(target) ?? false) || existsSync(target)) continue;
        const normalizedSpecifier = specifier.replace(/\\/g, '/');
        const normalizedFile = file.replace(/\\/g, '/');
        const users = unresolved.get(`${lib}/${normalizedSpecifier}`) ?? new Set<string>();
        users.add(`${lib}/${normalizedFile}`);
        unresolved.set(`${lib}/${normalizedSpecifier}`, users);
      }
      for (const pkg of extractPackageImports(source)) {
        if (declared.has(pkg)) continue;
        const users = missing.get(pkg) ?? new Set<string>();
        users.add(`${lib}/${file}`);
        missing.set(pkg, users);
      }
    }
  }
  return { unresolved, missing };
}

function reportAndExitOnVendorIssues(
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
    process.exit(1);
  }
}

function commitStagedVendorWrites(
  vendorJsonPath: string,
  staged: ReturnType<typeof stageVendorWrites>
): void {
  const createdDirs = new Set<string>();
  for (const item of staged.writes) {
    const dir = dirname(item.destFile);
    if (!createdDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    if (item.kind === 'ts') writeFileSync(item.destFile, item.content);
    else cpSync(item.srcFile, item.destFile);
  }
  writeFileSync(vendorJsonPath, JSON.stringify(staged.nextManifest, null, 2) + '\n');
  console.log(`\nSynced ${String(staged.writes.length)} file(s) and updated VENDOR.json`);
}

function runSyncVendor(): void {
  const args = parseArgs({
    options: {
      lib: { type: 'string' },
      'upstream-root': { type: 'string' },
      test: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  });

  const cwd = process.cwd();
  const vendorJsonPath = join(cwd, 'src', 'vendor', 'VENDOR.json');
  const vendorData = VendorManifestSchema.parse(JSON.parse(readFileSync(vendorJsonPath, 'utf8')));

  let upstreamRoot: string | undefined;
  let headSha: string | undefined;
  try {
    const rawUpstream = typeof args.values['upstream-root'] === 'string' ? args.values['upstream-root'] : undefined;
    upstreamRoot = resolveUpstreamRoot(cwd, rawUpstream);
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamRoot, encoding: 'utf8' }).trim();
  } catch (err: unknown) {
    if (!args.values.check) throw err;
  }

  let libsToSync = Object.keys(vendorData.libs);
  const rawLib = typeof args.values.lib === 'string' ? args.values.lib : undefined;
  if (rawLib !== undefined) {
    if (!libsToSync.includes(rawLib)) {
      console.error(`Library ${rawLib} not found in VENDOR.json`);
      process.exit(1);
    }
    libsToSync = [rawLib];
  }

  const staged = !args.values.check
    ? (() => {
        if (upstreamRoot === undefined || headSha === undefined) {
          throw new Error('Upstream repository resolution is required when syncing vendor files.');
        }
        return stageVendorWrites(cwd, upstreamRoot, headSha, libsToSync, vendorData);
      })()
    : undefined;

  const declared = readDeclaredPackages(cwd);
  const upstreamDeps = readUpstreamDepRanges(upstreamRoot);
  const { unresolved, missing } = validateVendorLibraries(
    cwd,
    libsToSync,
    staged?.nextManifest ?? vendorData,
    declared,
    staged?.stagedTsSources,
    staged?.stagedPaths
  );

  reportAndExitOnVendorIssues(unresolved, missing, upstreamDeps);
  if (staged !== undefined) {
    commitStagedVendorWrites(vendorJsonPath, staged);
  }

  if (args.values.test) {
    console.log('\nRunning tests...');
    execFileSync('pnpm', ['run', 'test:vendor'], { stdio: 'inherit', shell: process.platform === 'win32' });
  }
}

try {
  runSyncVendor();
} catch (err: unknown) {
  console.error('\nSync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
