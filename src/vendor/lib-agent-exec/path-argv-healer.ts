// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionContext } from './interceptors/types.js';
import { findPatternExprIndex } from './command-utils.js';
import { resolveEvalExecutionTarget } from './eval-healer.js';
import {
  BARREL_CANDIDATES,
  CANDIDATE_EXTENSIONS,
  formatHealedPath,
  isDirectoryPath,
  isFilePath,
  logPathHeal,
  normalizeMntPath,
  preserveQuotes,
} from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';
import { resolveBuildSrcSwap, resolvePathWithDirectorySynonyms } from './path-synonym.js';
import { healEvalCodePathHallucinations } from './path-eval-healer.js';

const FILE_TOOLS: ReadonlySet<string> = new Set([
  'rg', 'rg.exe',
  'grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe',
  'cat', 'cat.exe',
  'head', 'head.exe',
  'tail', 'tail.exe',
  'wc', 'wc.exe',
  'diff', 'diff.exe',
  'cmp', 'cmp.exe',
  'eslint', 'eslint.cmd',
  'node', 'node.exe',
  'bun', 'bun.exe',
  'prettier', 'prettier.cmd',
  'sed', 'sed.exe',
  'awk', 'awk.exe',
  'ls', 'ls.exe',
  'find', 'find.exe',
  'dir', 'dir.exe',
]);

const GENERIC_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
  '-e', '-f', '-m', '-n', '-c', '-o', '--config', '--ignore-path',
  '-A', '-B', '-C', '-g', '-t', '-T',
  '--glob', '--iglob', '--type', '--type-not', '--max-count', '--max-depth',
  '--after-context', '--before-context', '--context', '--exclude', '--include',
]);

const VALUE_TAKING_FLAGS: Record<string, ReadonlySet<string>> = {
  rg: new Set([
    '-e', '--regexp', '-f', '--file', '-g', '--glob', '--iglob',
    '-t', '--type', '-T', '--type-not', '--type-add', '--type-clear',
    '-m', '--max-count', '-d', '--max-depth', '--max-filesize', '-M', '--max-columns',
    '-A', '--after-context', '-B', '--before-context', '-C', '--context',
    '-j', '--threads', '-E', '--encoding', '--engine', '-r', '--replace',
    '--color', '--colors', '--field-context-separator', '--field-match-separator',
    '--path-separator', '--pre', '--pre-glob', '--sort', '--sortr',
  ]),
  grep: new Set([
    '-e', '--regexp', '-f', '--file', '-m', '--max-count',
    '-A', '--after-context', '-B', '--before-context', '-C', '--context',
    '--exclude', '--exclude-dir', '--exclude-from', '--include', '--label', '--color', '--colour',
  ]),
  egrep: new Set(['-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C', '--exclude', '--exclude-dir', '--exclude-from', '--include', '--color', '--label']),
  fgrep: new Set(['-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C', '--exclude', '--exclude-dir', '--exclude-from', '--include', '--color', '--label']),
  head: new Set(['-n', '--lines', '-c', '--bytes']),
  tail: new Set(['-n', '--lines', '-c', '--bytes', '-s', '--sleep-interval']),
  eslint: new Set(['-c', '--config', '--ignore-path', '--rule', '--parser']),
  prettier: new Set(['-c', '--config', '--ignore-path', '--parser']),
  sed: new Set(['-e', '--expression', '-f', '--file', '-i', '--in-place']),
  awk: new Set(['-F', '--field-separator', '-v', '--assign', '-f', '--file']),
  find: new Set(['-maxdepth', '-mindepth', '-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-type', '-size', '-mtime']),
  bun: new Set(['-e', '--eval', '-p', '--print', '--cwd', '--env-file', '-c', '--config', '--port', '--define', '-r', '--preload', '--filter']),
  node: new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--env-file', '-C', '--conditions']),
};

const BUN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test', 'run', 'add', 'remove', 'rm', 'install', 'i', 'build', 'create', 'init', 'upgrade', 'update',
  'outdated', 'link', 'unlink', 'pm', 'patch', 'x', 'exec', 'repl', 'dev', 'publish', 'help',
]);

const BUN_PKG_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'add', 'remove', 'rm', 'install', 'i', 'upgrade', 'update', 'outdated', 'link', 'unlink', 'pm',
  'create', 'init', 'patch', 'publish', 'help',
]);

