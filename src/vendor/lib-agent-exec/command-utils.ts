// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { ExecPayload } from './schema.js';

export const isPwsh = (cmd: string) => ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmd.toLowerCase());
export const isCmd = (cmd: string) => ['cmd', 'cmd.exe'].includes(cmd.toLowerCase());

export function formatForCmdExe(args: string[]): string[] {
  if (args[0]?.toLowerCase() !== '/c') return args;
  const originalCmdAndArgs = args.slice(1);
  const commandLine = originalCmdAndArgs.map(arg => {
    let crtArg = arg;
    if (/[ \t\n\v"]/.test(arg) || arg.length === 0) {
      crtArg = arg.replace(/(\\+)(")/g, '$1$1$2');
      crtArg = crtArg.replace(/"/g, '\\"');
      crtArg = `"${crtArg}"`;
    }
    let cmdArg = '';
    let inQuotes = false;
    for (let i = 0; i < crtArg.length; i++) {
      const char = crtArg[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        cmdArg += char;
      } else if (!inQuotes && /[&|<>^]/.test(char)) {
        cmdArg += '^' + char;
      } else {
        cmdArg += char;
      }
    }
    return cmdArg;
  }).join(' ');
  return ['/d', '/s', '/c', `"${commandLine}"`];
}

export function convertToWslPath(winPath: string): string {
  if (winPath.startsWith('^') || winPath.startsWith('$')) {
    return winPath;
  }

  if (!winPath || typeof winPath !== 'string') {
    return winPath ?? '';
  }

  const transform = (p: string) => {
    return p.replace(/^([a-zA-Z]):[/\\]+(.*)/, (match, drive, rest) => `/mnt/${drive.toLowerCase()}/${rest.replace(/\\+/g, '/')}`);
  };

  if (path.win32.isAbsolute(winPath)) {
    return transform(winPath);
  }

  const doubleQuoteMatch = winPath.match(/^"(.+)"$/);
  const singleQuoteMatch = winPath.match(/^'(.+)'$/);
  if (doubleQuoteMatch && path.win32.isAbsolute(doubleQuoteMatch[1])) {
    return `"${transform(doubleQuoteMatch[1])}"`;
  }
  if (singleQuoteMatch && path.win32.isAbsolute(singleQuoteMatch[1])) {
    return `'${transform(singleQuoteMatch[1])}'`;
  }

  const kvMatch = winPath.match(/^([a-zA-Z0-9_-]+[=:])(.+)$/);
  if (kvMatch) {
    const prefix = kvMatch[1];
    const value = kvMatch[2];
    
    const doubleQuoteMatchValue = value.match(/^"(.+)"$/);
    const singleQuoteMatchValue = value.match(/^'(.+)'$/);
    
    if (doubleQuoteMatchValue && path.win32.isAbsolute(doubleQuoteMatchValue[1])) {
      return `${prefix}"${transform(doubleQuoteMatchValue[1])}"`;
    }
    if (singleQuoteMatchValue && path.win32.isAbsolute(singleQuoteMatchValue[1])) {
      return `${prefix}'${transform(singleQuoteMatchValue[1])}'`;
    }
    if (path.win32.isAbsolute(value)) {
      return `${prefix}${transform(value)}`;
    }
    if (value.includes('\\')) {
      if (/[{}`;|"'<>:]/.test(value)) return winPath;
      if (value.includes(' ') && !fs.existsSync(value.trim())) return winPath;
      if (value.trim().endsWith('\\') && !fs.existsSync(value.trim())) return winPath;
      if (prefix.endsWith(':') && !/^[a-zA-Z]:[/\\]/.test(value.trim())) return winPath;
      return `${prefix}${value.replace(/\\/g, '/')}`;
    }
  }

  if (!winPath.startsWith('-') && winPath.includes('\\')) {
    if (/[{}`;|"'<>:]/.test(winPath)) return winPath;
    if (winPath.includes(' ') && !fs.existsSync(winPath)) return winPath;
    if (winPath.endsWith('\\') && !fs.existsSync(winPath)) return winPath;
    return winPath.replace(/\\/g, '/');
  }

  return winPath;
}

export function buildPwshWrapper(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const escapedCmd = cmd.replace(/'/g, "''");
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(' ');
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

export function healRegexPattern(pattern: string): string {
  try {
    new RegExp(pattern);
    return pattern;
  } catch {
    const parenStack: number[] = [];
    const bracketStack: number[] = [];
    let isEscaped = false;

    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (ch === '\\') {
        isEscaped = true;
        continue;
      }
      if (ch === '(') {
        parenStack.push(i);
      } else if (ch === ')') {
        if (parenStack.length > 0) {
          parenStack.pop();
        }
      } else if (ch === '[') {
        bracketStack.push(i);
      } else if (ch === ']') {
        if (bracketStack.length > 0) {
          bracketStack.pop();
        }
      }
    }

    const unclosedIndices = new Set([...parenStack, ...bracketStack]);
    if (isEscaped) {
      unclosedIndices.add(pattern.length - 1);
    }

    if (unclosedIndices.size > 0) {
      let result = '';
      for (let i = 0; i < pattern.length; i++) {
        if (unclosedIndices.has(i)) {
          result += '\\' + pattern[i];
        } else {
          result += pattern[i];
        }
      }
      try {
        new RegExp(result);
        return result;
      } catch {
        // Fallback below
      }
    }

    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export function sanitizeWslRegex(regexArg: string): string {
  let sanitized = regexArg;
  if (sanitized.startsWith('"') && sanitized.endsWith('"') && sanitized.length >= 2) {
    sanitized = sanitized.slice(1, -1);
  } else if (sanitized.startsWith("'") && sanitized.endsWith("'") && sanitized.length >= 2) {
    sanitized = sanitized.slice(1, -1);
  }

  // In Rust's regex engine (ripgrep), backslashes before unrecognized ASCII letters
  // (e.g. \R in \README.md or Windows path separators) cause syntax parse errors.
  // Valid Rust letter escapes: a, f, t, n, r, v, d, D, s, S, w, W, b, B, A, z, p, P, x, u, U, k
  const validRustEscapes = new Set([
    'a', 'f', 't', 'n', 'r', 'v',
    'd', 'D', 's', 'S', 'w', 'W',
    'b', 'B', 'A', 'z',
    'p', 'P', 'x', 'u', 'U', 'k'
  ]);

  let healedEscapes = '';
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (ch === '\\') {
      const next = sanitized[i + 1];
      if (next === '\\') {
        healedEscapes += '\\\\';
        i++;
        continue;
      }
      if (next !== undefined && /[a-zA-Z]/.test(next) && !validRustEscapes.has(next)) {
        healedEscapes += '\\\\';
        continue;
      }
    }
    healedEscapes += ch;
  }

  return healRegexPattern(healedEscapes);
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
    .map(a => a.includes(' ') || a.includes('"') || a.includes("'") ? `"${a.replace(/"/g, '\\"')}"` : a)
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

const FLAGS_WITH_ARG_BY_TOOL: Record<string, string[]> = {
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (toolFlags.includes(a)) {
      if (a === '-f' || a === '--file' || a === '--from-file') {
        patternFromFile = true;
      }
      i++;
      continue;
    }
    if (a.startsWith('-')) {
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
    return args.filter(a => !a.startsWith('-'));
  }

  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (toolFlags.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) {
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
    const defaultWslPathsList = [
      '/home/chris/.bun/bin',
      '/home/chris/.cargo/bin',
      '/home/chris/.local/bin',
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
      defaultWslPathsList.push('/mnt/c/Users/chris/AppData/Roaming/npm');
    }
    const defaultWslPaths = defaultWslPathsList.join(':');
    wslEnvArgs.push(`PATH=${defaultWslPaths}`);
  }

  return wslEnvArgs;
}

export function handleWindowsUnixCommandWrappers(
  cmd: string,
  args: string[],
  payload: ExecPayload
): { cmd: string; args: string[] } {
  let resolvedCmd = cmd;
  let resolvedArgs = args;

  if (resolvedCmd === 'find' || resolvedCmd === 'find.exe') {
    const isUnixFind = resolvedArgs.some(a => a.startsWith('-name') || a.startsWith('-type') || a.startsWith('-exec') || a.startsWith('-mtime') || a === '.' || a === '..');
    if (isUnixFind) {
      const originalArgs = resolvedArgs.map(a => escapeUnixArg(a, false)).join(' ');
      console.error(`\n   💡 AGENT HINT: Detected Unix-style 'find' command. Forwarding to 'sh -c' to bypass Windows find.exe limits.`);
      resolvedCmd = 'sh';
      resolvedArgs = ['-c', `find ${originalArgs}`];
    }
  }

  // Handle glob expansion for Unix utilities running on Windows without a shell
  const cmdBasenameForGlob = path.basename(resolvedCmd).toLowerCase().replace(/\.exe$/, '');
  const unixUtilsForGlob = ['grep', 'ls', 'rm', 'cp', 'mv', 'cat', 'rg'];
  if (unixUtilsForGlob.includes(cmdBasenameForGlob)) {
    const patternExprIdx = findPatternExprIndex(cmdBasenameForGlob, resolvedArgs);
    const hasGlobs = resolvedArgs.some((a, idx) => {
      if (idx === patternExprIdx) return false;
      if (idx > 0) {
        const prev = resolvedArgs[idx - 1];
        if (['-g', '--glob', '--include', '--exclude', '-name', '-iname', '-path', '-wholename', '-filter'].includes(prev)) {
          return false;
        }
      }
      if (a.startsWith('-g=') || a.startsWith('--glob=') || a.startsWith('--include=') || a.startsWith('--exclude=')) {
        return false;
      }
      return (a.includes('*') || a.includes('?')) && !a.startsWith('-');
    });
    if (hasGlobs) {
      const originalArgs = resolvedArgs.map((a, idx) => {
        if (idx === patternExprIdx) return escapeUnixArg(a, false);
        return escapeUnixArg(convertToWslPath(a), true);
      }).join(' ');
      console.error(`\n   💡 AGENT HINT: Detected Unix utility '${cmdBasenameForGlob}' with glob patterns (* or ?).`);
      console.error(`   🛠️ AUTONOMOUS HEALING: Because 'shell: false' is used, globs are not expanded automatically. Routing through 'sh -c' to expand globs...`);
      if (cmdBasenameForGlob === 'ls') {
        resolvedCmd = 'bash';
        resolvedArgs = ['-c', `shopt -s nullglob; files=(${originalArgs}); if [ \${#files[@]} -gt 0 ]; then ls "\${files[@]}"; fi`];
      } else {
        resolvedCmd = 'sh';
        resolvedArgs = ['-c', `${cmdBasenameForGlob} ${originalArgs}`];
      }
      if (process.platform === 'win32' && payload.target !== 'wsl2') {
        payload.target = 'wsl2';
      }
    }
  }

  return { cmd: resolvedCmd, args: resolvedArgs };
}

export function healFragmentedQuotes(args: string[]): string[] {
  const currentArgs = [...args];
  let i = 0;

  const endsWithUnescapedBackslash = (s: string): boolean => {
    if (!s.endsWith('\\')) return false;
    let count = 0;
    for (let j = s.length - 1; j >= 0 && s[j] === '\\'; j--) {
      count++;
    }
    return count % 2 === 1;
  };

  const startsWithUnescapedBackslash = (s: string): boolean => {
    if (!s.startsWith('\\') || s.startsWith('\\\\')) return false;
    const withoutLeading = s.slice(1);
    // Ignore root-relative Windows directory paths like \Windows\System32 or \Users\
    if (/^[a-zA-Z0-9_-]+[\\/]/.test(withoutLeading)) {
      return false;
    }
    return true;
  };

  const isPathWithTrailingSlash = (s: string): boolean => {
    if (/[|<>"`']/.test(s) || s.includes('===') || s.includes('!==')) {
      return false;
    }
    if (/^[a-zA-Z]:\\/i.test(s) || /^\.\.?\\/.test(s) || /^\\\\/.test(s)) {
      return true;
    }
    const withoutTrailing = s.slice(0, -1);
    if (withoutTrailing.includes('/') || withoutTrailing.includes('\\')) {
      const strippedEscapes = withoutTrailing.replace(
        /\\([.*+?^${}()|[\]\\"'`~<>:;!@#%&=,\-_/]|w|W|d|D|s|S|b|B|[0-9])/g,
        ''
      );
      if (strippedEscapes.includes('\\') || strippedEscapes.includes('/')) {
        return true;
      }
    }
    return false;
  };

  const isPureWordWithTrailingSlash = (s: string): boolean => {
    if (!endsWithUnescapedBackslash(s) || s.startsWith('-') || s.includes('/')) {
      return false;
    }
    // Avoid treating Windows paths (e.g. C:\..., .\..., ..\..., or paths with directory separators) as fragmented words
    const withoutTrailing = s.slice(0, -1);
    if (/^[a-zA-Z]:\\/i.test(s) || /^\.\.?\\/.test(s) || /^\\\\/.test(s)) {
      return false;
    }
    // Strip common escape sequences used in regex or quoted patterns (e.g. \., \*, \+, \?, \(, \), \[, \], \w, \d, \s, etc.)
    const strippedEscapes = withoutTrailing.replace(
      /\\([.*+?^${}()|[\]\\"'`~<>:;!@#%&=,\-_/]|w|W|d|D|s|S|b|B|[0-9])/g,
      ''
    );
    return !strippedEscapes.includes('\\');
  };

  // 1. Detect quotes split across arguments by shell tokenization (e.g. ["\"not", "found\""] or ["'not", "found'"])
  let quoteIdx = 0;
  while (quoteIdx < currentArgs.length) {
    const current = currentArgs[quoteIdx];
    if (current !== undefined) {
      const isEscapedDouble = current.startsWith('\\"') && !current.slice(2).endsWith('\\"');
      const isPlainDouble = current.startsWith('"') && !current.slice(1).endsWith('"');
      const isSingle = current.startsWith("'") && !current.slice(1).endsWith("'");

      if (isEscapedDouble || isPlainDouble || isSingle) {
        let matchingIdx = -1;
        for (let j = quoteIdx + 1; j < currentArgs.length; j++) {
          const next = currentArgs[j];
          if (next === undefined) break;
          if (isEscapedDouble && (next.endsWith('\\"') || next.endsWith('"'))) {
            matchingIdx = j;
            break;
          } else if (isPlainDouble && (next.endsWith('"') || next.endsWith('\\"'))) {
            matchingIdx = j;
            break;
          } else if (isSingle && next.endsWith("'")) {
            matchingIdx = j;
            break;
          }
        }

        if (matchingIdx !== -1) {
          const slice = currentArgs.slice(quoteIdx, matchingIdx + 1);
          let joined = slice.join(' ');
          if (joined.startsWith('\\"') && joined.endsWith('\\"')) {
            joined = `"${joined.slice(2, -2)}"`;
          } else if (joined.startsWith('\\"') && joined.endsWith('"')) {
            joined = `"${joined.slice(2, -1)}"`;
          }
          currentArgs.splice(quoteIdx, matchingIdx - quoteIdx + 1, joined);
          quoteIdx++;
          continue;
        }
      }
    }
    quoteIdx++;
  }

  while (i < currentArgs.length) {
    const current = currentArgs[i];

    if (
      current !== undefined &&
      !current.startsWith('-') &&
      endsWithUnescapedBackslash(current) &&
      !isPathWithTrailingSlash(current)
    ) {
      // Look ahead for matching argument that completes the fragmented quoted expression
      let endIdx = -1;
      let matchedType: 'pure-slash' | 'multi-quote' | 'escaped-paren' | 'slash-paren' | 'leading-slash' | 'internal-slash' | 'generic' = 'generic';
      let internalWord = '';
      let internalRest = '';

      for (let j = i + 1; j < currentArgs.length; j++) {
        const next = currentArgs[j];
        if (next === undefined || next.startsWith('-')) break;

        if (isPureWordWithTrailingSlash(next)) {
          endIdx = j;
          matchedType = 'pure-slash';
          break;
        } else if (next.endsWith('\\)')) {
          endIdx = j;
          matchedType = 'escaped-paren';
          break;
        } else if (next.endsWith('/)')) {
          endIdx = j;
          matchedType = 'slash-paren';
          break;
        } else if (startsWithUnescapedBackslash(next)) {
          endIdx = j;
          matchedType = 'leading-slash';
          break;
        } else if (next.includes('\\ ')) {
          const slashSpaceIdx = next.indexOf('\\ ');
          internalWord = next.slice(0, slashSpaceIdx);
          internalRest = next.slice(slashSpaceIdx + 1);
          endIdx = j;
          matchedType = 'internal-slash';
          break;
        } else if (
          endsWithUnescapedBackslash(next) &&
          !isPathWithTrailingSlash(next) &&
          /^([^\\]+)\\(.*)$/.test(next)
        ) {
          const m = next.match(/^([^\\]+)\\(.*)$/);
          if (m) {
            internalWord = m[1];
            internalRest = m[2];
            endIdx = j;
            matchedType = 'multi-quote';
            break;
          }
        }
      }

      if (endIdx !== -1 && currentArgs[endIdx] !== undefined) {
        const first = current.slice(0, -1);
        const middle = currentArgs.slice(i + 1, endIdx);
        const joinedMiddle = middle.length > 0 ? `${middle.join(' ')} ` : '';
        const lastArg = currentArgs[endIdx]!;

        let reassembled: string;
        if (matchedType === 'pure-slash') {
          const last = lastArg.slice(0, -1);
          reassembled = `${first}"${joinedMiddle}${last}"`;
        } else if (matchedType === 'multi-quote') {
          const healedRest = internalRest.replace(/\\([a-zA-Z0-9_.-]+)\\/g, '"$1"');
          reassembled = `${first}"${joinedMiddle}${internalWord}"${healedRest}`;
        } else if (matchedType === 'escaped-paren') {
          const last = lastArg.slice(0, -2);
          reassembled = `${first}"${joinedMiddle}${last}")`;
        } else if (matchedType === 'slash-paren') {
          const last = lastArg.slice(0, -2);
          reassembled = `${first}"${joinedMiddle}${last}/)`;
        } else if (matchedType === 'leading-slash') {
          const last = lastArg.slice(1);
          reassembled = `${first}"${middle.join(' ')}"${last}`;
        } else if (matchedType === 'internal-slash') {
          const healedRest = internalRest.replace(/\\([a-zA-Z0-9_.-]+)\\/g, '"$1"');
          reassembled = `${first}"${joinedMiddle}${internalWord}"${healedRest}`;
        } else {
          reassembled = `${first}"${joinedMiddle}${lastArg}"`;
        }

        currentArgs.splice(i, endIdx - i + 1, reassembled);
        // If reassembled still ends with an unescaped backslash (e.g. chained quotes), do not advance i
        if (endsWithUnescapedBackslash(reassembled) && !isPathWithTrailingSlash(reassembled)) {
          continue;
        }
        i++;
        continue;
      }
    }

    i++;
  }
  return currentArgs;
}

export function tryHealJsonPayload(rawJson: string): unknown | null {
  let trimmed = rawJson.trim();

  // Candidate 0: Strip markdown code block fences if present (e.g. ```json ... ```)
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  // Candidate 1: Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Candidate 2: Strip outer matching quotes (single or double)
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    try {
      return JSON.parse(trimmed.slice(1, -1).trim());
    } catch {
      // continue
    }
  }

  // Candidate 3: Unescape double quotes if whole string was escaped
  if (trimmed.includes('\\"')) {
    try {
      return JSON.parse(trimmed.replace(/\\"/g, '"'));
    } catch {
      // continue
    }
  }

  // Candidate 4: Remove trailing commas before } or ]
  let candidate = trimmed.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  // Candidate 5: Quote unquoted object keys (e.g. {type: "command"} -> {"type": "command"})
  candidate = candidate.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(candidate);
  } catch {
    // continue
  }

  // Candidate 6: Replace single quotes with double quotes for keys and values, escaping inner double quotes
  const singleToDouble = candidate
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => {
      const escapedInner = inner.replace(/"/g, '\\"');
      return `"${escapedInner}"`;
    })
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(singleToDouble);
  } catch {
    // continue
  }

  // Candidate 7: Heal unescaped control characters, hex escapes (\xHH -> \u00HH), null escapes (\0 -> \u0000), and invalid backslashes inside JSON strings
  try {
    const healedStrings = trimmed.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner: string) => {
      const healedInner = inner
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
        .replace(/\\0(?![0-9])/g, '\\u0000')
        .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, () => '\\\\');
      return `"${healedInner}"`;
    });
    return JSON.parse(healedStrings);
  } catch {
    // continue
  }

  // Candidate 8: Candidate 7 with trailing commas removed
  try {
    const healedStrings = trimmed.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner: string) => {
      const healedInner = inner
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
        .replace(/\\0(?![0-9])/g, '\\u0000')
        .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, () => '\\\\');
      return `"${healedInner}"`;
    }).replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(healedStrings);
  } catch {
    // continue
  }

  // Candidate 9: Heal invalid backslash escapes across entire payload string (e.g. unescaped paths like \data, \xHH, \0)
  try {
    const healedEscapes = trimmed
      .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
      .replace(/\\0(?![0-9])/g, '\\u0000')
      .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, () => '\\\\')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(healedEscapes);
  } catch {
    // continue
  }

  // Candidate 9.5: Token-aware JSON string scanner and structural quote escaper
  try {
    let s = trimmed;
    if (s.startsWith('{\\"') || s.startsWith('{ \\"')) {
      s = s.replace(/\{\s*\\"/g, '{"')
           .replace(/\\"\s*:\s*\\"/g, '":"')
           .replace(/\\"\s*,\s*\\"/g, '","')
           .replace(/\\"\s*:\s*/g, '":')
           .replace(/,\s*\\"/g, ',"')
           .replace(/\\"\s*\}/g, '"}')
           .replace(/\\"\s*\]/g, '"]')
           .replace(/\[\s*\\"/g, '["');
    }

    let out = '';
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inString) {
        if (ch === '"') {
          inString = true;
        }
        out += ch;
      } else {
        if (isEscaped) {
          isEscaped = false;
          if (['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(ch)) {
            out += ch;
          } else if (ch === 'u' && /^[0-9a-fA-F]{4}/.test(s.slice(i + 1, i + 5))) {
            out += ch;
          } else if (ch === 'x' && /^[0-9a-fA-F]{2}/.test(s.slice(i + 1, i + 3))) {
            out = out.slice(0, -1) + '\\u00' + s.slice(i + 1, i + 3);
            i += 2;
          } else {
            out = out.slice(0, -1) + '\\\\' + ch;
          }
        } else {
          if (ch === '\\') {
            isEscaped = true;
            out += ch;
          } else if (ch === '"') {
            inString = false;
            out += ch;
          } else if (ch === '\n') {
            out += '\\n';
          } else if (ch === '\r') {
            out += '\\r';
          } else if (ch === '\t') {
            out += '\\t';
          } else {
            out += ch;
          }
        }
      }
    }

    if (isEscaped) {
      out = out.slice(0, -1) + '\\\\';
    }

    out = out.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(out);
  } catch {
    // continue
  }

  // Candidate 10: Heal PowerShell quote-stripped JSON (e.g. {\ type\:\eval\,\code\:\...)
  if (trimmed.startsWith('{') && (trimmed.includes('\\ ') || trimmed.includes('\\:') || trimmed.includes('\\,'))) {
    try {
      let psHealed = trimmed
        .replace(/^\{\s*\\?\s*/, '{"')
        .replace(/\\\s*:\s*\\/g, '":"')
        .replace(/\\\s*:\s*/g, '":"')
        .replace(/\\+\s*,\s*\\+/g, '","')
        .replace(/\\+\s*,\s*/g, '",')
        .replace(/,\s*\\+/g, ',"')
        .replace(/\\+\s*\}$/, '"}');
      if (!psHealed.endsWith('}')) {
        psHealed += psHealed.endsWith('"') ? '}' : '"}';
      }
      return JSON.parse(psHealed);
    } catch {
      // continue
    }
  }

  // Candidate 11: Auto-close unclosed trailing quotes and curly brace if trimmed starts with {
  if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed + '}');
    } catch {
      try {
        return JSON.parse(trimmed + '"}');
      } catch {
        // continue
      }
    }
  }

  // Candidate 11.5: Heal unclosed quotes after template literal backticks before known keys or closing brace
  if (trimmed.includes('`')) {
    try {
      const knownKeys = [
        'type', 'command', 'args', 'cwd', 'env', 'stdin', 'stdoutFile', 'stderrFile',
        'maxBuffer', 'truncateOutputLength', 'keepPayload', 'bypassInterceptors',
        'timeoutMs', 'stallTimeoutMs', 'expectJsonEnvelope', 'integrationContext',
        'templateOverride', 'onSuccess', 'onFailure', 'webhookMethod', 'webhookHeaders',
        'webhookPayloadTemplate', 'webhookTimeoutMs', 'target', 'scriptPath',
        'interpreter', 'code',
      ];
      const keysPattern = knownKeys.join('|');
      const candidate = trimmed
        .replace(new RegExp(`(\`)\\s*,\\s*(("?)(${keysPattern})("?)\\s*:)`, 'g'), '$1",$2')
        .replace(/(`)\s*\}/g, '$1"}');
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  // Candidate 12: Heal unquoted or partially quoted PowerShell quote-stripped JSON payloads
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const knownKeys = [
        'type', 'command', 'args', 'cwd', 'env', 'stdin', 'stdoutFile', 'stderrFile',
        'maxBuffer', 'truncateOutputLength', 'keepPayload', 'bypassInterceptors',
        'timeoutMs', 'stallTimeoutMs', 'expectJsonEnvelope', 'integrationContext',
        'templateOverride', 'onSuccess', 'onFailure', 'webhookMethod', 'webhookHeaders',
        'webhookPayloadTemplate', 'webhookTimeoutMs', 'target', 'scriptPath',
        'interpreter', 'code',
      ];
      const content = trimmed.slice(1, -1).trim();
      const pairs: Array<{ key: string; rawVal: string }> = [];
      let currentKey = '';
      let inKey = true;
      let valStart = -1;
      let depth = 0;
      let inString: false | '"' | "'" | '`' = false;
      let isEscaped = false;

      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (ch === '\\') {
          if (inKey) {
            continue;
          }
          // If followed by colon, comma, or closing delimiter, this backslash was a stripped quote, not an escape
          const nextChar = content[i + 1];
          if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']') {
            continue;
          }
          isEscaped = true;
          continue;
        }
        if (inString !== false) {
          if (ch === inString) {
            inString = false;
          }
          continue;
        } else if (ch === '"' || ch === "'" || ch === '`') {
          inString = ch;
          continue;
        }

        if (ch === '{' || ch === '[' || ch === '(') {
          depth++;
          continue;
        }
        if (ch === '}' || ch === ']' || ch === ')') {
          if (depth > 0) depth--;
          continue;
        }

        if (depth === 0) {
          if (inKey) {
            if (ch === ':') {
              inKey = false;
              valStart = i + 1;
            } else if (!/\s/.test(ch)) {
              currentKey += ch;
            }
          } else if (ch === ',') {
            const rest = content.slice(i + 1).trimStart();
            const matchKey = knownKeys.find(k =>
              rest.startsWith(k + ':') ||
              rest.startsWith(`"${k}":`) ||
              rest.startsWith(`'${k}':`) ||
              rest.startsWith(`\\${k}\\`) ||
              rest.startsWith(`\\ ${k}\\`) ||
              rest.startsWith(`\\${k}:`) ||
              rest.startsWith(`\\ ${k}:`) ||
              rest.startsWith(`\\${k}\\:`)
            );
            if (matchKey !== undefined) {
              const rawVal = content.slice(valStart, i).trim();
              pairs.push({ key: currentKey.replace(/['"\\\s]/g, ''), rawVal });
              currentKey = '';
              inKey = true;
            }
          }
        }
      }

      if (!inKey && valStart !== -1) {
        const rawVal = content.slice(valStart).trim();
        pairs.push({ key: currentKey.replace(/['"\\\s]/g, ''), rawVal });
      }

      if (pairs.length > 0 && pairs.some(p => p.key === 'type' || p.key === 'command' || p.key === 'code' || p.key === 'scriptPath')) {
        const result: Record<string, unknown> = {};
        for (const { key, rawVal } of pairs) {
          let cleanVal = rawVal;
          if (cleanVal.startsWith('\\') && cleanVal.endsWith('\\') && cleanVal.length >= 2) {
            cleanVal = cleanVal.slice(1, -1).trim();
          }
          if (
            (cleanVal.startsWith('"') && cleanVal.endsWith('"') && cleanVal.length >= 2) ||
            (cleanVal.startsWith("'") && cleanVal.endsWith("'") && cleanVal.length >= 2)
          ) {
            cleanVal = cleanVal.slice(1, -1);
            result[key] = cleanVal;
            continue;
          }
          try {
            result[key] = JSON.parse(cleanVal);
            continue;
          } catch {
            // Not JSON primitive
          }
          if (cleanVal.startsWith('[') && cleanVal.endsWith(']')) {
            const inner = cleanVal.slice(1, -1).trim();
            if (inner.length === 0) {
              result[key] = [];
              continue;
            }
            const items = inner.split(',').map(item => {
              let cleaned = item.trim();
              if (cleaned.startsWith('\\') && cleaned.endsWith('\\') && cleaned.length >= 2) {
                cleaned = cleaned.slice(1, -1).trim();
              }
              if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                cleaned = cleaned.slice(1, -1);
              }
              return cleaned.replace(/\\/g, '');
            });
            result[key] = items;
            continue;
          }
          if (cleanVal === 'true') { result[key] = true; continue; }
          if (cleanVal === 'false') { result[key] = false; continue; }
          if (!isNaN(Number(cleanVal)) && cleanVal.trim() !== '') { result[key] = Number(cleanVal); continue; }
          result[key] = cleanVal;
        }
        return result;
      }
    } catch {
      // continue
    }
  }

  return null;
}

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
