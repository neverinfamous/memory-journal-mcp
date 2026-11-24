// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWslPath } from './command-utils.js';

export const CANDIDATE_EXTENSIONS = [
  '.ts',
  '.js',
  '.json',
  '.md',
  '.tsx',
  '.jsx',
  '.py',
  '.sql',
  '.yml',
  '.yaml',
  '.sh',
] as const;

export const CANDIDATE_EXTENSION_SET: ReadonlySet<string> = new Set(CANDIDATE_EXTENSIONS);

export const BARREL_CANDIDATES = [
  'index.ts',
  'index.js',
  'index.tsx',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  'index.json',
] as const;

export const JS_MODULE_EXTS: ReadonlySet<string> = new Set(['.js', '.mjs', '.cjs']);
export const TS_MODULE_EXTS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts']);

export const DIRECTORY_SYNONYMS: Record<string, readonly string[]> = {
  handlers: ['tools', 'controllers', 'routes', 'schemas', 'services', 'tool', 'handler'],
  handler: ['tools', 'tool', 'controller', 'route', 'schema', 'service', 'handlers'],
  services: ['tools', 'handlers', 'controllers', 'routes', 'service', 'schemas'],
  service: ['services', 'tools', 'handlers', 'tool', 'handler', 'schema'],
  methods: ['tools', 'handlers', 'controllers', 'routes', 'schemas', 'services', 'method'],
  method: ['methods', 'tools', 'handlers', 'schema', 'service'],
  core: ['tools', 'adapters', 'lib', 'src'],
  operations: ['tools', 'services', 'handlers', 'actions', 'methods', 'schemas'],
  operation: ['tools', 'services', 'handlers', 'actions', 'methods', 'schemas', 'tool', 'handler'],
  actions: ['tools', 'operations', 'handlers', 'services'],
  action: ['tools', 'operation', 'handler', 'service'],
  tools: ['handlers', 'commands', 'plugins', 'tool', 'handler', 'operations', 'actions'],
  tool: ['tools', 'handlers', 'handler', 'commands', 'plugins', 'operation', 'action'],
  controllers: ['routes', 'handlers', 'endpoints', 'controller'],
  controller: ['controllers', 'route', 'handler', 'endpoint', 'routes'],
  routes: ['controllers', 'handlers', 'endpoints', 'route'],
  route: ['routes', 'controller', 'handler', 'endpoint', 'controllers'],
  schemas: ['types', 'models', 'schema'],
  schema: ['schemas', 'types', 'models', 'type', 'model'],
  types: ['schemas', 'interfaces', 'type'],
  type: ['types', 'schemas', 'interfaces', 'schema'],
  models: ['schemas', 'entities', 'model'],
  model: ['models', 'schemas', 'entities', 'schema'],
  tests: ['__tests__', 'test', 'spec', 'specs'],
  test: ['__tests__', 'tests', 'spec', 'specs'],
  __tests__: ['tests', 'test', 'spec'],
  specs: ['tests', 'test', 'spec', '__tests__'],
  spec: ['specs', 'tests', 'test', '__tests__'],
  docs: ['documentation', 'doc'],
  doc: ['docs', 'documentation'],
  lib: ['src', 'utils'],
  src: ['lib'],
  dist: ['src', 'lib', 'build', 'out'],
  build: ['src', 'lib', 'dist', 'out'],
  out: ['src', 'lib', 'dist', 'build'],
  scripts: ['bin', 'tools'],
  bin: ['scripts', 'tools'],
  sqlite: ['sqlite-native'],
  'sqlite-native': ['sqlite'],
};

export const FILE_STEM_SYNONYMS: Record<string, readonly string[]> = {
  utils: ['helpers', 'util', 'helper', 'common', 'shared'],
  util: ['helpers', 'utils', 'helper', 'common', 'shared'],
  helpers: ['utils', 'helper', 'util', 'common', 'shared'],
  helper: ['helpers', 'utils', 'util', 'common', 'shared'],
  schema: ['types', 'schemas', 'type', 'models', 'model'],
  schemas: ['types', 'schema', 'type', 'models', 'model'],
  types: ['schema', 'schemas', 'type', 'interfaces'],
  type: ['types', 'schema', 'schemas', 'interfaces'],
  config: ['constants', 'configuration', 'settings', 'options'],
  constants: ['config', 'configuration', 'settings'],
  index: ['main', 'entry', 'app'],
  main: ['index', 'entry', 'app'],
  'create-table': ['tables', 'table', 'alter-table', 'schema'],
  table: ['tables', 'schema', 'create-table'],
  tables: ['table', 'schema', 'create-table'],
  'geo-spatialite': ['spatialite', 'geo'],
  spatialite: ['geo', 'geo-spatialite'],
  'execute-code': ['codemode', 'code-mode', 'execute'],
  'code-mode': ['codemode', 'execute-code', 'code'],
  codemode: ['code-mode', 'execute-code'],
  execute: ['codemode', 'execute-code'],
};

