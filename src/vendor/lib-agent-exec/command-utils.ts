// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';

export { formatForCmdExe, convertToWslPath, convertToWindowsPath } from './path-convert.js';
export { healRegexPattern, sanitizeWslRegex } from './regex-healer.js';
export { healFragmentedQuotes } from './quote-healer.js';
export { tryHealJsonPayload } from './json-payload-healer.js';
export { buildWslEnvArgs, getUnderlyingPackageScript } from './command-env-utils.js';

export const isPwsh = (cmd: string): boolean => {
  const low = cmd.toLowerCase();
  return low === 'pwsh' || low === 'pwsh.exe' || low === 'powershell' || low === 'powershell.exe';
};
export const isCmd = (cmd: string): boolean => {
  const low = cmd.toLowerCase();
  return low === 'cmd' || low === 'cmd.exe';
};

export interface NodeCmdShimResolution {
  cmd: string;
  argsPrefix: string[];
  nodePath?: string;
}

const NODE_CMD_SHIM_CACHE = new Map<string, { mtimeMs: number; result: NodeCmdShimResolution | null }>();
const NODE_CMD_SHIM_CACHE_LIMIT = 128;
const WIN_CMD_SCRIPT_EXTS = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1']);
const WIN_RESOLVE_EXTS = ['.exe', '.cmd', '.bat', '.com', '.ps1'] as const;
const WIN_REL_EXTS = ['.exe', '.cmd', '.bat', '.com'] as const;
const WINDOWS_CMD_CACHE = new Map<string, string>();
const WINDOWS_CMD_CACHE_LIMIT = 256;

function findShimNodeExe(shimDir: string): string | null {
  const localNode = path.join(shimDir, 'node.exe');
  if (isExistingWindowsCommandFile(localNode)) return localNode;
  const rawPath = process.env['PATH'] ?? process.env['Path'] ?? '';
  const seen = new Set<string>();
  for (const rawDir of rawPath.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/g, '');
    if (dir.length === 0) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = path.join(dir, 'node.exe');
    if (isExistingWindowsCommandFile(candidate)) return candidate;
  }
  return null;
}

function parseNodeCmdShimContent(content: string, shimDir: string): NodeCmdShimResolution | null {
  // Match standard npm/pnpm/corepack cmd-shim and pnpm node_modules/.bin shim layouts.
  const shimMatch =
    /"(?:%_prog%|%~?dp0\\node\.exe|node)"\s+"%(?:dp0|~dp0)%?\\([^"\r\n]+)"\s+%\*/i.exec(content) ??
    /\bnode\s+"%(?:dp0|~dp0)%?\\([^"\r\n]+)"\s+%\*/i.exec(content);
  if (shimMatch === null || shimMatch[1] === undefined) return null;
  const relScript = shimMatch[1].replace(/^\\+/, '');
  if (relScript.length === 0 || relScript.includes('%')) return null;
  const resolvedScript = path.resolve(shimDir, relScript);
  if (!isExistingWindowsCommandFile(resolvedScript)) return null;
  const nodeExe = findShimNodeExe(shimDir);
  if (nodeExe === null) return null;
  const nodePathMatch = /@?SET\s+"NODE_PATH=([^"\r\n]+)"/i.exec(content);
  const rawNodePath = nodePathMatch?.[1]?.replace(/%NODE_PATH%/gi, '').replace(/;+$/, '');
  return rawNodePath !== undefined && rawNodePath.length > 0
    ? { cmd: nodeExe, argsPrefix: [resolvedScript], nodePath: rawNodePath }
    : { cmd: nodeExe, argsPrefix: [resolvedScript] };
}

/**
 * [INTENT]: Resolve standard npm/pnpm/corepack Node `.cmd` shims directly to `node.exe <script>` so Windows
 * execution avoids spawning `pwsh.exe -> cmd.exe -> node.exe` wrappers.
 */
