// @ts-nocheck
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const projectRegistryEntrySchema = z.object({
  path: z.string().min(1),
  project_number: z.number().int().positive(),
});

const memoryJournalConfigSchema = z.object({
  projectRegistry: z.record(z.string(), projectRegistryEntrySchema).optional(),
});

export type ProjectRegistry = Record<string, z.infer<typeof projectRegistryEntrySchema>>;

interface CachedConfigEntry {
  mtimeMs: number;
  size: number;
  projectRegistry: ProjectRegistry | undefined;
}

const configCache = new Map<string, CachedConfigEntry>();

const packageJsonNameSchema = z.object({
  name: z.string().optional(),
});

const MEMORY_JOURNAL_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  'memory-journal-mcp',
  '@neverinfamous/memory-journal-mcp',
]);

export function getDefaultConfigPath(): string {
  const envConfig = process.env['MEMORY_JOURNAL_CONFIG'];
  if (envConfig !== undefined && envConfig.trim().length > 0) {
    return path.resolve(envConfig.trim());
  }
  return path.join(os.homedir(), '.gemini', 'config', 'memory-journal.config.json');
}

/**
 * [INTENT]: Memoized config loader keyed by `(effectiveConfigPath, mtimeMs, size)` so a single
 * commit does not repeatedly read, JSON.parse, and Zod-validate `memory-journal.config.json`.
 */
export function readMemoryJournalRegistry(configPath?: string): ProjectRegistry | undefined {
  const effectiveConfigPath =
    configPath !== undefined && configPath.length > 0
      ? path.resolve(configPath)
      : getDefaultConfigPath();

  const stats = fs.statSync(effectiveConfigPath, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) {
    configCache.delete(effectiveConfigPath);
    return undefined;
  }

  const cached = configCache.get(effectiveConfigPath);
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.projectRegistry;
  }

  try {
    const rawContent = fs.readFileSync(effectiveConfigPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedConfig = memoryJournalConfigSchema.safeParse(parsedJson);
    const projectRegistry = parsedConfig.success ? parsedConfig.data.projectRegistry : undefined;
    configCache.set(effectiveConfigPath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      projectRegistry,
    });
    return projectRegistry;
  } catch {
    return undefined;
  }
}

function isFile(filePath: string): boolean {
  const stats = fs.statSync(filePath, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile();
}

function isMemoryJournalPackageDir(dirPath: string): boolean {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!isFile(pkgPath)) {
    return false;
  }
  try {
    const rawContent = fs.readFileSync(pkgPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedPkg = packageJsonNameSchema.safeParse(parsedJson);
    return (
      parsedPkg.success &&
      parsedPkg.data.name !== undefined &&
      MEMORY_JOURNAL_PACKAGE_NAMES.has(parsedPkg.data.name)
    );
  } catch {
    return false;
  }
}

function resolveRegistryMemoryJournalCli(configPath?: string): string | null {
  const registry = readMemoryJournalRegistry(configPath);
  const mjEntry = registry?.['memory-journal-mcp'];
  if (mjEntry === undefined) {
    return null;
  }
  const mjDir = path.resolve(mjEntry.path);
  const cliPath = path.join(mjDir, 'dist', 'cli.js');
  return isMemoryJournalPackageDir(mjDir) && isFile(cliPath) ? cliPath : null;
}

function resolvePathEnvMemoryJournalCli(): string | null {
  const rawPath = process.env['PATH'] ?? '';
  if (rawPath.length === 0) return null;
  for (const dir of rawPath.split(path.delimiter)) {
    if (dir.length === 0) continue;
    const parent = path.dirname(dir);
    const direct = path.join(dir, 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js');
    if (isFile(direct)) return direct;
    const parentMod = path.join(parent, 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js');
    if (isFile(parentMod)) return parentMod;
    const libMod = path.join(parent, 'lib', 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js');
    if (isFile(libMod)) return libMod;
  }
  return null;
}

/**
 * [INTENT]: Short-circuiting CLI resolver that avoids scanning `PATH` when `cwd`, sibling
 * `../memory-journal-mcp`, or `projectRegistry['memory-journal-mcp']` already provides `dist/cli.js`.
 */
export function resolveMemoryJournalCli(
  cwd: string,
  configPath?: string
): { command: string; prefixArgs: string[] } {
  if (isMemoryJournalPackageDir(cwd)) {
    const localCli = path.join(cwd, 'dist', 'cli.js');
    if (isFile(localCli)) {
      return { command: 'node', prefixArgs: [localCli] };
    }
  }

  const siblingMjDir = path.resolve(cwd, '..', 'memory-journal-mcp');
  if (isMemoryJournalPackageDir(siblingMjDir)) {
    const siblingCli = path.join(siblingMjDir, 'dist', 'cli.js');
    if (isFile(siblingCli)) {
      return { command: 'node', prefixArgs: [siblingCli] };
    }
  }

  const registryCli = resolveRegistryMemoryJournalCli(configPath);
  if (registryCli !== null) {
    return { command: 'node', prefixArgs: [registryCli] };
  }

  const appData = process.env['APPDATA'];
  if (appData !== undefined && appData.length > 0) {
    const appDataCli = path.join(appData, 'npm', 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js');
    if (isFile(appDataCli)) {
      return { command: 'node', prefixArgs: [appDataCli] };
    }
  }

  const pathCli = resolvePathEnvMemoryJournalCli();
  if (pathCli !== null) {
    return { command: 'node', prefixArgs: [pathCli] };
  }

  return { command: 'memory-journal-mcp', prefixArgs: [] };
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
  return isFile(candidate) ? candidate : null;
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
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(entryModulePath).href);
  } catch {
    return false;
  }
  const createInProcess = getInProcessEntryCreator(mod);
  if (createInProcess === null) {
    return false;
  }
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  const targetCwd = path.resolve(cwd);
  const targetStats = fs.statSync(targetCwd, { throwIfNoEntry: false });
  const shouldChdir = targetStats !== undefined && targetStats.isDirectory() && path.resolve(prevCwd) !== targetCwd;
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

export async function persistJournalEntryFile(
  journalFile: string,
  cwd: string,
  dryRunLinks?: boolean
): Promise<void> {
  const resolvedCli = resolveMemoryJournalCli(cwd);
  const inProcessModule = resolveInProcessEntryModule(resolvedCli);
  const ranInProcess =
    inProcessModule !== null
      ? await tryCreateJournalEntryInProcess(inProcessModule, journalFile, cwd, dryRunLinks)
      : false;
  if (!ranInProcess) {
    const cliArgs = [...resolvedCli.prefixArgs, 'entry', 'create', '--file', journalFile];
    if (dryRunLinks === true) {
      cliArgs.push('--dry-run-links');
    }
    execFileSync(resolvedCli.command, cliArgs, {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      cwd,
    });
  }
}
