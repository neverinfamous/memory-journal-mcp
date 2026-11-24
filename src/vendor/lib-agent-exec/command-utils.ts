// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import { convertToWindowsPath, convertToWslPath } from './path-convert.js';

export { formatForCmdExe, convertToWslPath, convertToWindowsPath } from './path-convert.js';
export { healRegexPattern, sanitizeWslRegex } from './regex-healer.js';
export { healFragmentedQuotes } from './quote-healer.js';
export { tryHealJsonPayload } from './json-payload-healer.js';

export const isPwsh = (cmd: string) => ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd.toLowerCase());
export const isCmd = (cmd: string) => ['cmd', 'cmd.exe'].includes(cmd.toLowerCase());

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
      ? `"${a.replace(/(\\*)"/g, (_m, slashes: string) => `${slashes}${slashes}\\"`).replace(/\\+$/, (m) => m + m)}"`
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
      for (const ext of ['.exe', '.cmd', '.bat', '.com']) {
        if (isExistingWindowsCommandFile(`${resolvedRel}${ext}`)) return `${resolvedRel}${ext}`;
      }
    }
    if (isExistingWindowsCommandFile(resolvedRel)) return resolvedRel;
    return cmd;
  }

  const hasExt = ['.exe', '.cmd', '.bat', '.com', '.ps1'].some(ext => cmd.toLowerCase().endsWith(ext));
  const extsToCheck = hasExt ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1'];

  const readCiEnv = (source: Record<string, unknown> | undefined): string | undefined => {
    if (!source) return undefined;
    for (const [k, v] of Object.entries(source)) {
      if (k.toUpperCase() === 'PATH' && typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };
  const pathEnv = [readCiEnv(payloadEnv), readCiEnv(process.env)].filter((v): v is string => v !== undefined && v.length > 0).join(path.delimiter);
  const paths = pathEnv.split(path.delimiter).map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean);

  for (const p of paths) {
    for (const ext of extsToCheck) {
      const fullPath = path.join(p, cmd + ext);
      if (isExistingWindowsCommandFile(fullPath)) return fullPath;
    }
  }
  return cmd;
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
  gpg: ['-u', '--local-user', '-r', '--recipient', '-R', '--hidden-recipient', '-o', '--output', '--passphrase', '--passphrase-fd', '--passphrase-file', '--cipher-algo', '--digest-algo', '--homedir', '--status-fd', '--command-fd', '--keyserver', '--pinentry-mode', '--default-key', '--import-options', '--export-options', '--verify'],
};
const JQ_TWO_ARG_FLAGS = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--argfile']);
const SHORT_VALUE_CHARS_BY_TOOL: Record<string, string> = {
  grep: 'efmdDABC',
  egrep: 'efmdDABC',
  fgrep: 'efmdDABC',
  rg: 'ABCMdefgjmrtTE',
  sed: 'ef',
  jq: 'Lf',
  head: 'nc',
  tail: 'ncs',
  sort: 'ktoTS',
  uniq: 'fsw',
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
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
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

export function findPatternExprIndex(cmd: string, args: string[]): number {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const ddIdx = args.indexOf('--');
  if (base === 'rg' && (ddIdx === -1 ? args : args.slice(0, ddIdx)).includes('--files')) return -1;
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  if (!toolFlags) return -1;

  // When pattern/script is supplied via flag or inline operand, remaining positionals are paths.
  const isPatternFlagTool = base === 'rg' || base === 'grep' || base === 'egrep' || base === 'fgrep' || base === 'sed';
  let patternSuppliedByFlag = false;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && isPatternFlagTool && ['-e', '--regexp', '--expression'].includes(a) && i + 1 < args.length) return i + 1;
    if (!seenDoubleDash && isAttachedPatternOrFileFlag(a, isPatternFlagTool)) { patternSuppliedByFlag = true; continue; }
    if (!seenDoubleDash && (base === 'jq' || base === 'yq') && JQ_TWO_ARG_FLAGS.has(a)) { i += 2; continue; }
    const shortInfo = !seenDoubleDash ? inspectCombinedShortFlag(base, a, toolFlags) : null;
    if (shortInfo !== null && isPatternFlagTool) {
      if (shortInfo.tailChar === 'e' && shortInfo.takesSeparateValue && i + 1 < args.length) return i + 1;
      if (shortInfo.hasAttachedValue && (shortInfo.tailChar === 'e' || shortInfo.tailChar === 'f')) { patternSuppliedByFlag = true; continue; }
    }
    if (!seenDoubleDash && (shortInfo?.takesSeparateValue || toolFlags.includes(a))) {
      if (a === '-f' || a === '--file' || a === '--from-file' || (shortInfo?.tailChar === 'f' && shortInfo.takesSeparateValue)) patternSuppliedByFlag = true;
      i++;
      continue;
    }
    if (!seenDoubleDash && a.startsWith('-')) continue;
    if (!patternSuppliedByFlag) return i;
  }
  return -1;
}

export function getPositionalArgIndices(cmd: string, args: string[]): number[] {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
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

export function buildWslEnvArgs(payloadEnv?: Record<string, unknown>, envOverrides: Record<string, string> = {}): string[] {
  const wslEnvArgs: string[] = [];
  const wslUuid = crypto.randomUUID();
  wslEnvArgs.push(`AGENT_EXEC_WSL_UUID=${wslUuid}`);
  const env = payloadEnv ?? {};
  let hasExplicitPath = false;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null || k.length === 0 || /[=\r\n\0]/.test(k)) continue;
    const upperKey = k.toUpperCase();
    if (upperKey === 'AGENT_EXEC_WSL_UUID' || IMMUTABLE_ENV_OVERRIDES.has(upperKey)) continue;
    if (upperKey === 'PATH') {
      hasExplicitPath = true;
      const rawPath = String(v);
      const wslPathVal = /[a-zA-Z]:[/\\]/.test(rawPath)
        ? rawPath.split(';').filter(Boolean).map(seg => convertToWslPath(seg)).join(':')
        : rawPath;
      wslEnvArgs.push(`PATH=${wslPathVal}`);
      continue;
    }
    wslEnvArgs.push(`${k}=${convertToWslPath(String(v))}`);
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    const upperKey = k.toUpperCase();
    if (upperKey === 'PATH') {
      hasExplicitPath = true;
      const wslPathVal = /[a-zA-Z]:[/\\]/.test(v)
        ? v.split(';').filter(Boolean).map(seg => convertToWslPath(seg)).join(':')
        : v;
      wslEnvArgs.push(`PATH=${wslPathVal}`);
      continue;
    }
    wslEnvArgs.push(`${k}=${convertToWslPath(v)}`);
  }

  if (!hasExplicitPath) {
    const wslUser = (process.env.WSL_USER ?? path.basename(os.homedir())).trim() || 'ubuntu';
    const defaultWslPathsList = [
      `/home/${wslUser}/.bun/bin`,
      `/home/${wslUser}/.cargo/bin`,
      `/home/${wslUser}/.local/bin`,
      '/root/.bun/bin',
      '/root/.cargo/bin',
      '/root/.local/bin',
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
    ];
    if (process.env.APPDATA !== undefined && process.env.APPDATA.length > 0) {
      defaultWslPathsList.push(convertToWslPath(path.join(process.env.APPDATA, 'npm')));
    } else {
      defaultWslPathsList.push(convertToWslPath(path.join(os.homedir(), 'AppData', 'Roaming', 'npm')));
    }
    const defaultWslPaths = defaultWslPathsList.join(':');
    wslEnvArgs.push(`PATH=${defaultWslPaths}`);
  }

  return wslEnvArgs;
}

export { handleWindowsUnixCommandWrappers, expandGlobArgsInProcess } from './windows-wrapper-utils.js';

const PKG_SCRIPT_VALUE_FLAGS = new Set([
  '--filter', '-F', '-C', '--dir', '--cwd', '--prefix', '--config', '-c',
]);
const PKG_DIR_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix']);

function normalizePkgCwd(rawDir: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawDir)
    ? convertToWindowsPath(rawDir)
    : rawDir;
}

function resolvePkgScriptDir(payloadCwd: string | undefined, dirFlagVal: string | undefined): string {
  const normBase = payloadCwd !== undefined && payloadCwd.length > 0 ? normalizePkgCwd(payloadCwd) : process.cwd();
  const baseCwd = path.resolve(normBase);
  if (dirFlagVal === undefined || dirFlagVal.length === 0) return baseCwd;
  const normFlag = normalizePkgCwd(dirFlagVal);
  return path.isAbsolute(normFlag) ? path.normalize(normFlag) : path.resolve(baseCwd, normFlag);
}

export function getUnderlyingPackageScript(cmdBasename: string, args: string[] | undefined, payloadCwd: string | undefined): string {
  const base = cmdBasename.toLowerCase().replace(/\.(cmd|exe)$/i, '');
  if (!['pnpm', 'npm', 'bun', 'yarn'].includes(base) || !args || args.length === 0) return '';
  const nonFlagArgs: string[] = [];
  let dirFlagVal: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const eqIdx = a.indexOf('=');
    const flagKey = eqIdx === -1 ? a : a.slice(0, eqIdx);
    if (eqIdx !== -1 && PKG_DIR_FLAGS.has(flagKey)) {
      dirFlagVal = a.slice(eqIdx + 1);
      continue;
    }
    if (PKG_SCRIPT_VALUE_FLAGS.has(a)) {
      if (PKG_DIR_FLAGS.has(a) && args[i + 1] !== undefined) dirFlagVal = args[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    nonFlagArgs.push(a);
  }
  const scriptName = (nonFlagArgs[0] === 'run' || nonFlagArgs[0] === 'exec') ? nonFlagArgs[1] : nonFlagArgs[0];
  if (!scriptName) return '';
  try {
    const pkgPath = path.join(resolvePkgScriptDir(payloadCwd, dirFlagVal), 'package.json');
    if (!fs.existsSync(pkgPath)) return '';
    const pkg: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg) || !Object.hasOwn(pkg, 'scripts')) return '';
    const scriptsEntry = Object.entries(pkg).find(([k]) => k === 'scripts')?.[1];
    if (scriptsEntry === null || typeof scriptsEntry !== 'object' || Array.isArray(scriptsEntry)) return '';
    const val = Object.entries(scriptsEntry).find(([k]) => k === scriptName)?.[1];
    return typeof val === 'string' ? val : '';
  } catch {
    return '';
  }
}