export function resolveNodeCmdShim(cmd: string): NodeCmdShimResolution | null {
  if (process.platform !== 'win32' || !cmd.toLowerCase().endsWith('.cmd')) return null;
  const cacheKey = cmd.toLowerCase();
  let st: fs.Stats | undefined;
  try {
    st = fs.statSync(cmd, { throwIfNoEntry: false });
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.error(`⚠️ Node shim stat warning (${cmd}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
  if (st === undefined || !st.isFile() || st.size > 8192) return null;
  const cached = NODE_CMD_SHIM_CACHE.get(cacheKey);
  if (cached !== undefined && cached.mtimeMs === st.mtimeMs) {
    return cached.result;
  }
  let result: NodeCmdShimResolution | null;
  try {
    const content = fs.readFileSync(cmd, 'utf8');
    result = parseNodeCmdShimContent(content, path.dirname(cmd));
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT') {
      console.error(`⚠️ Node shim read warning (${cmd}): ${err instanceof Error ? err.message : String(err)}`);
    }
    result = null;
  }
  if (NODE_CMD_SHIM_CACHE.size >= NODE_CMD_SHIM_CACHE_LIMIT) NODE_CMD_SHIM_CACHE.clear();
  NODE_CMD_SHIM_CACHE.set(cacheKey, { mtimeMs: st.mtimeMs, result });
  return result;
}

/**
 * [INTENT]: Escape ASCII and Unicode smart single-quote characters recognized by PowerShell CharTraits.IsSingleQuote.
 */
export function escapePwshSingleQuoted(value: string): string {
  return value.replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&');
}

export function buildPwshWrapper(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const escapedCmd = escapePwshSingleQuoted(cmd);
  const escapedArgs = args.map(a => `'${escapePwshSingleQuoted(a)}'`).join(' ');
  const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\n$__ok = $?\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $__ok) { exit 1 } else { exit 0 }`;
  const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
  return {
    cmd: 'pwsh.exe',
    args: ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-EncodedCommand', encoded]
  };
}

export function escapeUnixArg(arg: string, allowGlobs = false): string {
  if (allowGlobs && /^[a-zA-Z0-9_\-./:*?]+$/.test(arg)) {
    return arg;
  }
  if (!allowGlobs && /^[a-zA-Z0-9_\-./:]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function tokenizeArgs(str: string): string[] {
  const args: string[] = [];
  let currentArg = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === undefined) continue;
    if (char === '\\' && quote !== "'") {
      let runLen = 1;
      while (str[i + runLen] === '\\') runLen++;
      const afterRun = str[i + runLen];
      if (afterRun === '"' || (quote === null && afterRun === "'")) {
        const pairCount = Math.floor(runLen / 2);
        if (pairCount > 0) currentArg += '\\'.repeat(pairCount);
        if (runLen % 2 === 1 && afterRun !== undefined) {
          currentArg += afterRun;
          i += runLen;
        } else {
          i += runLen - 1;
        }
        hasToken = true;
        continue;
      }
      currentArg += '\\'.repeat(runLen);
      hasToken = true;
      i += runLen - 1;
      continue;
    }
    if ((char === '"' || char === "'") && quote === null) { quote = char; hasToken = true; continue; }
    if (char === quote) { quote = null; continue; }
    if (/\s/.test(char) && quote === null) {
      if (hasToken) { args.push(currentArg); currentArg = ''; hasToken = false; }
      continue;
    }
    currentArg += char;
    hasToken = true;
  }
  if (hasToken) args.push(currentArg);
  return args;
}

export function applyTemplateOverride(templateOverride: string, baseCmd: string, baseArgs: string[], replaceTemplates: (str: string) => string): { cmd: string; args: string[] } {
  const innerCmdStr = [baseCmd, ...baseArgs]
    .map(a => a.length === 0 || /\s/.test(a) || a.includes('"') || a.includes("'") || a.endsWith('\\')
      ? `"${a.replace(/(?<!\\)(\\*)"/g, (_m, slashes: string) => `${slashes}${slashes}\\"`).replace(/(?<!\\)\\+$/, (m) => m + m)}"`
      : a)
    .join(' ');

  const fullOverride = templateOverride.includes('{{code}}')
    ? templateOverride.replace('{{code}}', () => innerCmdStr)
    : `${templateOverride} ${innerCmdStr}`;
    
  const allArgs = tokenizeArgs(fullOverride).map(a => replaceTemplates(a));
  const firstArg = allArgs[0];
  return firstArg !== undefined
    ? { cmd: firstArg, args: allArgs.slice(1) }
    : { cmd: baseCmd, args: baseArgs };
}

function tryFallbackLstatFile(candidate: string): boolean {
  try {
    const lst = fs.lstatSync(candidate, { throwIfNoEntry: false });
    return lst !== undefined && !lst.isDirectory();
  } catch {
    return false;
  }
}

function isExistingWindowsCommandFile(candidate: string): boolean {
  try {
    const st = fs.statSync(candidate, { throwIfNoEntry: false });
    if (st !== undefined) return st.isFile();
    return false;
  } catch (err: unknown) {
    // Windows Store AppExecLinks (WindowsApps\pwsh.exe) raise EACCES on stat(); check via lstatSync.
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code === 'EACCES' || code === 'EPERM') return tryFallbackLstatFile(candidate);
    return false;
  }
}

export function resolveWindowsCommand(cmd: string, cwd: string, payloadEnv?: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return cmd;
  if (cmd.includes('\\') || cmd.includes('/')) {
    const resolvedRel = path.isAbsolute(cmd) ? cmd : path.resolve(cwd, cmd);
    if (!/\.(?:exe|cmd|bat|com|ps1)$/i.test(resolvedRel)) {
      for (const ext of WIN_REL_EXTS) {
        if (isExistingWindowsCommandFile(`${resolvedRel}${ext}`)) return `${resolvedRel}${ext}`;
      }
    }
    if (isExistingWindowsCommandFile(resolvedRel)) return resolvedRel;
    return cmd;
  }

  const readCiPath = (source: Record<string, unknown> | undefined): string | undefined => {
    if (!source) return undefined;
    if (typeof source['PATH'] === 'string' && source['PATH'].length > 0) return source['PATH'];
    if (typeof source['Path'] === 'string' && source['Path'].length > 0) return source['Path'];
    for (const [k, v] of Object.entries(source)) {
      if (k.toUpperCase() === 'PATH' && typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };
  const payloadPathEnv = readCiPath(payloadEnv) ?? '';
  const processPathEnv = readCiPath(process.env) ?? '';
  const pathEnv = payloadPathEnv.length > 0
    ? (processPathEnv.length > 0 ? `${payloadPathEnv}${path.delimiter}${processPathEnv}` : payloadPathEnv)
    : processPathEnv;
  const cmdLower = cmd.toLowerCase();
  const cacheKey = `${cmdLower}\0${pathEnv}`;
  const cached = WINDOWS_CMD_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const hasExt = WIN_CMD_SCRIPT_EXTS.has(path.extname(cmdLower));
  const extsToCheck: readonly string[] = hasExt ? [''] : WIN_RESOLVE_EXTS;
  const seenDirs = new Set<string>();
  let resolved = cmd;
  outer: for (const rawDir of pathEnv.split(path.delimiter)) {
    const p = rawDir.trim().replace(/^"|"$/g, '');
    if (p.length === 0) continue;
    const dirKey = p.toLowerCase();
    if (seenDirs.has(dirKey)) continue;
    seenDirs.add(dirKey);
    for (const ext of extsToCheck) {
      const fullPath = path.join(p, cmd + ext);
      if (isExistingWindowsCommandFile(fullPath)) {
        resolved = fullPath;
        break outer;
      }
    }
  }
  if (WINDOWS_CMD_CACHE.size >= WINDOWS_CMD_CACHE_LIMIT) WINDOWS_CMD_CACHE.clear();
  WINDOWS_CMD_CACHE.set(cacheKey, resolved);
  return resolved;
}

export const RG_VALUE_FLAGS: readonly string[] = [
  '-A', '-B', '-C', '-d', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E',
  '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth',
  '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--replace', '--threads',
  '--encoding', '--ignore-file', '--max-filesize', '--sort', '--sortr', '--color', '--colors', '--engine',
  '--type-add', '--type-clear', '--pre', '--pre-glob', '--path-separator', '--context-separator',
  '--field-context-separator', '--field-match-separator', '--hyperlink-format', '--dfa-size-limit',
  '--regex-size-limit', '--hostname-bin', '--generate', '--label',
];

export const FLAGS_WITH_ARG_BY_TOOL: Record<string, string[]> = {
  grep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  egrep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  fgrep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  rg: [...RG_VALUE_FLAGS],
  sed: ['-e', '-f', '--expression', '--file'],
  awk: ['-F', '-v', '-f', '-W', '--field-separator', '--assign', '--file'],
  gawk: ['-F', '-v', '-f', '-W', '--field-separator', '--assign', '--file'],
  jq: ['-L', '--library-path', '-f', '--from-file', '--indent'],
  yq: ['-f', '--from-file'],
  head: ['-n', '--lines', '-c', '--bytes'],
  tail: ['-n', '--lines', '-c', '--bytes', '-s', '--sleep-interval', '--pid', '--max-unchanged-stats'],
  sort: ['-k', '--key', '-t', '--field-separator', '-o', '--output', '-T', '--temporary-directory', '-S', '--buffer-size', '--parallel', '--batch-size', '--compress-program', '--files0-from', '--random-source', '--sort'],
  uniq: ['-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars', '--all-repeated', '--group'],
  gpg: ['-u', '--local-user', '-r', '--recipient', '-R', '--hidden-recipient', '-o', '--output', '--passphrase', '--passphrase-fd', '--passphrase-file', '--cipher-algo', '--digest-algo', '--homedir', '--status-fd', '--command-fd', '--keyserver', '--pinentry-mode', '--default-key', '--import-options', '--export-options'],
};
export const FLAGS_WITH_ARG_SET_BY_TOOL: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(FLAGS_WITH_ARG_BY_TOOL).map(([tool, flags]) => [tool, new Set(flags)]),
);
const JQ_TWO_ARG_FLAGS = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--argfile']);
const PATTERN_FLAG_SET = new Set(['-e', '--regexp', '--expression']);
const SHORT_VALUE_CHARS_BY_TOOL: Record<string, string> = {
  grep: 'efmdDABC',
  egrep: 'efmdDABC',
  fgrep: 'efmdDABC',
  rg: 'ABCMdefgjmrtTE',
  sed: 'ef',
  awk: 'FvfW',
  gawk: 'FvfW',
  jq: 'Lf',
  yq: 'f',
  head: 'nc',
  tail: 'ncs',
  sort: 'ktoTS',
  uniq: 'fsw',
  gpg: 'urRo',
};

/** Return only the option-letter prefix before any attached short value operand (e.g. `-ieError` -> `-ie`). */
export function extractLeadingShortFlags(base: string, arg: string): string {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length <= 2) return arg;
  const valueChars = Object.hasOwn(SHORT_VALUE_CHARS_BY_TOOL, base) ? (SHORT_VALUE_CHARS_BY_TOOL[base] ?? '') : '';
  if (valueChars.length === 0) return arg;
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j] ?? '';
    if (valueChars.includes(ch)) return arg.slice(0, j + 1);
  }
  return arg;
}

export interface CombinedShortFlagInfo {
  shortPrefix: string;
  tailChar: string;
  takesSeparateValue: boolean;
  hasAttachedValue: boolean;
}

function hasFlagValueEntry(valueFlags: readonly string[] | ReadonlySet<string> | undefined, flag: string): boolean {
  if (valueFlags === undefined) return false;
  return 'has' in valueFlags ? valueFlags.has(flag) : valueFlags.includes(flag);
}

/** Inspect whether a combined short-flag token consumes a separate next arg or carries an attached operand. */
export function inspectCombinedShortFlag(
  base: string,
  arg: string,
  valueFlags?: readonly string[] | ReadonlySet<string>,
): CombinedShortFlagInfo {
  const shortPrefix = arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1 ? extractLeadingShortFlags(base, arg) : '';
  const tailChar = shortPrefix.length > 1 ? (shortPrefix[shortPrefix.length - 1] ?? '') : '';
  const exactMatch = hasFlagValueEntry(valueFlags, arg);
  const tailFlag = tailChar.length > 0 ? `-${tailChar}` : '';
  const tailMatch = tailFlag.length > 0 && hasFlagValueEntry(valueFlags, tailFlag);
  return {
    shortPrefix,
    tailChar,
    takesSeparateValue: exactMatch || (shortPrefix.length > 1 && arg.length === shortPrefix.length && tailMatch),
    hasAttachedValue: shortPrefix.length > 1 && arg.length > shortPrefix.length,
  };
}

function isAttachedPatternOrFileFlag(arg: string, includePattern: boolean): boolean {
  if (includePattern && ((arg.startsWith('-e') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--regexp=') || arg.startsWith('--expression='))) {
    return true;
  }
  return (arg.startsWith('-f') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--file=') || arg.startsWith('--from-file=');
}

function hasSearchShortOrLongFlag(cmd: string, args: readonly string[], longFlags: readonly string[], shortRe: RegExp): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_SET_BY_TOOL, base) ? FLAGS_WITH_ARG_SET_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (longFlags.includes(a)) return true;
    const info = inspectCombinedShortFlag(base, a, valueFlags);
    if (info.shortPrefix.length > 1 && shortRe.test(info.shortPrefix)) return true;
    if (info.takesSeparateValue) i++;
  }
  return false;
}

export function hasSearchFixedStringsFlag(cmd: string, args: readonly string[]): boolean {
  return hasSearchShortOrLongFlag(cmd, args, ['-F', '--fixed-strings'], /^-[a-zA-Z]*F[a-zA-Z]*$/);
}

export function hasSearchPcre2Flag(cmd: string, args: readonly string[]): boolean {
  return hasSearchShortOrLongFlag(cmd, args, ['-P', '--pcre2', '--perl-regexp'], /^-[a-zA-Z]*P[a-zA-Z]*$/);
}

const PATTERN_EXPR_TOOLS: ReadonlySet<string> = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'gawk', 'jq', 'yq',
]);

export function findPatternExprIndex(cmd: string, args: readonly string[]): number {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  if (!PATTERN_EXPR_TOOLS.has(base)) return -1;
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_SET_BY_TOOL, base) ? FLAGS_WITH_ARG_SET_BY_TOOL[base] : undefined;
  if (!toolFlags) return -1;

  // When pattern/script is supplied via flag or inline operand, remaining positionals are paths.
  const isPatternFlagTool = base === 'rg' || base === 'grep' || base === 'egrep' || base === 'fgrep' || base === 'sed';
  let patternSuppliedByFlag = false;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && isPatternFlagTool && PATTERN_FLAG_SET.has(a) && i + 1 < args.length) return i + 1;
    if (!seenDoubleDash && isAttachedPatternOrFileFlag(a, isPatternFlagTool)) { patternSuppliedByFlag = true; continue; }
    if (!seenDoubleDash && (base === 'jq' || base === 'yq') && JQ_TWO_ARG_FLAGS.has(a)) { i += 2; continue; }
    const shortInfo = !seenDoubleDash ? inspectCombinedShortFlag(base, a, toolFlags) : null;
    if (shortInfo !== null) {
      if (isPatternFlagTool && shortInfo.tailChar === 'e' && shortInfo.takesSeparateValue && i + 1 < args.length) return i + 1;
      if (shortInfo.hasAttachedValue && (shortInfo.tailChar === 'f' || (isPatternFlagTool && shortInfo.tailChar === 'e'))) { patternSuppliedByFlag = true; continue; }
    }
    if (!seenDoubleDash && (shortInfo?.takesSeparateValue || toolFlags.has(a))) {
      if (a === '-f' || a === '--file' || a === '--from-file' || (shortInfo?.tailChar === 'f' && shortInfo.takesSeparateValue)) patternSuppliedByFlag = true;
      i++;
      continue;
    }
    if (!seenDoubleDash && base === 'rg' && a === '--files') return -1;
    if (!seenDoubleDash && a.startsWith('-')) continue;
    if (!patternSuppliedByFlag) return i;
  }
  return -1;
}

export function getPositionalArgIndices(cmd: string, args: string[]): number[] {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_SET_BY_TOOL, base) ? FLAGS_WITH_ARG_SET_BY_TOOL[base] : undefined;
  const indices: number[] = [];
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && (base === 'jq' || base === 'yq') && JQ_TWO_ARG_FLAGS.has(a)) { i += 2; continue; }
    if (!seenDoubleDash && inspectCombinedShortFlag(base, a, toolFlags).takesSeparateValue) { i++; continue; }
    if (!seenDoubleDash && a.startsWith('-')) continue;
    indices.push(i);
  }
  return indices;
}

export function getPositionalArgs(cmd: string, args: string[]): string[] {
  return getPositionalArgIndices(cmd, args).map(idx => args[idx] ?? '');
}