const CODE_MODULE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const GREP_TOOLS: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']);
const SEARCH_TOOLS: ReadonlySet<string> = new Set([...GREP_TOOLS, 'rg', 'rg.exe']);
const SEARCH_OR_LIST: ReadonlySet<string> = new Set([...SEARCH_TOOLS, 'ls', 'ls.exe', 'dir', 'dir.exe', 'find', 'find.exe']);
const RUNNER_NAMES: ReadonlySet<string> = new Set(['tsx', 'ts-node', 'node', 'bun', 'deno', 'nodemon']);
const SCRIPT_EXTS: ReadonlySet<string> = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']);

function healEvalPayload(ctx: ExecutionContext, cwd: string): void {
  if (ctx.payload.type !== 'eval' || typeof ctx.payload.code !== 'string') return;
  const { effectiveInterpreter } = resolveEvalExecutionTarget(ctx.payload);
  const skipValidFileRewrite = ctx.payload.target !== 'wsl2'
    && ['node', 'js', 'javascript', 'tsx', 'ts-node'].includes(effectiveInterpreter.toLowerCase());
  ctx.payload.code = healEvalCodePathHallucinations(ctx.payload.code, cwd, ctx.payload.target, { skipValidFileRewrite });
}

function healBackupPaths(args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || (!arg.includes('memory-journal-mcp\\backups') && !arg.includes('memory-journal-mcp/backups'))) continue;
    console.error(`\n   💡 AGENT HINT: 'backups' directory is located at 'data/backups', not the repository root.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to data/backups.\x1b[0m`);
    args[index] = arg.replace(/memory-journal-mcp[\\/]backups/g, 'memory-journal-mcp/data/backups');
  }
}

function healMcpConfigPaths(args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || (!arg.includes('.gemini\\mcp_config.json') && !arg.includes('.gemini/mcp_config.json')) || arg.includes('antigravity-ide')) continue;
    console.error(`\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`);
    args[index] = arg.replace(/\.gemini[\\/]mcp_config\.json/g, '.gemini/antigravity-ide/mcp_config.json');
  }
}

function addSkipRange(skip: Set<number>, start: number, end: number): void {
  for (let index = start; index < end; index += 1) skip.add(index);
}

function isPackageJsonScript(scriptArg: string): boolean {
  return !scriptArg.includes('/') && !scriptArg.includes('\\') && path.extname(scriptArg).length === 0;
}

function skipBunRunArgs(args: string[], skip: Set<number>, firstPositionalIdx: number): void {
  const scriptIdx = args.findIndex((item, idx) => idx > firstPositionalIdx && !item.startsWith('-'));
  if (scriptIdx === -1) return;
  const scriptArg = args[scriptIdx];
  if (scriptArg === undefined) return;
  if (RUNNER_NAMES.has(scriptArg.toLowerCase())) {
    skip.add(scriptIdx);
    const runnerTargetIdx = args.findIndex((item, idx) => idx > scriptIdx && !item.startsWith('-'));
    if (runnerTargetIdx !== -1) addSkipRange(skip, runnerTargetIdx + 1, args.length);
    return;
  }
  const start = isPackageJsonScript(scriptArg) ? scriptIdx : scriptIdx + 1;
  addSkipRange(skip, start, args.length);
}

function skipBunPositionals(args: string[], skip: Set<number>): boolean {
  const firstPositionalIdx = args.findIndex((item) => !item.startsWith('-'));
  if (firstPositionalIdx === -1) return false;
  const firstPositional = args[firstPositionalIdx];
  if (firstPositional === undefined) return false;
  const subcommand = firstPositional.toLowerCase();
  if (BUN_PKG_SUBCOMMANDS.has(subcommand)) return true;
  if (BUN_SUBCOMMANDS.has(subcommand)) {
    skip.add(firstPositionalIdx);
    if (subcommand === 'run') skipBunRunArgs(args, skip, firstPositionalIdx);
    return false;
  }
  if (SCRIPT_EXTS.has(path.extname(firstPositional).toLowerCase()) || firstPositional.includes('/') || firstPositional.includes('\\')) {
    addSkipRange(skip, firstPositionalIdx + 1, args.length);
  }
  return false;
}

function skipNodeTail(args: string[], skip: Set<number>): void {
  const scriptIdx = args.findIndex((item) => !item.startsWith('-'));
  if (scriptIdx !== -1) addSkipRange(skip, scriptIdx + 1, args.length);
}

function skipFlagValues(base: string, args: string[], skip: Set<number>): void {
  const valueFlags = VALUE_TAKING_FLAGS[base.replace(/\.exe$/, '')] ?? GENERIC_VALUE_TAKING_FLAGS;
  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = args[index];
    if (flag !== undefined && valueFlags.has(flag)) skip.add(index + 1);
  }
}