export const BUILD_TO_SRC_SWAPS: Record<string, readonly string[]> = {
  dist: ['src', 'lib', 'build', 'out'],
  build: ['src', 'lib', 'dist', 'out'],
  out: ['src', 'lib', 'dist', 'build'],
  src: ['lib', 'dist', 'build', 'out'],
};

export function altModuleExtensions(baseExt: string): readonly string[] | null {
  if (JS_MODULE_EXTS.has(baseExt)) return ['.ts', '.tsx', '.mts', '.cts'];
  if (TS_MODULE_EXTS.has(baseExt)) return ['.js', '.mjs', '.cjs'];
  return null;
}

export function normalizedEntryKey(value: string): string {
  return value.toLowerCase().replace(/[-_]/g, '');
}

export function isIgnoredEntryName(name: string, skipSkills = false): boolean {
  if (name.startsWith('.') || name === 'node_modules' || name === 'dist') return true;
  return skipSkills && name === 'skills';
}

export function isDirectoryPath(dir: string): boolean {
  try {
    return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

export function isFilePath(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st !== undefined && !st.isDirectory();
  } catch {
    return false;
  }
}

export const WSL_DRIVE_MNT_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/i;

export function normalizeMntPath(raw: string): string {
  if (!WSL_DRIVE_MNT_RE.test(raw)) return raw;
  return raw.replace(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/i, (_match: string, drive: string, rest?: string) => `${drive.toUpperCase()}:/${rest ?? ''}`);
}

export function normalizeMntPathForHost(raw: string): string {
  return process.platform === 'win32' && WSL_DRIVE_MNT_RE.test(raw) ? normalizeMntPath(raw) : raw;
}

export function preserveQuotes(original: string, updated: string): string {
  if (original.startsWith('"') && original.endsWith('"')) return `"${updated}"`;
  if (original.startsWith("'") && original.endsWith("'")) return `'${updated}'`;
  return updated;
}

export function logPathHeal(hint: string, action: string): void {
  console.error(`\n   💡 AGENT HINT: ${hint}`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: ${action}\x1b[0m`);
}

export function isRepositoryRoot(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.agents'));
  } catch {
    return false;
  }
}

export function isFileSystemRoot(dir: string): boolean {
  return path.dirname(dir) === dir;
}

export function formatHealedPath(originalArg: string, candidatePath: string, cwd: string, isWslPath: boolean): string {
  const rawPath = originalArg.replace(/^['"]|['"]$/g, '');
  let formatted: string;
  if (isWslPath) {
    formatted = convertToWslPath(candidatePath);
  } else if (path.isAbsolute(rawPath)) {
    formatted = candidatePath;
    if (rawPath.includes('/') && !rawPath.includes('\\')) formatted = formatted.replace(/\\/g, '/');
  } else {
    formatted = path.relative(cwd, candidatePath);
    if (formatted.length === 0) formatted = '.';
    if (rawPath.includes('/') || !rawPath.includes('\\')) formatted = formatted.replace(/\\/g, '/');
  }
  return preserveQuotes(originalArg, formatted);
}

const JOINED_PATH_EXT_RE = /\.[a-zA-Z0-9]{1,8}$/;

function isJoinedPathToken(token: string, cwd: string): { pathLike: boolean; exists: boolean } {
  if (token.length === 0 || token.startsWith('-')) return { pathLike: false, exists: false };
  const hostToken = WSL_DRIVE_MNT_RE.test(token) ? normalizeMntPathForHost(token) : token;
  let exists: boolean;
  try {
    const resolved = path.isAbsolute(hostToken) ? path.normalize(hostToken) : path.resolve(cwd, hostToken);
    exists = fs.existsSync(resolved);
  } catch {
    exists = false;
  }
  const hasPathShape = exists || token.includes('/') || token.includes('\\') || JOINED_PATH_EXT_RE.test(token);
  return { pathLike: hasPathShape, exists };
}

/**
 * [INTENT]: Split a single non-existent whitespace-separated multi-target argument (e.g. `"a.ts b.ts c.ts"`)
 * into individual path arguments when all tokens look path-like and at least two resolve on disk.
 */
export function splitJoinedFileArg(arg: string, cwd: string): string[] | null {
  const raw = arg.replace(/^['"]|['"]$/g, '').trim();
  if (!/\s/.test(raw) || raw.includes('\n') || raw.includes('\r')) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  let existingCount = 0;
  for (const part of parts) {
    const info = isJoinedPathToken(part, cwd);
    if (!info.pathLike) return null;
    if (info.exists) existingCount += 1;
  }
  return existingCount >= 2 ? parts : null;
}

export { findNeighborFilePath } from './path-neighbor.js';
export { resolvePathWithDirectorySynonyms, resolveBuildSrcSwap } from './path-synonym.js';
export { healModulePath, healModuleImports } from './path-module-healer.js';
export type { HealModuleImportOptions } from './path-module-healer.js';
export { healEvalCodePathHallucinations } from './path-eval-healer.js';
export { healPathHallucinations } from './path-argv-healer.js';
