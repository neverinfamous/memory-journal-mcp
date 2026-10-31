import { parseArgs } from 'util';
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { builtinModules } from 'module';

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

const args = parseArgs({
  options: {
    lib: { type: 'string' },
    'adamic-root': { type: 'string', default: '../adamic' },
    test: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
});

const cwd = process.cwd();
const vendorJsonPath = join(cwd, 'src', 'vendor', 'VENDOR.json');
const vendorData = JSON.parse(readFileSync(vendorJsonPath, 'utf8'));

const adamicRoot = resolve(cwd, args.values['adamic-root'] as string);

try {
  // Check if adamicRoot exists
  const headSha = execSync('git rev-parse HEAD', { cwd: adamicRoot, encoding: 'utf8' }).trim();

  let libsToSync = Object.keys(vendorData.libs);
  if (args.values.lib) {
    if (!libsToSync.includes(args.values.lib as string)) {
      console.error(`Library ${args.values.lib} not found in VENDOR.json`);
      process.exit(1);
    }
    libsToSync = [args.values.lib as string];
  }

  for (const lib of args.values.check ? [] : libsToSync) {
    const libConfig = vendorData.libs[lib];
    console.log(`\nSyncing ${lib}...`);
    
    const sourceDir = join(adamicRoot, libConfig.source);
    const destDir = join(cwd, 'src', 'vendor', lib);
    
    mkdirSync(destDir, { recursive: true });
    
    let syncedCount = 0;
    const createdDirs = new Set<string>();
    for (const file of libConfig.files) {
      const srcFile = join(sourceDir, file);
      const destFile = join(destDir, file);
      
      const dir = dirname(destFile);
      if (!createdDirs.has(dir)) {
        mkdirSync(dir, { recursive: true });
        createdDirs.add(dir);
      }
      
      if (file.endsWith('.ts')) {
        const content = readFileSync(srcFile, 'utf8');
        // Vendor files are standalone scripts synced from adamic; prepend @ts-nocheck for app tsc
        const cleanContent = content.startsWith('// @ts-nocheck') ? content : '// @ts-nocheck\n' + content;
        writeFileSync(destFile, cleanContent);
      } else {
        cpSync(srcFile, destFile);
      }
      
      syncedCount++;
    }
    
    console.log(`Synced ${syncedCount} files from ${libConfig.source}`);
    
    libConfig.syncedAt = new Date().toISOString();
    libConfig.syncedFromCommit = headSha;
  }

  if (!args.values.check) {
    writeFileSync(vendorJsonPath, JSON.stringify(vendorData, null, 2) + '\n');
    console.log('\nUpdated VENDOR.json');
  }

  // Vendored code must not rely on transitive hoisting: every third-party package it
  // imports has to be declared by this project (pnpm's strict layout does not hoist).
  const consumerPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
  const declared = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = consumerPkg[field];
    if (typeof section === 'object' && section !== null) {
      for (const name of Object.keys(section)) declared.add(name);
    }
  }
  let adamicDeps: Record<string, string> = {};
  try {
    const adamicPkg = JSON.parse(readFileSync(join(adamicRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies']) {
      const section = adamicPkg[field];
      if (typeof section === 'object' && section !== null) {
        adamicDeps = { ...adamicDeps, ...(section as Record<string, string>) };
      }
    }
  } catch {
    // adamic package.json is only used to suggest version ranges
  }

  const missing = new Map<string, Set<string>>();
  const unresolved = new Map<string, Set<string>>();
  for (const lib of libsToSync) {
    const libConfig = vendorData.libs[lib];
    for (const file of libConfig.files as string[]) {
      if (!file.endsWith('.ts')) continue;
      const filePath = join(cwd, 'src', 'vendor', lib, file);
      const source = readFileSync(filePath, 'utf8');
      for (const specifier of extractRelativeImports(source)) {
        const target = resolve(dirname(filePath), specifier.replace(/\.js$/, '.ts'));
        if (existsSync(target)) continue;
        const users = unresolved.get(`${lib}/${specifier}`) ?? new Set<string>();
        users.add(`${lib}/${file}`);
        unresolved.set(`${lib}/${specifier}`, users);
      }
      for (const pkg of extractPackageImports(source)) {
        if (declared.has(pkg)) continue;
        const users = missing.get(pkg) ?? new Set<string>();
        users.add(`${lib}/${file}`);
        missing.set(pkg, users);
      }
    }
  }

  if (unresolved.size > 0) {
    console.error('\nVendored files import sibling modules that are not synced (add them to src/vendor/VENDOR.json "files"):');
    for (const [specifier, users] of unresolved) {
      console.error(`  - ${specifier}  <- ${[...users].slice(0, 3).join(', ')}`);
    }
  }

  if (missing.size > 0) {
    console.error('\nVendored code imports packages that are not declared in package.json:');
    for (const [pkg, users] of missing) {
      const range = adamicDeps[pkg];
      console.error(`  - ${pkg}${range !== undefined ? ` (adamic uses ${range})` : ''}  <- ${[...users].slice(0, 3).join(', ')}`);
    }
    console.error(`\nAdd them, e.g.: pnpm add -D ${[...missing.keys()].map((pkg) => (adamicDeps[pkg] !== undefined ? `${pkg}@${adamicDeps[pkg]}` : pkg)).join(' ')}`);
  }

  if (unresolved.size > 0 || missing.size > 0) {
    process.exit(1);
  }

  if (args.values.test) {
    console.log('\nRunning tests...');
    execSync('bun test src/vendor/ --pass-with-no-tests', { stdio: 'inherit' });
  }
} catch (err: unknown) {
  console.error('\nSync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