function resolveArgForCompare(value: string, cwd: string): string {
  const raw = value.replace(/^['"]|['"]$/g, '');
  const norm = raw.startsWith('/mnt/') ? normalizeMntPath(raw) : raw;
  return (path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(cwd, norm)).replace(/[\\/]+$/, '').toLowerCase();
}

function applyHeal(args: string[], idx: number, healed: string, cwd: string): boolean {
  const target = resolveArgForCompare(healed, cwd);
  const duplicate = args.some((other, otherIdx) => otherIdx !== idx && !other.startsWith('-') && resolveArgForCompare(other, cwd) === target);
  if (duplicate) return false;
  args[idx] = healed;
  return true;
}

function looksLikeStructuredArg(trimmed: string): boolean {
  if (trimmed.startsWith('{') || trimmed.startsWith('base64:') || trimmed.includes('\n')) return true;
  if ((trimmed.startsWith('"') || trimmed.startsWith("'")) && trimmed.includes('{') && trimmed.includes('}')) return true;
  return /"(?:type|command|args|interpreter|code)"\s*:/.test(trimmed);
}

function shouldSkipArg(arg: string | undefined): boolean {
  if (arg === undefined || arg.length === 0 || arg.startsWith('-')) return true;
  const trimmed = arg.trim();
  if (trimmed.startsWith('!') || /^['"]!/.test(trimmed)) return true;
  if (arg.startsWith('/') && !arg.startsWith('/mnt/')) return true;
  if (arg.includes('*') || arg.includes('?') || arg.includes('://')) return true;
  return looksLikeStructuredArg(trimmed);
}

function hasGrepRecurse(args: readonly string[]): boolean {
  return args.some((item) => item === '-r' || item === '-R' || item === '--recursive' || (item.startsWith('-') && !item.startsWith('--') && (item.includes('r') || item.includes('R'))));
}

function healExistingPath(args: string[], base: string, arg: string, resolved: string): boolean {
  if (!fs.existsSync(resolved)) return false;
  if (fs.statSync(resolved).isDirectory() && GREP_TOOLS.has(base) && !hasGrepRecurse(args)) {
    logPathHeal(`'grep' called on directory '${arg}' without recursive flag.`, `Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)`);
    return true;
  }
  return false;
}

function findBarrelName(dirPath: string): string | null {
  for (const barrel of BARREL_CANDIDATES) {
    if (fs.existsSync(path.join(dirPath, barrel))) return barrel;
  }
  return null;
}

function healModularDirectory(args: string[], base: string, index: number, arg: string, rawPath: string, isWslPath: boolean, cwd: string): { handled: boolean; needsRecurse: boolean } {
  const extMatch = rawPath.match(/\.(?:ts|js|tsx|jsx|mjs|cjs)$/i);
  if (extMatch === null) return { handled: false, needsRecurse: false };
  const withoutExt = rawPath.slice(0, -extMatch[0].length);
  const normalizedWithoutExt = isWslPath ? normalizeMntPath(withoutExt) : withoutExt;
  const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(cwd, normalizedWithoutExt);
  if (!isDirectoryPath(resolvedWithoutExt)) return { handled: false, needsRecurse: false };
  if (SEARCH_TOOLS.has(base)) {
    return { handled: true, needsRecurse: healSearchDirectory(args, base, index, arg, withoutExt, cwd) };
  }
  const foundBarrel = findBarrelName(resolvedWithoutExt);
  if (foundBarrel === null) return { handled: false, needsRecurse: false };
  const sep = withoutExt.includes('\\') ? '\\' : '/';
  const healedBarrel = preserveQuotes(arg, `${withoutExt}${sep}${foundBarrel}`);
  if (applyHeal(args, index, healedBarrel, cwd)) {
    logPathHeal(`File '${arg}' not found on disk, but directory '${withoutExt}' exists with entrypoint '${foundBarrel}'.`, `Auto-correcting path to '${healedBarrel}'... (Frictionless Recovery)`);
  }
  return { handled: true, needsRecurse: false };
}

function notifyAndMarkGrepRecurse(args: string[], base: string): boolean {
  if (!GREP_TOOLS.has(base) || hasGrepRecurse(args)) return false;
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function healSearchDirectory(args: string[], base: string, index: number, arg: string, withoutExt: string, cwd: string): boolean {
  const healedDir = preserveQuotes(arg, withoutExt);
  if (applyHeal(args, index, healedDir, cwd)) {
    logPathHeal(`File '${arg}' not found, but modular directory '${withoutExt}' exists.`, `Auto-correcting path to '${healedDir}'... (Frictionless Recovery)`);
    return notifyAndMarkGrepRecurse(args, base);
  }
  return false;
}

function healAddedExtension(args: string[], index: number, arg: string, resolved: string, hadTrailingSlash: boolean, cwd: string, isWslPath: boolean): 'healed' | 'blocked' | 'none' {
  const cleanResolved = resolved.replace(/[\\/]+$/, '');
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (hadTrailingSlash && !CODE_MODULE_EXTENSIONS.has(ext)) continue;
    const candidate = cleanResolved + ext;
    if (!isFilePath(candidate)) continue;
    const healedArg = formatHealedPath(arg, candidate, cwd, isWslPath);
    if (!applyHeal(args, index, healedArg, cwd)) return 'blocked';
    logPathHeal(`Path '${arg}' not found on disk, but '${healedArg}' exists.`, `Auto-correcting path to '${healedArg}'... (Frictionless Recovery)`);
    return 'healed';
  }
  return 'none';
}

function healNeighborArg(args: string[], base: string, index: number, arg: string, rawPath: string, resolved: string, hadTrailingSlash: boolean, cwd: string, isWslPath: boolean): boolean {
  const isSearchOrListTool = SEARCH_OR_LIST.has(base);
  if (!isSearchOrListTool && !rawPath.includes('/') && !rawPath.includes('\\')) return false;
  const candidatePath = resolvePathWithDirectorySynonyms(resolved, isSearchOrListTool)
    ?? resolveBuildSrcSwap(resolved, isSearchOrListTool)
    ?? (hadTrailingSlash ? null : findNeighborFilePath(resolved, isSearchOrListTool));
  if (candidatePath === null) return false;
  const isDir = isDirectoryPath(candidatePath);
  if (hadTrailingSlash && !isDir) return false;
  const healedArg = formatHealedPath(arg, candidatePath, cwd, isWslPath);
  if (!applyHeal(args, index, healedArg, cwd)) return false;
  const kind = isDir ? 'Directory' : 'File';
  logPathHeal(`${kind} '${arg}' not found on disk, but found at '${healedArg}'.`, `Auto-correcting path to '${healedArg}'... (Frictionless Recovery)`);
  return isDir && notifyAndMarkGrepRecurse(args, base);
}

function healFileToolArgs(args: string[], base: string, cwd: string, skip: Set<number>): void {
  let pendingGrepRecurse = false;
  for (let index = 0; index < args.length; index += 1) {
    if (skip.has(index)) continue;
    const arg = args[index];
    if (shouldSkipArg(arg) || arg === undefined) continue;
    const rawPath = arg.replace(/^['"]|['"]$/g, '');
    const hadTrailingSlash = /[\\/]$/.test(rawPath);
    const isWslPath = arg.startsWith('/mnt/');
    const wslNormalized = isWslPath ? normalizeMntPath(rawPath) : rawPath;
    const resolved = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
    if (fs.existsSync(resolved)) {
      if (healExistingPath(args, base, arg, resolved)) pendingGrepRecurse = true;
      continue;
    }
    const modularResult = healModularDirectory(args, base, index, arg, rawPath, isWslPath, cwd);
    if (modularResult.handled) {
      if (modularResult.needsRecurse) pendingGrepRecurse = true;
      continue;
    }
    const extensionResult = healAddedExtension(args, index, arg, resolved, hadTrailingSlash, cwd, isWslPath);
    if (extensionResult === 'healed') continue;
    if (healNeighborArg(args, base, index, arg, rawPath, resolved, hadTrailingSlash, cwd, isWslPath)) {
      pendingGrepRecurse = true;
    }
  }
  if (pendingGrepRecurse && !hasGrepRecurse(args)) {
    args.unshift('-r');
  }
}

export function healPathHallucinations(ctx: ExecutionContext): void {
  const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? path.resolve(ctx.payload.cwd) : process.cwd();
  healEvalPayload(ctx, cwd);
  const { args } = ctx;
  healBackupPaths(args);
  healMcpConfigPaths(args);
  const base = ctx.cmdBasename.toLowerCase();
  if (!FILE_TOOLS.has(base)) return;
  const skip = new Set<number>();
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, args);
  if (patternIdx !== -1) skip.add(patternIdx);
  if ((base === 'bun' || base === 'bun.exe') && skipBunPositionals(args, skip)) return;
  if (base === 'node' || base === 'node.exe') skipNodeTail(args, skip);
  // [INVARIANT]: Values of value-taking flags (globs, types, patterns, context counts) are never paths to heal.
  skipFlagValues(base, args, skip);
  // [INVARIANT]: Never heal an arg into a duplicate of another existing arg (e.g. two copies of the same file).
  healFileToolArgs(args, base, cwd, skip);
}
