// @ts-nocheck
import path from 'node:path';
import { RG_VALUE_FLAGS, inspectCombinedShortFlag } from './command-utils.js';
import {
  BARREL_CANDIDATES,
  isFilePath,
  normalizeMntPathForHost,
  WSL_DRIVE_MNT_RE,
  type PathProbeCache,
} from './path-healer.js';

export const FILE_TOOLS: ReadonlySet<string> = new Set([
  'rg', 'rg.exe', 'grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe',
  'cat', 'cat.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'wc', 'wc.exe',
  'diff', 'diff.exe', 'cmp', 'cmp.exe', 'eslint', 'eslint.cmd', 'node', 'node.exe',
  'bun', 'bun.exe', 'prettier', 'prettier.cmd', 'sed', 'sed.exe', 'awk', 'awk.exe',
  'ls', 'ls.exe', 'find', 'find.exe', 'dir', 'dir.exe',
]);

export const GREP_TOOLS: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']);
export const SEARCH_TOOLS: ReadonlySet<string> = new Set([...GREP_TOOLS, 'rg', 'rg.exe']);
export const SEARCH_OR_LIST: ReadonlySet<string> = new Set([...SEARCH_TOOLS, 'ls', 'ls.exe', 'dir', 'dir.exe', 'find', 'find.exe']);
export const MULTI_TARGET_FILE_TOOLS: ReadonlySet<string> = new Set([
  ...SEARCH_OR_LIST, 'cat', 'cat.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'wc', 'wc.exe', 'eslint', 'eslint.cmd', 'prettier', 'prettier.cmd',
]);
export const CODE_MODULE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.js', '.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

const GENERIC_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
  '-e', '-f', '-m', '-n', '-c', '-o', '--config', '--ignore-path',
  '-A', '-B', '-C', '-g', '-t', '-T',
  '--glob', '--iglob', '--type', '--type-not', '--max-count', '--max-depth',
  '--after-context', '--before-context', '--context', '--exclude', '--include',
]);

const GREP_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-e', '--regexp', '-f', '--file', '-m', '--max-count', '-d', '--directories', '-D', '--devices',
  '-A', '--after-context', '-B', '--before-context', '-C', '--context', '--exclude', '--exclude-dir',
  '--exclude-from', '--include', '--include-from', '--label', '--color', '--colour',
]);

const VALUE_TAKING_FLAGS: Record<string, ReadonlySet<string>> = {
  rg: new Set([...RG_VALUE_FLAGS, '-d']),
  grep: GREP_VALUE_FLAGS,
  egrep: GREP_VALUE_FLAGS,
  fgrep: GREP_VALUE_FLAGS,
  head: new Set(['-n', '--lines', '-c', '--bytes']),
  tail: new Set(['-n', '--lines', '-c', '--bytes', '-s', '--sleep-interval']),
  eslint: new Set(['-c', '--config', '--ignore-path', '--rule', '--parser', '-o', '--output-file', '-f', '--format', '--cache-location']),
  prettier: new Set(['-c', '--config', '--ignore-path', '--parser']),
  sed: new Set(['-e', '--expression', '-f', '--file', '-i', '--in-place']),
  awk: new Set(['-F', '--field-separator', '-v', '--assign', '-f', '--file']),
  find: new Set(['-maxdepth', '-mindepth', '-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-type', '-size', '-mtime']),
  cat: new Set<string>(),
  wc: new Set<string>(),
  ls: new Set(['-w', '--width', '--tabsize', '-T', '--time', '--time-style', '--sort', '--color', '--format', '--indicator-style', '--quoting-style', '-I', '--ignore', '--hide']),
  dir: new Set(['-Filter', '-Include', '-Exclude', '-Depth', '-w', '--width', '--time-style', '--sort', '--color', '-I', '--ignore']),
  diff: new Set(['-U', '--unified', '-C', '--context', '-L', '--label', '-I', '--ignore-matching-lines', '-S', '--starting-file', '-x', '--exclude', '-X', '--exclude-from', '--palette', '--color', '--tabsize', '-W', '--width', '-F', '--show-function-line']),
  cmp: new Set(['-n', '--bytes', '-i', '--ignore-initial']),
  bun: new Set(['-e', '--eval', '-p', '--print', '--cwd', '--env-file', '-c', '--config', '--port', '--define', '-r', '--preload', '--filter', '--outfile', '--outdir', '--tsconfig-override', '--public-path', '--root', '--external', '--target', '--format', '--sourcemap', '-t', '--test-name-pattern', '--timeout', '--entry-naming', '--chunk-naming', '--asset-naming']),
  node: new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--env-file', '--env-file-if-exists', '--loader', '--experimental-loader', '--input-type', '-C', '--conditions']),
};

