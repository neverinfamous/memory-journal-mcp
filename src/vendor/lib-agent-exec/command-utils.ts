// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import { convertToWslPath } from './path-convert.js';

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
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escapeNext) {
      currentArg += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      currentArg += char;
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      currentArg += char;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      currentArg += char;
      continue;
    }
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }
  if (currentArg.length > 0) {
    args.push(currentArg);
  }
  return args;
}

export function applyTemplateOverride(templateOverride: string, baseCmd: string, baseArgs: string[], replaceTemplates: (str: string) => string): { cmd: string; args: string[] } {
  const innerCmdStr = [baseCmd, ...baseArgs]
    .map(a => a.includes(' ') || a.includes('"') || a.includes("'")
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
  '-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E',
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
  jq: ['-f', '--from-file', '--indent'],
  yq: ['-f', '--from-file']
};
const JQ_TWO_ARG_FLAGS = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile']);
const SHORT_VALUE_CHARS_BY_TOOL: Record<string, string> = {
  grep: 'efmdDABC',
  egrep: 'efmdDABC',
  fgrep: 'efmdDABC',
  rg: 'ABCMdefgjmrtTE',
  sed: 'ef',
};

/** Return only the option-letter prefix before any attached short value operand (e.g. `-ieError` -> `-ie`). */
export function extractLeadingShortFlags(base: string, arg: string): string {
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length <= 2) return arg;
  const valueChars = SHORT_VALUE_CHARS_BY_TOOL[base] ?? '';
  if (valueChars.length === 0) return arg;
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j] ?? '';
    if (valueChars.includes(ch)) return arg.slice(0, j + 1);
  }
  return arg;
}

function isAttachedPatternOrFileFlag(arg: string, includePattern: boolean): boolean {
  if (includePattern && ((arg.startsWith('-e') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--regexp=') || arg.startsWith('--expression='))) {
    return true;
  }
  return (arg.startsWith('-f') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--file=') || arg.startsWith('--from-file=');
}

export function hasSearchFixedStringsFlag(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-F' || a === '--fixed-strings') return true;
    const head = extractLeadingShortFlags(base, a);
    if (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*F[a-zA-Z]*$/.test(head)) return true;
    if (valueFlags !== undefined && valueFlags.includes(a)) i++;
  }
  return false;
}

export function hasSearchPcre2Flag(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-P' || a === '--pcre2' || a === '--perl-regexp') return true;
    const head = extractLeadingShortFlags(base, a);
    if (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*P[a-zA-Z]*$/.test(head)) return true;
    if (valueFlags !== undefined && valueFlags.includes(a)) i++;
  }
  return false;
}

export function findPatternExprIndex(cmd: string, args: string[]): number {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const ddIdx = args.indexOf('--');
  const preDdArgs = ddIdx === -1 ? args : args.slice(0, ddIdx);
  if (base === 'rg' && preDdArgs.includes('--files')) {
    return -1;
  }
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  if (!toolFlags) {
    return -1;
  }

  // When the pattern/script is supplied via a file or inline expression flag, positional arguments
  // are input files rather than the pattern, so Windows-style file paths remain eligible for conversion.
  const isPatternFlagTool = base === 'rg' || base === 'grep' || base === 'egrep' || base === 'fgrep' || base === 'sed';
  let patternSuppliedByFlag = false;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && isPatternFlagTool && ['-e', '--regexp', '--expression'].includes(a) && i + 1 < args.length) {
      return i + 1;
    }
    if (!seenDoubleDash && isAttachedPatternOrFileFlag(a, isPatternFlagTool)) {
      patternSuppliedByFlag = true;
      continue;
    }
    if (!seenDoubleDash && base === 'jq' && JQ_TWO_ARG_FLAGS.has(a)) {
      i += 2;
      continue;
    }
    if (!seenDoubleDash && toolFlags.includes(a)) {
      if (a === '-f' || a === '--file' || a === '--from-file') {
        patternSuppliedByFlag = true;
      }
      i++;
      continue;
    }
    if (!seenDoubleDash && a.startsWith('-')) {
      continue;
    }
    if (patternSuppliedByFlag) {
      continue;
    }
    return i;
  }

  return -1;
}

export function getPositionalArgs(cmd: string, args: string[]): string[] {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  if (!toolFlags) {
    const result: string[] = [];
    let seenDoubleDash = false;
    for (const a of args) {
      if (!seenDoubleDash && a === '--') {
        seenDoubleDash = true;
        continue;
      }
      if (!seenDoubleDash && a.startsWith('-')) {
        continue;
      }
      result.push(a);
    }
    return result;
  }

  const result: string[] = [];
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && base === 'jq' && a !== undefined && JQ_TWO_ARG_FLAGS.has(a)) {
      i += 2;
      continue;
    }
    if (!seenDoubleDash && a !== undefined && toolFlags.includes(a)) {
      i++;
      continue;
    }
    if (!seenDoubleDash && a !== undefined && a.startsWith('-')) {
      continue;
    }
    if (a !== undefined) result.push(a);
  }
  return result;
}

export function buildWslEnvArgs(payloadEnv?: Record<string, unknown>, envOverrides: Record<string, string> = {}): string[] {
  const wslEnvArgs: string[] = [];
  const wslUuid = crypto.randomUUID();
  wslEnvArgs.push(`AGENT_EXEC_WSL_UUID=${wslUuid}`);
  const env = payloadEnv ?? {};
  let hasExplicitPath = false;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null || k.length === 0 || /[=\r\n\0]/.test(k)) continue;
    if (k === 'AGENT_EXEC_WSL_UUID' || IMMUTABLE_ENV_OVERRIDES.has(k.toUpperCase())) continue;
    if (k.toUpperCase() === 'PATH') {
      hasExplicitPath = true;
    }
    wslEnvArgs.push(`${k}=${convertToWslPath(String(v))}`);
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    if (k.toUpperCase() === 'PATH') {
      hasExplicitPath = true;
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

export function getUnderlyingPackageScript(cmdBasename: string, args: string[] | undefined, payloadCwd: string | undefined): string {
  const base = cmdBasename.toLowerCase().replace(/\.(cmd|exe)$/i, '');
  if (!['pnpm', 'npm', 'bun', 'yarn'].includes(base) || !args || args.length === 0) return '';
  const nonFlagArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (PKG_SCRIPT_VALUE_FLAGS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    nonFlagArgs.push(a);
  }
  const scriptName = (nonFlagArgs[0] === 'run' || nonFlagArgs[0] === 'exec') ? nonFlagArgs[1] : nonFlagArgs[0];
  if (!scriptName) return '';
  try {
    const cwd = payloadCwd !== undefined && payloadCwd.length > 0 ? path.resolve(payloadCwd) : process.cwd();
    const pkgPath = path.join(cwd, 'package.json');
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
