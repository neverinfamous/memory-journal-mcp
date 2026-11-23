// @ts-nocheck
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  getDefaultConfigPath,
  normalizeRegistryPath,
  readMemoryJournalRegistry,
  readNormalizedMemoryJournalRegistry,
  type NormalizedRegistryEntry,
  type ProjectRegistry,
  type ProjectRegistryEntry,
} from './commit-journal-config.js';
import { redactSensitiveText } from './commit-security.js';

export {
  getDefaultConfigPath,
  normalizeRegistryPath,
  readMemoryJournalRegistry,
  readNormalizedMemoryJournalRegistry,
  type NormalizedRegistryEntry,
  type ProjectRegistry,
  type ProjectRegistryEntry,
};

const packageJsonNameSchema = z.object({
  name: z.string().optional(),
});

const MEMORY_JOURNAL_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  'memory-journal-mcp',
  '@neverinfamous/memory-journal-mcp',
]);

function isRegularNonSymlinkFile(filePath: string): boolean {
  const stats = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return stats !== undefined && !stats.isSymbolicLink() && stats.isFile();
}

interface CachedPackageCheck {
  mtimeMs: number;
  size: number;
  isMemoryJournal: boolean;
}

const MAX_PKG_CACHE_ENTRIES = 32;
const packageDirCache = new Map<string, CachedPackageCheck>();

const MEMORY_JOURNAL_CLI_SEGMENTS: readonly (readonly string[])[] = [
  ['memory-journal-mcp', 'dist', 'cli.js'],
  ['@neverinfamous', 'memory-journal-mcp', 'dist', 'cli.js'],
];

function findCliInNodeModules(nodeModulesDir: string): string | null {
  for (const segments of MEMORY_JOURNAL_CLI_SEGMENTS) {
    const candidate = path.join(nodeModulesDir, ...segments);
    const pkgDir = path.dirname(path.dirname(candidate));
    if (isRegularNonSymlinkFile(candidate) && isMemoryJournalPackageDir(pkgDir)) {
      return candidate;
    }
  }
  return null;
}

function isMemoryJournalPackageDir(dirPath: string): boolean {
  const pkgPath = path.join(dirPath, 'package.json');
  const stats = fs.lstatSync(pkgPath, { throwIfNoEntry: false });
  if (stats === undefined || stats.isSymbolicLink() || !stats.isFile()) {
    packageDirCache.delete(pkgPath);
    return false;
  }
  const cached = packageDirCache.get(pkgPath);
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.isMemoryJournal;
  }
  let isMemoryJournal: boolean;
  try {
    const rawContent = fs.readFileSync(pkgPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedPkg = packageJsonNameSchema.safeParse(parsedJson);
    isMemoryJournal =
      parsedPkg.success &&
      parsedPkg.data.name !== undefined &&
      MEMORY_JOURNAL_PACKAGE_NAMES.has(parsedPkg.data.name);
  } catch {
    packageDirCache.delete(pkgPath);
    return false;
  }
  if (packageDirCache.size >= MAX_PKG_CACHE_ENTRIES && !packageDirCache.has(pkgPath)) {
    const oldestKey = packageDirCache.keys().next().value;
    if (oldestKey !== undefined) packageDirCache.delete(oldestKey);
  }
  packageDirCache.set(pkgPath, { mtimeMs: stats.mtimeMs, size: stats.size, isMemoryJournal });
  return isMemoryJournal;
}

function resolveRegistryMemoryJournalCli(configPath?: string): string | null {
  const registry = readMemoryJournalRegistry(configPath);
  const mjEntry =
    registry !== undefined && Object.hasOwn(registry, 'memory-journal-mcp')
      ? registry['memory-journal-mcp']
      : undefined;
  if (mjEntry === undefined) {
    return null;
  }
  const mjDir = path.resolve(mjEntry.path);
  const cliPath = path.join(mjDir, 'dist', 'cli.js');
  return isRegularNonSymlinkFile(cliPath) && isMemoryJournalPackageDir(mjDir) ? cliPath : null;
}

function resolveSelfPackagedCli(): string | null {
  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    { pkgDir: path.resolve(selfDir, '..', '..', '..'), cliPath: path.resolve(selfDir, '..', '..', 'cli.js') },
    { pkgDir: path.resolve(selfDir, '..', '..', '..'), cliPath: path.resolve(selfDir, '..', '..', '..', 'dist', 'cli.js') },
  ];
  for (const c of candidates) {
    if (isRegularNonSymlinkFile(c.cliPath) && isMemoryJournalPackageDir(c.pkgDir)) {
      return c.cliPath;
    }
  }
  return null;
}