const BUN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'test', 'run', 'add', 'remove', 'rm', 'install', 'i', 'build', 'create', 'init', 'upgrade', 'update', 'outdated', 'link', 'unlink', 'pm', 'patch', 'x', 'exec', 'repl', 'dev', 'publish', 'help',
]);
const BUN_PKG_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'add', 'remove', 'rm', 'install', 'i', 'upgrade', 'update', 'outdated', 'link', 'unlink', 'pm', 'create', 'init', 'patch', 'publish', 'help',
]);
const RUNNER_NAMES: ReadonlySet<string> = new Set(['tsx', 'ts-node', 'node', 'bun', 'deno', 'nodemon']);
const SCRIPT_EXTS: ReadonlySet<string> = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx']);

const DIR_LOWER_VALUE_FLAGS: ReadonlySet<string> = new Set(
  [...(VALUE_TAKING_FLAGS['dir'] ?? [])].map(f => f.toLowerCase()),
);

function addSkipRange(skip: Set<number>, start: number, end: number): void {
  for (let index = start; index < end; index += 1) skip.add(index);
}

function isPackageJsonScript(scriptArg: string): boolean {
  return !scriptArg.includes('/') && !scriptArg.includes('\\') && path.extname(scriptArg).length === 0;
}

function skipBunRunArgs(args: string[], skip: Set<number>, firstPositionalIdx: number): boolean {
  const scriptIdx = args.findIndex((item, idx) => idx > firstPositionalIdx && !skip.has(idx) && !item.startsWith('-'));
  const limitIdx = scriptIdx === -1 ? args.length : scriptIdx;
  for (let idx = firstPositionalIdx + 1; idx < limitIdx; idx += 1) {
    const flag = args[idx];
    if (flag !== undefined && !skip.has(idx) && (flag === '--cwd' || flag.startsWith('--cwd='))) {
      return true;
    }
  }
  if (scriptIdx === -1) return false;
  const scriptArg = args[scriptIdx];
  if (scriptArg === undefined) return false;
  if (RUNNER_NAMES.has(scriptArg.toLowerCase())) {
    skip.add(scriptIdx);
    const runnerTargetIdx = args.findIndex((item, idx) => idx > scriptIdx && !skip.has(idx) && !item.startsWith('-'));
    if (runnerTargetIdx !== -1) addSkipRange(skip, runnerTargetIdx + 1, args.length);
    return false;
  }
  const start = isPackageJsonScript(scriptArg) ? scriptIdx : scriptIdx + 1;
  addSkipRange(skip, start, args.length);
  return false;
}

function hasInlineEvalFlag(args: readonly string[], skip: ReadonlySet<number>, checkCwd = false): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') return false;
    if (/^--(?:eval|print)(?:=|$)|^-(?:e|p|pe|ep)$/.test(a) || (checkCwd && !skip.has(i) && (a === '--cwd' || a.startsWith('--cwd=')))) return true;
    if (!a.startsWith('-') && !skip.has(i)) return false;
  }
  return false;
}

export function skipBunPositionals(args: string[], skip: Set<number>): boolean {
  if (hasInlineEvalFlag(args, skip, true)) return true;
  const firstPositionalIdx = args.findIndex((item, idx) => !skip.has(idx) && !item.startsWith('-'));
  if (firstPositionalIdx === -1) return false;
  const firstPositional = args[firstPositionalIdx];
  if (firstPositional === undefined) return false;
  const subcommand = firstPositional.toLowerCase();
  if (BUN_PKG_SUBCOMMANDS.has(subcommand)) return true;
  if (BUN_SUBCOMMANDS.has(subcommand)) {
    skip.add(firstPositionalIdx);
    if (subcommand === 'run' && skipBunRunArgs(args, skip, firstPositionalIdx)) return true;
    if (subcommand === 'x' || subcommand === 'exec') {
      const pkgIdx = args.findIndex((item, idx) => idx > firstPositionalIdx && !skip.has(idx) && !item.startsWith('-'));
      if (pkgIdx !== -1) addSkipRange(skip, pkgIdx, args.length);
    }
    return false;
  }
  if (isPackageJsonScript(firstPositional)) {
    addSkipRange(skip, firstPositionalIdx, args.length);
    return true;
  }
  if (SCRIPT_EXTS.has(path.extname(firstPositional).toLowerCase()) || firstPositional.includes('/') || firstPositional.includes('\\')) {
    addSkipRange(skip, firstPositionalIdx + 1, args.length);
  }
  return false;
}

export function skipNodeTail(args: string[], skip: Set<number>): void {
  if (hasInlineEvalFlag(args, skip)) {
    addSkipRange(skip, 0, args.length);
    return;
  }
  const scriptIdx = args.findIndex((item, idx) => !skip.has(idx) && !item.startsWith('-'));
  if (scriptIdx !== -1) addSkipRange(skip, scriptIdx + 1, args.length);
}

/**
 * [INTENT]: Mark argument indices holding values of known flags as exempt from path healing.
 */
