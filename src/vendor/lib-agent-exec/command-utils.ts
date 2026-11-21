// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
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
  const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Continue';\n$ProgressPreference = 'SilentlyContinue'; $ConfirmPreference = 'None';\n& '${escapedCmd}' ${escapedArgs}\nexit $LASTEXITCODE`;
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
    .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a) // codeql[js/incomplete-sanitization]
    .join(' ');
  
  const fullOverride = templateOverride.includes('{{code}}') 
    ? templateOverride.replace('{{code}}', innerCmdStr)
    : `${templateOverride} ${innerCmdStr}`;
    
  const allArgs = tokenizeArgs(fullOverride).map(a => replaceTemplates(a));
  return allArgs.length > 0 
    ? { cmd: allArgs[0], args: allArgs.slice(1) }
    : { cmd: baseCmd, args: baseArgs };
}

export function resolveWindowsCommand(cmd: string, cwd: string, payloadEnv?: Record<string, string | undefined>): string {
  if (process.platform !== 'win32') return cmd;
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd;
  
  const hasExt = ['.exe', '.cmd', '.bat', '.com', '.ps1'].some(ext => cmd.toLowerCase().endsWith(ext));
  const extsToCheck = hasExt ? [''] : ['.exe', '.cmd', '.bat', '.com', '.ps1'];

  let pathEnv = payloadEnv?.PATH || payloadEnv?.path || process.env.PATH;
  if (!pathEnv && process.platform === 'win32') {
    for (const key of Object.keys(process.env)) {
      if (key.toUpperCase() === 'PATH') {
        pathEnv = process.env[key];
        break;
      }
    }
  }
  const paths = (pathEnv || '').split(path.delimiter);
  
  for (const p of paths) {
    if (!p) continue;
    for (const ext of extsToCheck) {
      const fullPath = path.join(p, cmd + ext);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  }
  return cmd;
}

export const FLAGS_WITH_ARG_BY_TOOL: Record<string, string[]> = {
  grep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  egrep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  fgrep: ['-A', '-B', '-C', '-m', '-e', '-f', '-d', '-D', '--after-context', '--before-context', '--context', '--max-count', '--regexp', '--file', '--directories', '--devices', '--exclude', '--include', '--exclude-dir', '--exclude-from', '--include-from', '--label'],
  rg: ['-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E', '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth', '--regexp', '--file', '--glob', '--type', '--type-not', '--replace', '--threads', '--encoding', '--ignore-file', '--max-filesize'],
  sed: ['-e', '-f', '--expression', '--file'],
  awk: ['-F', '-v', '-f', '-W', '--field-separator', '--assign', '--file'],
  gawk: ['-F', '-v', '-f', '-W', '--field-separator', '--assign', '--file'],
  jq: ['-f', '--from-file', '--arg', '--argjson', '--slurpfile', '--rawfile', '--indent', '--tab'],
  yq: ['-f', '--from-file']
};

export function findPatternExprIndex(cmd: string, args: string[]): number {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  if (base === 'rg' && args.includes('--files')) {
    return -1;
  }
  const toolFlags = FLAGS_WITH_ARG_BY_TOOL[base];
  if (!toolFlags) {
    return -1;
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['-e', '--regexp', '--expression'].includes(a) && i + 1 < args.length) {
      return i + 1;
    }
  }

  // When the pattern/script is supplied via a file flag (-f, --file, --from-file), every positional
  // argument is an input file, so Windows-style paths must not be mistaken for the pattern.
  // Otherwise the first positional is the pattern even if it looks like a Windows path
  // (e.g. grep -P 'C:\path\to\file\.txt\d+'), and it must be protected from path conversion.
  let patternFromFile = false;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && toolFlags.includes(a)) {
      if (a === '-f' || a === '--file' || a === '--from-file') {
        patternFromFile = true;
      }
      i++;
      continue;
    }
    if (!seenDoubleDash && a.startsWith('-')) {
      continue;
    }
    if (patternFromFile && /^[a-zA-Z]:[/\\]/.test(a)) {
      continue;
    }
    return i;
  }

  return -1;
}

export function getPositionalArgs(cmd: string, args: string[]): string[] {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const toolFlags = FLAGS_WITH_ARG_BY_TOOL[base];
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
    if (!seenDoubleDash && toolFlags.includes(a)) {
      i++;
      continue;
    }
    if (!seenDoubleDash && a.startsWith('-')) {
      continue;
    }
    result.push(a);
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
    if (v !== undefined && v !== null) {
      if (k.toUpperCase() === 'PATH') {
        hasExplicitPath = true;
      }
      wslEnvArgs.push(`${k}=${convertToWslPath(String(v))}`);
    }
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

export function getUnderlyingPackageScript(cmdBasename: string, args: string[] | undefined, payloadCwd: string | undefined): string {
  const base = cmdBasename.toLowerCase().replace(/\.(cmd|exe)$/i, '');
  if (!['pnpm', 'npm', 'bun', 'yarn'].includes(base) || !args || args.length === 0) return '';
  const nonFlagArgs = args.filter(a => !a.startsWith('-'));
  const scriptName = (nonFlagArgs[0] === 'run' || nonFlagArgs[0] === 'exec') ? nonFlagArgs[1] : nonFlagArgs[0];
  if (!scriptName) return '';
  try {
    const cwd = payloadCwd !== undefined && payloadCwd.length > 0 ? path.resolve(payloadCwd) : process.cwd();
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && typeof pkg.scripts[scriptName] === 'string') {
        return pkg.scripts[scriptName];
      }
    }
  } catch {
    // ignore
  }
  return '';
}