function findCliInGlobalStores(): string | null {
  const appData = process.env['APPDATA'];
  if (appData !== undefined && appData.length > 0 && path.isAbsolute(appData)) {
    const appDataCli = findCliInNodeModules(path.join(appData, 'npm', 'node_modules'));
    if (appDataCli !== null) return appDataCli;
  }
  const pnpmHome = process.env['PNPM_HOME'];
  if (pnpmHome !== undefined && pnpmHome.length > 0 && path.isAbsolute(pnpmHome)) {
    for (const nm of [path.join(pnpmHome, 'global', '5', 'node_modules'), path.join(pnpmHome, 'node_modules')]) {
      const hit = findCliInNodeModules(nm);
      if (hit !== null) return hit;
    }
  }
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData !== undefined && localAppData.length > 0 && path.isAbsolute(localAppData)) {
    const pnpmLocalCli = findCliInNodeModules(path.join(localAppData, 'pnpm', 'global', '5', 'node_modules'));
    if (pnpmLocalCli !== null) return pnpmLocalCli;
  }
  return null;
}

function resolvePathEnvMemoryJournalCli(): string | null {
  const rawPath = process.env['PATH'] ?? '';
  if (rawPath.length === 0) return null;
  for (const rawDir of rawPath.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/g, '');
    if (dir.length === 0 || !path.isAbsolute(dir)) continue;
    const parent = path.dirname(dir);
    const direct = findCliInNodeModules(path.join(dir, 'node_modules'));
    if (direct !== null) return direct;
    const parentMod = findCliInNodeModules(path.join(parent, 'node_modules'));
    if (parentMod !== null) return parentMod;
    const libMod = findCliInNodeModules(path.join(parent, 'lib', 'node_modules'));
    if (libMod !== null) return libMod;
  }
  return null;
}