export function skipFlagValues(base: string, args: string[], skip: Set<number>): void {
  const toolKey = base.replace(/\.(?:exe|cmd)$/i, '');
  const valueFlags = Object.hasOwn(VALUE_TAKING_FLAGS, toolKey)
    ? (VALUE_TAKING_FLAGS[toolKey] ?? GENERIC_VALUE_TAKING_FLAGS)
    : GENERIC_VALUE_TAKING_FLAGS;
  for (let index = 0; index < args.length - 1; index += 1) {
    const flag = args[index];
    if (flag === '--') break;
    if (flag !== undefined && (inspectCombinedShortFlag(toolKey, flag, valueFlags).takesSeparateValue || (toolKey === 'dir' && DIR_LOWER_VALUE_FLAGS.has(flag.toLowerCase())))) {
      skip.add(index + 1);
      index += 1;
    }
  }
}

export function resolveArgForCompare(value: string, cwd: string): string {
  const raw = value.replace(/^['"]|['"]$/g, '');
  const norm = normalizeMntPathForHost(raw);
  const resolved = (path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(cwd, norm)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function buildResolvedArgArray(args: readonly string[], cwd: string): string[] {
  return args.map((a) => (a.startsWith('-') ? '' : resolveArgForCompare(a, cwd)));
}

export function isDuplicateArg(
  args: string[],
  idx: number,
  healed: string,
  cwd: string,
  skip?: ReadonlySet<number>,
  preResolved?: string[],
): boolean {
  const target = resolveArgForCompare(healed, cwd);
  for (let otherIdx = 0; otherIdx < args.length; otherIdx += 1) {
    if (otherIdx === idx || (skip?.has(otherIdx) ?? false)) continue;
    const other = args[otherIdx];
    if (other === undefined || other.startsWith('-')) continue;
    const cachedNorm = preResolved !== undefined ? preResolved[otherIdx] : undefined;
    const norm = cachedNorm !== undefined && cachedNorm.length > 0 ? cachedNorm : resolveArgForCompare(other, cwd);
    if (norm === target) return true;
  }
  return false;
}

export type ApplyHealOutcome = 'healed' | 'duplicate' | 'blank';

export function applyHeal(
  args: string[],
  idx: number,
  healed: string,
  cwd: string,
  skip?: ReadonlySet<number>,
  preResolved?: string[],
): ApplyHealOutcome {
  if (healed.replace(/^['"]|['"]$/g, '').trim().length === 0) return 'blank';
  if (isDuplicateArg(args, idx, healed, cwd, skip, preResolved)) return 'duplicate';
  args[idx] = healed;
  if (preResolved !== undefined) preResolved[idx] = resolveArgForCompare(healed, cwd);
  return 'healed';
}

export function shiftSkipIndices(skip: Set<number>, afterIdx: number, delta: number): void {
  if (delta <= 0) return;
  const shifted = [...skip].map((idx) => (idx > afterIdx ? idx + delta : idx));
  skip.clear();
  for (const idx of shifted) skip.add(idx);
}

function looksLikeStructuredArg(trimmed: string): boolean {
  if (trimmed.startsWith('{') || trimmed.startsWith('base64:') || trimmed.includes('\n')) return true;
  if ((trimmed.startsWith('"') || trimmed.startsWith("'")) && trimmed.includes('{') && trimmed.includes('}')) return true;
  return /"(?:type|command|args|interpreter|code)"\s*:/.test(trimmed);
}

export function shouldSkipArg(arg: string | undefined): boolean {
  if (arg === undefined || arg.length === 0 || arg.startsWith('-')) return true;
  const trimmed = arg.trim();
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '');
  if (trimmed.startsWith('!') || /^['"]!/.test(trimmed)) return true;
  if (unquoted === '~' || unquoted.startsWith('~/')) return true;
  if (unquoted.startsWith('/') && !WSL_DRIVE_MNT_RE.test(unquoted)) return true;
  if (arg.includes('*') || arg.includes('?') || arg.includes('://')) return true;
  return looksLikeStructuredArg(trimmed);
}

export function hasGrepRecurse(args: readonly string[]): boolean {
  const valueFlags = VALUE_TAKING_FLAGS['grep'] ?? [];
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item === undefined || item === '--') break;
    if (item === '-r' || item === '-R' || item === '--recursive') return true;
    const info = inspectCombinedShortFlag('grep', item, valueFlags);
    if (info.shortPrefix.length > 1 && (info.shortPrefix.includes('r') || info.shortPrefix.includes('R'))) return true;
    if (info.takesSeparateValue) i++;
  }
  return false;
}

export function findBarrelName(dirPath: string, cache?: PathProbeCache): string | null {
  for (const barrel of BARREL_CANDIDATES) {
    if (isFilePath(path.join(dirPath, barrel), cache)) return barrel;
  }
  return null;
}