function resolveWin32PathBinary(): string | null {
  if (process.platform !== 'win32') return null;
  const rawPath = process.env['PATH'] ?? '';
  if (rawPath.length === 0) return null;
  const dirs = rawPath.split(path.delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter((d) => d.length > 0 && path.isAbsolute(d));
  for (const dir of dirs) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = path.join(dir, `memory-journal-mcp${ext}`);
      if (isRegularNonSymlinkFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * [INTENT]: Trusted-first CLI resolver prioritizing `projectRegistry['memory-journal-mcp']` and
 * vendored self-package roots ahead of `cwd`/sibling/global-store/absolute-`PATH` probing to block untrusted repo hijacking.
 */
export function resolveMemoryJournalCli(
  cwd: string,
  configPath?: string
): { command: string; prefixArgs: string[] } {
  const registryCli = resolveRegistryMemoryJournalCli(configPath);
  if (registryCli !== null) {
    return { command: 'node', prefixArgs: [registryCli] };
  }

  const selfCli = resolveSelfPackagedCli();
  if (selfCli !== null) {
    return { command: 'node', prefixArgs: [selfCli] };
  }

  const localCli = path.join(cwd, 'dist', 'cli.js');
  if (isRegularNonSymlinkFile(localCli) && isMemoryJournalPackageDir(cwd)) {
    return { command: 'node', prefixArgs: [localCli] };
  }

  const siblingMjDir = path.resolve(cwd, '..', 'memory-journal-mcp');
  const siblingCli = path.join(siblingMjDir, 'dist', 'cli.js');
  if (isRegularNonSymlinkFile(siblingCli) && isMemoryJournalPackageDir(siblingMjDir)) {
    return { command: 'node', prefixArgs: [siblingCli] };
  }

  const globalCli = findCliInGlobalStores();
  if (globalCli !== null) {
    return { command: 'node', prefixArgs: [globalCli] };
  }

  const pathCli = resolvePathEnvMemoryJournalCli();
  if (pathCli !== null) {
    return { command: 'node', prefixArgs: [pathCli] };
  }

  const winBin = resolveWin32PathBinary();
  if (winBin !== null) {
    return { command: winBin, prefixArgs: [] };
  }

  return { command: 'memory-journal-mcp', prefixArgs: [] };
}

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

function isContainedInRealDir(targetPath: string, baseDir: string): boolean {
  const realBase = tryRealpath(baseDir);
  const realTarget = tryRealpath(targetPath);
  if (realBase === null || realTarget === null) return false;
  const foldBase = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
  const foldTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const rel = path.relative(foldBase, foldTarget);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function resolveInProcessEntryModule(
  resolvedCli: { command: string; prefixArgs: string[] }
): string | null {
  if (resolvedCli.command !== 'node' || resolvedCli.prefixArgs.length !== 1) {
    return null;
  }
  const cliScriptPath = resolvedCli.prefixArgs[0];
  if (cliScriptPath === undefined || cliScriptPath.length === 0) {
    return null;
  }
  const candidate = path.join(path.dirname(cliScriptPath), 'cli', 'commands', 'entry.js');
  return isRegularNonSymlinkFile(candidate) && isContainedInRealDir(candidate, path.dirname(cliScriptPath))
    ? candidate
    : null;
}

type InProcessEntryCreator = (options: {
  file: string;
  dryRunLinks?: boolean | undefined;
}) => Promise<number>;

function getInProcessEntryCreator(mod: unknown): InProcessEntryCreator | null {
  if (typeof mod !== 'object' || mod === null || !('createEntryFromFileInProcess' in mod)) {
    return null;
  }
  const candidate = mod.createEntryFromFileInProcess;
  return typeof candidate === 'function' ? (candidate as InProcessEntryCreator) : null;
}

export async function tryCreateJournalEntryInProcess(
  entryModulePath: string,
  journalFile: string,
  cwd: string,
  dryRunLinks?: boolean
): Promise<boolean> {
  // [INVARIANT]: Never import Node's native SQLCipher/sqlite-vec addon inside Bun runtime.
  if (typeof process.versions['bun'] !== 'undefined') {
    return false;
  }
  if (!isRegularNonSymlinkFile(entryModulePath)) {
    return false;
  }
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(entryModulePath).href);
  } catch (err: unknown) {
    console.warn(
      `⚠️ In-process entry module load failed (${path.basename(entryModulePath)}); falling back to CLI subprocess: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`
    );
    return false;
  }
  const createInProcess = getInProcessEntryCreator(mod);
  if (createInProcess === null) {
    return false;
  }
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  const targetCwd = path.resolve(cwd);
  const resolvedPrevCwd = path.resolve(prevCwd);
  const sameCwd =
    process.platform === 'win32'
      ? resolvedPrevCwd.toLowerCase() === targetCwd.toLowerCase()
      : resolvedPrevCwd === targetCwd;
  const targetStats = fs.statSync(targetCwd, { throwIfNoEntry: false });
  const shouldChdir = targetStats !== undefined && targetStats.isDirectory() && !sameCwd;
  if (shouldChdir) {
    process.chdir(targetCwd);
  }
  try {
    const exitCode = await createInProcess({
      file: journalFile,
      ...(dryRunLinks === true ? { dryRunLinks: true } : {}),
    });
    if (exitCode !== 0) {
      throw new Error(`In-process entry create exited with code ${String(exitCode)}`);
    }
    return true;
  } finally {
    process.exitCode = prevExitCode;
    if (shouldChdir) {
      try {
        process.chdir(prevCwd);
      } catch {
        // Ignore restore failure if directory was removed
      }
    }
  }
}

const CMD_META_RE = /[\s&|<>^()%!;,=\r\n]/;

function buildWinCmdExeLine(command: string, cliArgs: readonly string[]): string {
  const tokens = [command, ...cliArgs];
  for (const raw of tokens) {
    if (raw.includes('"') || raw.includes('\0') || raw.includes('\r') || raw.includes('\n')) {
      throw new Error('Unsafe quote or control character in Windows CLI argument.');
    }
  }
  const crtJoined = tokens.map((raw) => {
    if (raw.length === 0) return '""';
    if (!CMD_META_RE.test(raw)) return raw;
    return `"${raw.replace(/(\\+)$/, '$1$1')}"`;
  }).join(' ');
  let cmdLine = '';
  let inQuotes = false;
  for (let i = 0; i < crtJoined.length; i++) {
    const ch = crtJoined[i] ?? '';
    if (ch === '"') { inQuotes = !inQuotes; cmdLine += ch; }
    else if (ch === '%') { cmdLine += inQuotes ? '"^%"' : '^%'; }
    else if (!inQuotes && /[&|<>^();!]/.test(ch)) { cmdLine += `^${ch}`; }
    else { cmdLine += ch; }
  }
  return `"${cmdLine}"`;
}

export async function persistJournalEntryFile(
  journalFile: string,
  cwd: string,
  dryRunLinks?: boolean
): Promise<void> {
  const resolvedCli = resolveMemoryJournalCli(cwd);
  const inProcessModule = typeof process.versions['bun'] === 'undefined' ? resolveInProcessEntryModule(resolvedCli) : null;
  const ranInProcess = inProcessModule !== null ? await tryCreateJournalEntryInProcess(inProcessModule, journalFile, cwd, dryRunLinks) : false;
  if (!ranInProcess) {
    const cliArgs = [...resolvedCli.prefixArgs, 'entry', 'create', '--file', journalFile, ...(dryRunLinks === true ? ['--dry-run-links'] : [])];
    if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedCli.command)) {
      const rawComSpec = process.env['ComSpec']?.trim();
      const cmdExe = rawComSpec !== undefined && rawComSpec.length > 0 ? rawComSpec : 'cmd.exe';
      const res = spawnSync(cmdExe, ['/d', '/v:off', '/s', '/c', buildWinCmdExeLine(resolvedCli.command, cliArgs)], {
        stdio: 'inherit', shell: false, windowsVerbatimArguments: true, windowsHide: true, cwd,
      });
      if (res.error !== undefined) throw res.error;
      if (res.status !== 0) throw new Error(`Windows batch runner exited with status ${String(res.status)}`);
      return;
    }
    execFileSync(resolvedCli.command, cliArgs, { stdio: 'inherit', shell: false, windowsHide: true, cwd });
  }
}
