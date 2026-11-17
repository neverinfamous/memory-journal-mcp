// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import { ExecutionContext } from './types.js';
import { convertToWslPath, getPositionalArgs, findPatternExprIndex, tokenizeArgs, healFragmentedQuotes } from '../command-utils.js';

export const GREP_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'dist-node',
  'coverage',
  'build',
  '.test-output',
  'test-results',
  'tmp',
  'logs',
  '.cache',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.gemini',
  '.vscode',
  '.agents',
  '.wrangler',
  '.venv',
  'venv',
  'vendor',
  '.pnpm-store',
  '.parcel-cache',
  'bak',
  'data',
  'releases',
];

export interface ParsedGrepSearchArgs {
  pattern: string;
  searchPath: string;
  isCaseInsensitive: boolean;
  isWord: boolean;
  isRegex: boolean;
}

const EXTENSIONLESS_FILENAMES_REGEX = /^(?:Makefile|Dockerfile|Containerfile|Procfile|Gemfile|Rakefile|Brewfile|Vagrantfile|Jenkinsfile|Justfile|LICENSE|README|CHANGELOG|AUTHORS|CODEOWNERS|OWNERS)$/i;
const KNOWN_POSIX_ROOT_DIRS_REGEX = /^\/(?:etc|var|var\/log|tmp|usr|usr\/local|opt|home|root|srv|bin|sbin|lib|lib64|dev|proc|sys|run)$/;

function hasUnambiguousRegexMeta(arg: string): boolean {
  return /[()*+?[\]^$|{}]/.test(arg) || arg.includes('|');
}

function hasBackslashRegexEscape(arg: string): boolean {
  return /\\[bBwWdDsSnrtv0()[\]{}.*+?^$|\-.]/.test(arg);
}

// [INTENT]: Distinguishes directory targets from patterns and single-file paths in rg/grep interceptors.
// [INVARIANT]: Must NOT assume arbitrary POSIX paths without trailing '/' (e.g., '/var/log/syslog', '/etc/os-release', '/proc/cpuinfo') are directories on Windows hosts, and must NOT misclassify Windows backslash paths (e.g., 'C:\Users\...\Desktop\...\src' containing '\D' and '\s') as regex escapes.
function hasUriOrNonDriveColon(value: string): boolean {
  return value.includes('://') || (value.includes(':') && !/^[a-zA-Z]:(?:[/\\]|$)/.test(value));
}

function isSecondExistingTargetOnly(first: string, second: string, cwd?: string): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolvedFirst = path.resolve(baseDir, first);
    const resolvedSecond = path.resolve(baseDir, second);
    return !fs.existsSync(resolvedFirst) && fs.existsSync(resolvedSecond);
  } catch {
    return false;
  }
}

export function isLikelyDirectoryArg(arg: string, cwd?: string): boolean {
  if (arg.length === 0 || arg.startsWith('-') || arg.startsWith('\\-')) return false;
  if (hasUnambiguousRegexMeta(arg)) {
    return false;
  }
  if (hasUriOrNonDriveColon(arg)) {
    return false;
  }

  if (arg === '.' || arg === '..' || arg.endsWith('/') || arg.endsWith('\\') || /^[a-zA-Z]:[/\\]?$/.test(arg)) {
    return true;
  }

  if (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)) {
    const winMapped = arg.replace(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/, (_, drive: string, rest?: string) =>
      `${drive.toUpperCase()}:\\${(rest ?? '').replace(/\//g, '\\')}`
    );
    try {
      if (fs.existsSync(winMapped)) {
        return fs.statSync(winMapped).isDirectory();
      }
    } catch {
      // ignore stat errors
    }
    return !/\.[a-zA-Z0-9]{1,6}$/.test(arg) && path.extname(arg).length === 0;
  }

  if (arg.startsWith('/')) {
    if (process.platform !== 'win32') {
      try {
        if (fs.existsSync(arg)) {
          return fs.statSync(arg).isDirectory();
        }
      } catch {
        // ignore stat errors
      }
    }
    return KNOWN_POSIX_ROOT_DIRS_REGEX.test(arg);
  }

  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolved = path.resolve(baseDir, arg);
    if (fs.existsSync(resolved)) {
      return fs.statSync(resolved).isDirectory();
    }
  } catch {
    // ignore stat errors
  }

  if (/^[a-zA-Z]:[/\\]/.test(arg)) {
    return !/\.[a-zA-Z0-9]{1,6}$/.test(arg) && path.extname(arg).length === 0;
  }

  if (!/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) {
    return false;
  }

  if (/\.[a-zA-Z0-9]{1,6}$/.test(arg)) {
    return false;
  }

  const baseName = path.posix.basename(arg.replace(/\\/g, '/'));
  if (EXTENSIONLESS_FILENAMES_REGEX.test(baseName)) {
    return false;
  }

  return arg.includes('/') || arg.includes('\\');
}

export function parseGrepSearchArgs(args: string[]): ParsedGrepSearchArgs {
  let isCaseInsensitive = false;
  let isWord = false;
  let isRegex = false;

  let pattern = '';
  let searchPath = '';

  const nonFlagArgs: string[] = [];

  const normalizedArgs: string[] = [];
  for (const a of args) {
    if (a.startsWith('-') && a.includes(' ')) {
      const tokens = tokenizeArgs(a);
      if (tokens.length > 1 && tokens[0] !== undefined && tokens[0].startsWith('-')) {
        normalizedArgs.push(...tokens);
        continue;
      }
    }
    normalizedArgs.push(a);
  }

  for (let i = 0; i < normalizedArgs.length; i++) {
    const a = normalizedArgs[i];
    const lower = a.toLowerCase();

    if (lower === '-i' || lower === '-ri' || lower === '-ir' || lower === '--case-insensitive' || (a.startsWith('-') && !a.startsWith('--') && a.includes('i'))) {
      isCaseInsensitive = true;
      continue;
    }
    if (lower === '-w' || lower === '--word-regexp') {
      isWord = true;
      continue;
    }
    if (lower === '-e' || lower === '--regexp' || lower === '--is-regex') {
      isRegex = true;
      if (lower !== '--is-regex' && i + 1 < args.length && !args[i + 1].startsWith('-')) {
        pattern = args[++i];
      }
      continue;
    }

    if (['-s', '--symbol', '--pattern', '-q', '--query', '--searchpattern', '--search-pattern', '--targetcontent', '--target-content', '--content'].includes(lower)) {
      if (i + 1 < args.length) {
        pattern = args[++i];
      }
      continue;
    }

    if (['-d', '--dir', '--directory', '--path', '--searchpath', '--search-path'].includes(lower)) {
      if (i + 1 < args.length) {
        searchPath = args[++i];
      }
      continue;
    }

    if (lower === '-p') {
      if (i + 1 < args.length) {
        const val = args[++i];
        const hasDirFlag = args.some(arg => ['-d', '--dir', '--directory', '--searchpath', '--search-path'].includes(arg.toLowerCase()));
        if (hasDirFlag || searchPath.length > 0) {
          pattern = val;
        } else {
          const hasPatternFlag = args.some(arg => ['-s', '--symbol', '--pattern', '-q', '--query', '--targetcontent', '--target-content'].includes(arg.toLowerCase()));
          if (hasPatternFlag || pattern.length > 0) {
            searchPath = val;
          } else {
            pattern = val;
          }
        }
      }
      continue;
    }

    if (!a.startsWith('-')) {
      nonFlagArgs.push(a);
    }
  }

  if (pattern.length === 0 && nonFlagArgs.length > 0) {
    pattern = nonFlagArgs[0];
    if (searchPath.length === 0 && nonFlagArgs.length > 1) {
      searchPath = nonFlagArgs[1];
    }
  } else if (searchPath.length === 0 && nonFlagArgs.length > 0) {
    searchPath = nonFlagArgs[0];
  }

  const isPathLike = (s: string): boolean => {
    if (!s || s.length === 0) return false;
    const clean = s.trim();
    if (hasUriOrNonDriveColon(clean)) return false;
    if (/[()*+?[\]^$|{}]/.test(clean) || /\\[bBwWdDsSnrtv0()[\]{}.*+?^$|\-.]/.test(clean) || clean.includes('|')) return false;
    if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../') || clean.endsWith('/') || clean.endsWith('\\')) return true;
    if (clean.includes('/') || clean.includes('\\') || /^[a-zA-Z]:/.test(clean)) return true;
    try {
      return fs.existsSync(clean) && fs.statSync(clean).isDirectory();
    } catch {
      return false;
    }
  };

  if (isPathLike(pattern) && !isSecondExistingTargetOnly(pattern, searchPath)) {
    if (!isPathLike(searchPath) && searchPath.length > 0) {
      const tmp = pattern;
      pattern = searchPath;
      searchPath = tmp;
    } else if (searchPath.length === 0) {
      searchPath = pattern;
      pattern = '';
    }
  }

  if (searchPath.length === 0) {
    searchPath = '.';
  }

  return { pattern, searchPath, isCaseInsensitive, isWord, isRegex };
}

export function injectRecursiveGrepExclusions(args: string[]): void {
  const missingExcludes = GREP_EXCLUDE_DIRS.filter(
    d => !args.some(a => a === `--exclude-dir=${d}` || a === `'--exclude-dir=${d}'` || a === `"--exclude-dir=${d}"`)
  );
  if (missingExcludes.length > 0) {
    console.error(
      `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)`
    );
    args.unshift(...missingExcludes.map(d => `--exclude-dir=${d}`));
  }
  if (!args.some(a => a.startsWith('--binary-files='))) {
    args.unshift('--binary-files=without-match');
  }
  const binaryPatterns = ['*.db', '*.sqlite', '*.sqlite3', '*.lock'];
  for (const pat of binaryPatterns) {
    if (!args.some(a => a === `--exclude=${pat}` || a === `'--exclude=${pat}'` || a === `"--exclude=${pat}"`)) {
      args.unshift(`--exclude=${pat}`);
    }
  }
}

export function handleFindInterception(ctx: ExecutionContext): void {
  const filterIdx = ctx.args.findIndex(a => ['-filter', '-include'].includes(a.toLowerCase()));
  if (filterIdx !== -1 && filterIdx + 1 < ctx.args.length) {
    const pattern = ctx.args[filterIdx + 1];
    const hasRecurse = ctx.args.some(a => ['-recurse', '-r', '-R', '/s'].includes(a.toLowerCase()));
    let targetPath = '.';
    for (let i = 0; i < ctx.args.length; i++) {
      if (i === filterIdx || i === filterIdx + 1) continue;
      const a = ctx.args[i];
      if (!a.startsWith('-') && !a.startsWith('/')) {
        targetPath = convertToWslPath(a);
        break;
      }
    }
    const newArgs = [targetPath];
    if (!hasRecurse) {
      newArgs.push('-maxdepth', '1');
    }
    newArgs.push('-name', pattern);
    ctx.args = newArgs;
    if (!hasRecurse) {
      return;
    }
  }

  // Auto-heal common find -type hallucinations (e.g. -type file -> -type f, -type fts* -> -name fts*)
  for (let i = 0; i < ctx.args.length; i++) {
    if (ctx.args[i] === '-type' && i + 1 < ctx.args.length) {
      const typeVal = ctx.args[i + 1];
      if (typeVal === 'file') {
        ctx.args[i + 1] = 'f';
      } else if (typeVal === 'dir' || typeVal === 'directory') {
        ctx.args[i + 1] = 'd';
      } else if (!/^[bcdpflsD]$/.test(typeVal)) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'find -type ${typeVal}' is invalid. Rewriting to '-name ${typeVal}'... (Frictionless Recovery)\x1b[0m`);
        ctx.args[i] = '-name';
      }
    }
  }

  // Auto-heal PowerShell {} eaten into empty string in find -exec / -execdir
  const execIdx = ctx.args.findIndex(a => a === '-exec' || a === '-execdir');
  if (execIdx !== -1) {
    for (let i = execIdx + 1; i < ctx.args.length; i++) {
      if (ctx.args[i] === '' || ctx.args[i] === '""' || ctx.args[i] === "''") {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected empty argument in 'find -exec' (PowerShell {} scriptblock conversion). Rewriting to '{}'... (Frictionless Recovery)\x1b[0m`);
        ctx.args[i] = '{}';
      }
    }
  }

  // Auto-heal missing -name flag when pattern with wildcards is passed as positional argument (e.g. find src *pattern.ts)
  const patternIndex = ctx.args.findIndex((a, idx) => {
    if (idx === 0 || a.startsWith('-') || a === '(' || a === '!' || a === '\\(') return false;
    return a.includes('*') || a.includes('?');
  });
  if (patternIndex !== -1) {
    const prev = ctx.args[patternIndex - 1];
    if (!['-name', '-iname', '-path', '-ipath', '-wholename'].includes(prev)) {
      const pattern = ctx.args[patternIndex];
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected wildcard pattern '${pattern}' without -name flag. Auto-injecting '-name' flag... (Frictionless Recovery)\x1b[0m`);
      ctx.args.splice(patternIndex, 1, '-name', pattern);
    }
  }

  // Auto-inject directory pruning on recursive find on mounted filesystems to prevent 30s timeouts
  const hasPrune = ctx.args.includes('-prune');
  const hasMaxDepth = ctx.args.includes('-maxdepth');
  if (!hasPrune && !hasMaxDepth) {
    // Collect leading positional target paths (before any flag starting with '-', '(', or '!')
    const targetPaths: string[] = [];
    let firstFlagIdx = -1;
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i];
      if (a.startsWith('-') || a === '(' || a === '!' || a === '\\(') {
        firstFlagIdx = i;
        break;
      }
      targetPaths.push(a);
    }

    const restOfArgs = firstFlagIdx === -1 ? [] : ctx.args.slice(firstFlagIdx);
    const effectivePaths = (targetPaths.length > 0 ? targetPaths : ['.']).map(p => {
      if (p.endsWith('/*') || p.endsWith('\\*')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping trailing wildcard from find root path '${p}' to prevent literal glob failure... (Frictionless Recovery)\x1b[0m`);
        return p.slice(0, -2) || '.';
      }
      return p;
    });

    if (targetPaths.length > 0) {
      ctx.args = [...effectivePaths, ...restOfArgs];
    }

    const dirsToPrune = GREP_EXCLUDE_DIRS.filter(dir => {
      // Don't prune if user explicitly passed this directory in arguments
      if (ctx.args.some(arg => arg.toLowerCase().includes(dir.toLowerCase()))) {
        return false;
      }
      // Don't prune if any target path is targeting or inside this directory
      for (const tp of effectivePaths) {
        const normalized = tp.replace(/\\/g, '/').toLowerCase();
        const segments = normalized.split('/').filter(Boolean);
        if (segments.includes(dir.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    const isBroadSearch = effectivePaths.some(p => {
      const norm = p.replace(/\\/g, '/').trim();
      if (norm === '.' || norm === '..' || norm === '' || norm === './' || norm === '../') return true;
      if (/^[a-zA-Z]:[\\/]/.test(p) || norm.startsWith('/mnt/') || norm.startsWith('/') || norm.startsWith('~')) {
        return true;
      }
      return false;
    });

    if (isBroadSearch && dirsToPrune.length > 0) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive find on mounted filesystem detected. Auto-injecting directory pruning for node_modules, .git, and cache dirs to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
      const pruneConditions: string[] = [];
      for (let i = 0; i < dirsToPrune.length; i++) {
        if (i > 0) pruneConditions.push('-o');
        pruneConditions.push('-name', dirsToPrune[i]);
      }
      const pruneClause = ['(', ...pruneConditions, ')', '-prune', '-o'];
      
      const hasAction = restOfArgs.some(a => [
        '-print', '-print0', '-exec', '-execdir', '-ok', '-okdir',
        '-delete', '-ls', '-fls', '-fprint', '-fprint0', '-fprintf'
      ].includes(a));

      const finalRest = hasAction
        ? restOfArgs
        : (restOfArgs.length === 0 ? ['-print'] : [...restOfArgs, '-print']);

      ctx.args = [...effectivePaths, ...pruneClause, ...finalRest];

      // Broad find on mounted Windows filesystems has significant 9P metadata overhead. Auto-extend timeout if at default or tight 30s limit to prevent premature aborts.
      if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs <= 30000) {
        ctx.payload.timeoutMs = 60000;
      }
    }
  }
}

export function handleRipgrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  const unpackedArgs: string[] = [];
  let unbundledFlags = false;
  for (const a of ctx.args) {
    if (a.startsWith('-') && a.includes(' ')) {
      const tokens = tokenizeArgs(a);
      if (tokens.length > 1 && tokens[0] !== undefined && (/^-[a-zA-Z0-9]+$/.test(tokens[0]) || /^--[a-zA-Z0-9-]+(?:=.*)?$/.test(tokens[0]))) {
        unpackedArgs.push(...tokens);
        unbundledFlags = true;
        continue;
      }
    }
    unpackedArgs.push(a);
  }
  if (unbundledFlags) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern in a single argument. Unpacking arguments... (Frictionless Recovery)\x1b[0m`);
    ctx.args = unpackedArgs;
    if (ctx.payload.type === 'command') {
      ctx.payload.args = ctx.args;
    }
  }

  // Re-run quote fragmentation healing if unbundling exposed split backslash-escaped quotes
  const reassembledArgs = healFragmentedQuotes(ctx.args);
  if (reassembledArgs.length !== ctx.args.length || reassembledArgs.some((a, idx) => a !== ctx.args[idx])) {
    ctx.args = reassembledArgs;
    if (ctx.payload.type === 'command') {
      ctx.payload.args = ctx.args;
    }
  }

  const { cmdBasename } = ctx;
  let strippedRecursive = false;
  const cleanedArgs = ctx.args.map((a, idx) => {
    if (a === '-R' || a === '--recursive') {
      strippedRecursive = true;
      return '';
    }
    if (a.startsWith('-') && !a.startsWith('--')) {
      if (a === '-r') {
        const nextArg = ctx.args[idx + 1];
        const nonFlagCount = ctx.args.filter(x => !x.startsWith('-')).length;
        if (!nextArg || nextArg.startsWith('-') || idx > 0 || nonFlagCount <= 2) {
          strippedRecursive = true;
          return '';
        }
      } else if (/^-[a-zA-Z0-9]+$/.test(a) && (a.includes('R') || a.includes('r'))) {
        const cleaned = a.replace(/[Rr]/g, '');
        strippedRecursive = true;
        return cleaned === '-' ? '' : cleaned;
      }
    }
    return a;
  }).filter(Boolean);

  if (strippedRecursive) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' searches recursively by default. Stripping redundant recursive flag (-r/-R) to prevent argument parsing errors... (Frictionless Recovery)`);
  }

  // Auto-heal grep-style flags (--include, --exclude, --exclude-dir) into ripgrep '-g' (glob) flags
  const healedArgs: string[] = [];
  let convertedGrepFlags = false;
  for (let i = 0; i < cleanedArgs.length; i++) {
    const a = cleanedArgs[i];
    if (a === '-E' && i + 1 < cleanedArgs.length) {
      const nextArg = cleanedArgs[i + 1];
      const knownEncodings = ['utf-8', 'utf-16', 'utf-16le', 'utf-16be', 'ascii', 'latin1', 'windows-1252', 'iso-8859-1', 'gbk', 'euc-jp', 'shift-jis'];
      if (!knownEncodings.includes(nextArg.toLowerCase())) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Rewriting to '-e' to treat as regex pattern instead of encoding... (Frictionless Recovery)\x1b[0m`);
        healedArgs.push('-e', nextArg);
        i++;
        convertedGrepFlags = true;
        continue;
      }
    } else if (a === '-E') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Stripping '-E' as ripgrep uses extended regex by default... (Frictionless Recovery)\x1b[0m`);
      convertedGrepFlags = true;
      continue;
    } else if (a === '--include' && i + 1 < cleanedArgs.length) {
      healedArgs.push('-g', cleanedArgs[++i]);
      convertedGrepFlags = true;
    } else if (a.startsWith('--include=')) {
      healedArgs.push(`-g=${a.slice('--include='.length)}`);
      convertedGrepFlags = true;
    } else if (a === '--exclude' && i + 1 < cleanedArgs.length) {
      const pattern = cleanedArgs[++i];
      healedArgs.push('-g', pattern.startsWith('!') ? pattern : `!${pattern}`);
      convertedGrepFlags = true;
    } else if (a.startsWith('--exclude=')) {
      const pattern = a.slice('--exclude='.length);
      healedArgs.push(`-g=${pattern.startsWith('!') ? pattern : `!${pattern}`}`);
      convertedGrepFlags = true;
    } else if (a === '--exclude-dir' && i + 1 < cleanedArgs.length) {
      const dir = cleanedArgs[++i];
      healedArgs.push('-g', `!${dir}/**`);
      convertedGrepFlags = true;
    } else if (a.startsWith('--exclude-dir=')) {
      const dir = a.slice('--exclude-dir='.length);
      healedArgs.push(`-g=!${dir}/**`);
      convertedGrepFlags = true;
    } else {
      healedArgs.push(a);
    }
  }
  if (convertedGrepFlags) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' does not accept grep-style '--include/--exclude'. Normalizing to ripgrep '-g' (glob) flags... (Frictionless Recovery)`);
  }
  ctx.args = healedArgs;

  if (hasStdin) {
    console.error(`\n   💡 AGENT INTERCEPT: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  } else if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    console.error(`\n   💡 AGENT INTERCEPT: 'rg' natively fails or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }

  let positionalArgs = getPositionalArgs(cmdBasename, ctx.args);
  const hasPatternFlag = ctx.args.some(a => a === '-e' || a.startsWith('-e') || a === '--regexp' || a.startsWith('--regexp=') || a === '-f' || a.startsWith('--file'));
  const hasFiles = ctx.args.includes('--files');
  const hasGlob = ctx.args.some(a => a === '-g' || a === '--glob' || a.startsWith('-g=') || a.startsWith('--glob='));

  const isDir = (arg: string): boolean => isLikelyDirectoryArg(arg, ctx.payload.cwd);

  const isPathLike = (arg: string): boolean => {
    if (hasUnambiguousRegexMeta(arg)) return false;
    if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) return false;
    return (
      arg === '.' ||
      arg === '..' ||
      arg.startsWith('./') ||
      arg.startsWith('../') ||
      arg.endsWith('/') ||
      arg.endsWith('\\') ||
      /^[a-zA-Z]:/.test(arg) ||
      arg.startsWith('/mnt/') ||
      (arg.startsWith('/') && arg.slice(1).includes('/')) ||
      /\.[a-zA-Z0-9_-]+$/.test(arg) ||
      isDir(arg)
    );
  };

  // Auto-heal reversed arguments (e.g. rg src/adapters/sqlite pattern)
  if (!hasStdin && !hasPatternFlag && !hasFiles && positionalArgs.length === 2) {
    if (isDir(positionalArgs[0]) && !isDir(positionalArgs[1]) && !isSecondExistingTargetOnly(positionalArgs[0], positionalArgs[1], ctx.payload.cwd)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
      const idx0 = ctx.args.indexOf(positionalArgs[0]);
      const idx1 = ctx.args.indexOf(positionalArgs[1]);
      if (idx0 !== -1 && idx1 !== -1) {
        const tmp = ctx.args[idx0];
        ctx.args[idx0] = ctx.args[idx1];
        ctx.args[idx1] = tmp;
        positionalArgs = [positionalArgs[1], positionalArgs[0]];
      }
    }
  }

  // Auto-heal glob searches without pattern into --files searches
  if (!hasStdin && !hasPatternFlag && !hasFiles && hasGlob) {
    if (positionalArgs.length === 0) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag but no search pattern. Auto-injecting '--files' and '.' to search filenames... (Frictionless Recovery)\x1b[0m`);
      ctx.args.unshift('--files');
      ctx.args.push('.');
      positionalArgs = ['.'];
    } else if (positionalArgs.length === 1 && isDir(positionalArgs[0])) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and target path but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
      ctx.args.unshift('--files');
    } else if (positionalArgs.length >= 2 && positionalArgs.every(a => isDir(a))) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and directory targets but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
      ctx.args.unshift('--files');
    }
  }

  const updatedHasFiles = ctx.args.includes('--files');

  if (!hasPatternFlag && !updatedHasFiles && positionalArgs.length > 2) {
    const lastArg = positionalArgs[positionalArgs.length - 1];
    const intermediateArgs = positionalArgs.slice(1, -1);
    const hasPathInIntermediate = intermediateArgs.some(a => isPathLike(a));

    if (isPathLike(lastArg) && !hasPathInIntermediate) {
      const patternParts = positionalArgs.slice(0, -1);
      const combinedPattern = patternParts.join(' ');
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in 'rg'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
      let replaced = false;
      ctx.args = ctx.args.filter(a => {
        if (patternParts.includes(a)) {
          if (!replaced && a === patternParts[0]) {
            replaced = true;
            return true;
          }
          return false;
        }
        return true;
      }).map(a => a === patternParts[0] ? combinedPattern : a);
    }
  }
  if (!hasPatternFlag && !updatedHasFiles) {
    // Also check if a leading or middle token of an unquoted multi-word pattern started with '-' (e.g. "-write\\|target", "===", "'write'|isReadonlyMetaActive", "src")
    // and was excluded from positionalArgs by getPositionalArgs
    const lastArg = ctx.args[ctx.args.length - 1];
    if (lastArg !== undefined && !lastArg.startsWith('-') && isPathLike(lastArg)) {
      const toolFlagsWithVal = new Set(['-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E', '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth', '--regexp', '--file', '--glob', '--type', '--type-not', '--replace', '--threads', '--encoding', '--ignore-file', '--max-filesize']);
      const candidateIdxs: number[] = [];
      for (let i = 0; i < ctx.args.length - 1; i++) {
        const a = ctx.args[i];
        if (a === undefined) continue;
        if (toolFlagsWithVal.has(a)) {
          i++;
          continue;
        }
        if (/^-[a-zA-Z0-9]+$/.test(a) || (a.startsWith('--') && /^--[a-zA-Z0-9-]+(?:=|$)/.test(a))) {
          continue;
        }
        candidateIdxs.push(i);
      }
      if (candidateIdxs.length >= 2) {
        const patternParts = candidateIdxs.map(idx => ctx.args[idx]);
        const intermediateParts = patternParts.slice(1);
        const hasPathInIntermediate = intermediateParts.some(a => a !== undefined && isPathLike(a));
        if (!hasPathInIntermediate) {
          const combinedPattern = patternParts.join(' ');
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in 'rg'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
          const firstIdx = candidateIdxs[0];
          const removeSet = new Set(candidateIdxs.slice(1));
          ctx.args = ctx.args
            .map((a, idx) => (idx === firstIdx ? combinedPattern : a))
            .filter((_, idx) => !removeSet.has(idx));
        }
      }
    }
  }

  const hasHelpOrVersion = ctx.args.some(a =>
    ['-h', '--help', '-V', '--version', '-v', '--type-list', '--pcre2-version', '--files'].includes(a)
  );

  // Auto-inject '--' before patterns that begin with '-' (or strip leading '\-' escape) so ripgrep does not reject them as unknown flags (exit code 2)
  if (!hasHelpOrVersion && !hasPatternFlag && !ctx.args.includes('--')) {
    const patternIdxForDash = findPatternExprIndex(cmdBasename, ctx.args);
    let candidateIdx = patternIdxForDash;
    const toolFlagsWithVal = new Set(['-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E', '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth', '--regexp', '--file', '--glob', '--type', '--type-not', '--replace', '--threads', '--encoding', '--ignore-file', '--max-filesize']);
    const knownRgLongFlags = new Set([
      '--auto-hybrid-regex', '--binary', '--block-buffered', '--byte-offset', '--case-sensitive',
      '--color', '--colors', '--column', '--context-separator', '--count', '--count-matches',
      '--crlf', '--debug', '--dfa-size-limit', '--engine', '--field-context-separator',
      '--field-match-separator', '--files', '--files-with-matches', '--files-without-match',
      '--fixed-strings', '--follow', '--generate', '--heading', '--hidden', '--hostname-bin',
      '--hyperlink-format', '--iglob', '--ignore-case', '--ignore-file-case-insensitive',
      '--include-zero', '--invert-match', '--json', '--line-buffered', '--line-number',
      '--line-regexp', '--max-columns-preview', '--mmap', '--multiline', '--multiline-dotall',
      '--no-auto-hybrid-regex', '--no-binary', '--no-block-buffered', '--no-byte-offset',
      '--no-column', '--no-config', '--no-context-separator', '--no-crlf',
      '--no-encoding', '--no-filename', '--no-fixed-strings', '--no-follow', '--no-heading',
      '--no-hidden', '--no-ignore', '--no-ignore-dot', '--no-ignore-exclude',
      '--no-ignore-files', '--no-ignore-global', '--no-ignore-messages', '--no-ignore-parent',
      '--no-ignore-vcs', '--no-line-buffered', '--no-line-number', '--no-max-columns-preview',
      '--no-messages', '--no-mmap', '--no-multiline', '--no-multiline-dotall', '--no-pcre2',
      '--no-pcre2-unicode', '--no-pre', '--no-require-git', '--no-search-zip', '--no-smart-case',
      '--no-sort-files', '--no-stats', '--no-text', '--no-trim', '--no-unicode', '--null',
      '--null-data', '--one-file-system', '--only-matching', '--passthru', '--path-separator',
      '--pcre2', '--pcre2-unicode', '--pcre2-version', '--pre', '--pre-glob', '--pretty',
      '--quiet', '--regex-size-limit', '--require-git', '--search-zip', '--smart-case',
      '--sort', '--sort-files', '--sortr', '--stats', '--stop-on-nonmatch', '--text',
      '--trace', '--trim', '--type-add', '--type-clear', '--type-list', '--unrestricted',
      '--vimgrep', '--with-filename', '--word-regexp',
    ]);
    const nonFlagArgs = ctx.args.filter((x, idx) => {
      if (x === undefined || x.startsWith('-')) return false;
      const prev = idx > 0 ? ctx.args[idx - 1] : undefined;
      return prev === undefined || !toolFlagsWithVal.has(prev);
    });
    const allNonFlagArePaths = nonFlagArgs.length > 0 && nonFlagArgs.every(x => isPathLike(x));
    const currentCandidate = candidateIdx !== -1 ? ctx.args[candidateIdx] : undefined;
    const currentUnquoted = currentCandidate !== undefined ? currentCandidate.replace(/^(['"])(.*)\1$/, '$2') : '';
    if (candidateIdx === -1 || !currentUnquoted.startsWith('-')) {
      // Check if an argument starting with '-' was skipped by getPositionalArgs/findPatternExprIndex because it looked like a flag, e.g. rg -n "\"--add\"" file.ts, rg -n "--add" file.ts, or rg -n --workspace tests/
      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === undefined) continue;
        if (toolFlagsWithVal.has(arg)) {
          i++;
          continue;
        }
        const unquoted = arg.replace(/^(['"])(.*)\1$/, '$2');
        const wasQuoted = unquoted !== arg;
        if (wasQuoted && unquoted.startsWith('-')) {
          candidateIdx = i;
          break;
        }
        const baseFlag = unquoted.split('=')[0]?.toLowerCase() ?? '';
        const isUnknownLongFlag = unquoted.startsWith('--') && unquoted.length > 2 && !toolFlagsWithVal.has(baseFlag) && !knownRgLongFlags.has(baseFlag);
        const isEscapedHyphen = unquoted.startsWith('\\-');
        if (isEscapedHyphen || (isUnknownLongFlag && (allNonFlagArePaths || nonFlagArgs.length === 0))) {
          candidateIdx = i;
          break;
        }
      }
    }
    if (candidateIdx !== -1 && ctx.args[candidateIdx] !== undefined) {
      const rawPat = ctx.args[candidateIdx];
      const unquotedPat = rawPat.replace(/^(['"])(.*)\1$/, '$2');
      if (unquotedPat.startsWith('\\-')) {
        ctx.args[candidateIdx] = unquotedPat.slice(1);
        ctx.args.splice(candidateIdx, 0, '--');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected hyphen-prefixed search pattern in 'rg'. Injecting '--' separator to prevent flag parsing errors... (Frictionless Recovery)\x1b[0m`);
      } else if (unquotedPat.startsWith('-')) {
        ctx.args[candidateIdx] = unquotedPat;
        ctx.args.splice(candidateIdx, 0, '--');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected hyphen-prefixed search pattern in 'rg'. Injecting '--' separator to prevent flag parsing errors... (Frictionless Recovery)\x1b[0m`);
      }
    }
  }

  if (!hasStdin && !hasHelpOrVersion && !ctx.args.includes('.')) {
    const updatedPositional = getPositionalArgs(cmdBasename, ctx.args);
    if ((hasPatternFlag && updatedPositional.length === 0) || (!hasPatternFlag && updatedPositional.length === 1)) {
      console.error(`\n   💡 AGENT INTERCEPT: 'rg' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
      ctx.args.push('.');
    }
  }

  if (ctx.payload.target === 'wsl2') {
    const patternIdx = findPatternExprIndex(cmdBasename, ctx.args);
    ctx.args = ctx.args.map((a, idx) => idx === patternIdx ? a : convertToWslPath(a));
  }

  if (unbundledFlags && !hasHelpOrVersion && !ctx.args.includes('--no-messages')) {
    ctx.args.unshift('--no-messages');
  }

  if (ctx.payload.type === 'command') {
    ctx.payload.args = ctx.args;
  }
}

export function handleGrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  const { cmdBasename } = ctx;
  if (!ctx.args) ctx.args = [];

  const unpackedArgs: string[] = [];
  let unbundledFlags = false;
  for (const a of ctx.args) {
    if (a.startsWith('-') && a.includes(' ')) {
      const tokens = tokenizeArgs(a);
      if (tokens.length > 1 && tokens[0] !== undefined && (/^-[a-zA-Z0-9]+$/.test(tokens[0]) || /^--[a-zA-Z0-9-]+(?:=.*)?$/.test(tokens[0]))) {
        unpackedArgs.push(...tokens);
        unbundledFlags = true;
        continue;
      }
    }
    unpackedArgs.push(a);
  }
  if (unbundledFlags) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern in a single argument. Unpacking arguments... (Frictionless Recovery)\x1b[0m`);
    ctx.args = unpackedArgs;
    if (ctx.payload.type === 'command') {
      ctx.payload.args = ctx.args;
    }
  }

  if (hasStdin) {
    console.error(`\n   💡 AGENT INTERCEPT: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  } else if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' search command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }

  const hasHelpOrVersion = ctx.args.some(a =>
    ['-h', '--help', '-V', '--version'].includes(a)
  );
  if (hasHelpOrVersion) {
    return;
  }

  const hasPatternFlag = ctx.args.some(a =>
    a === '-e' || a.startsWith('-e') || a === '--regexp' || a.startsWith('--regexp=') || a === '-f' || a.startsWith('--file')
  );
  let positionalArgs = getPositionalArgs(cmdBasename, ctx.args);

  if (hasStdin && !hasPatternFlag && positionalArgs.length > 1) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Grep with stdin detected multiple positional arguments. Recombining into single pattern to prevent file target misinterpretation... (Frictionless Recovery)`);
    const combinedPattern = positionalArgs.join(' ');
    let replaced = false;
    ctx.args = ctx.args.filter(a => {
      if (positionalArgs.includes(a)) {
        if (!replaced) {
          replaced = true;
          return true;
        }
        return false;
      }
      return true;
    }).map(a => positionalArgs.includes(a) ? combinedPattern : a);
    positionalArgs = [combinedPattern];
  }

  if (!hasStdin && !hasPatternFlag && positionalArgs.length > 2) {
    const isPathLike = (arg: string): boolean => {
      if (hasUnambiguousRegexMeta(arg)) return false;
      if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) return false;
      return (
        arg === '.' ||
        arg === '..' ||
        arg.includes('/') ||
        arg.includes('\\') ||
        /^[a-zA-Z]:/.test(arg) ||
        /\.[a-zA-Z0-9_-]+$/.test(arg) ||
        (() => {
          try {
            const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? path.resolve(ctx.payload.cwd) : process.cwd();
            const p = path.resolve(cwd, arg);
            return fs.existsSync(p) && fs.statSync(p).isDirectory();
          } catch {
            return false;
          }
        })()
      );
    };

    const lastArg = positionalArgs[positionalArgs.length - 1];
    const intermediateArgs = positionalArgs.slice(1, -1);
    const hasPathInIntermediate = intermediateArgs.some(a => isPathLike(a));

    if (isPathLike(lastArg) && !hasPathInIntermediate) {
      const patternParts = positionalArgs.slice(0, -1);
      const combinedPattern = patternParts.join(' ');
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in '${cmdBasename}'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
      let replaced = false;
      ctx.args = ctx.args.filter(a => {
        if (patternParts.includes(a)) {
          if (!replaced && a === patternParts[0]) {
            replaced = true;
            return true;
          }
          return false;
        }
        return true;
      }).map(a => a === patternParts[0] ? combinedPattern : a);
      positionalArgs = getPositionalArgs(cmdBasename, ctx.args);
    }
  }

  // Auto-heal reversed arguments (e.g. grep -r src/adapters/sqlite pattern)
  if (!hasStdin && !hasPatternFlag && positionalArgs.length === 2) {
    const isDir = (arg: string): boolean => isLikelyDirectoryArg(arg, ctx.payload.cwd);
    if (isDir(positionalArgs[0]) && !isDir(positionalArgs[1]) && !isSecondExistingTargetOnly(positionalArgs[0], positionalArgs[1], ctx.payload.cwd)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in '${cmdBasename}' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
      const idx0 = ctx.args.indexOf(positionalArgs[0]);
      const idx1 = ctx.args.indexOf(positionalArgs[1]);
      if (idx0 !== -1 && idx1 !== -1) {
        const tmp = ctx.args[idx0];
        ctx.args[idx0] = ctx.args[idx1];
        ctx.args[idx1] = tmp;
        positionalArgs = [positionalArgs[1], positionalArgs[0]];
      }
    }
  }

  if (positionalArgs.length === 0 && !hasPatternFlag && !hasStdin) {
    console.error(`\n   💡 AGENT HINT: '${cmdBasename.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
    process.exit(1);
  }

  let isRecursive = ctx.args.some(a =>
    a === '-r' || a === '-R' || a === '--recursive' || (a.startsWith('-') && !a.startsWith('--') && !a.startsWith('-e') && !a.startsWith('-f') && (a.includes('r') || a.includes('R')))
  );

  const targetFileArgs = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  const fileArgsCount = targetFileArgs.length;

  if (!hasStdin && fileArgsCount === 0) {
    if (!isRecursive) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename.replace(/\.exe$/, '')}' called without file arguments and no recursive flag.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' and '.' to search current directory recursively... (Frictionless Recovery)\x1b[0m`);
      ctx.args.unshift('-r');
      ctx.args.push('.');
      isRecursive = true;
    } else if (!ctx.args.includes('.')) {
      console.error(`\n   💡 AGENT INTERCEPT: Recursive '${cmdBasename.replace(/\.exe$/, '')}' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
      ctx.args.push('.');
    }
  } else if (!hasStdin && fileArgsCount > 0 && !isRecursive) {
    const hasDirTarget = targetFileArgs.some(a => isLikelyDirectoryArg(a, ctx.payload.cwd));
    if (hasDirTarget) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename.replace(/\.exe$/, '')}' called with a directory target without recursive flag.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
      ctx.args.unshift('-r');
      isRecursive = true;
    }
  }

  if (ctx.payload.target === 'wsl2') {
    const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
    ctx.args = ctx.args.map((a, idx) => idx === patternIdx ? a : convertToWslPath(a));
  }

  if (isRecursive) {
    injectRecursiveGrepExclusions(ctx.args);
    if (!ctx.args.includes('-s') && !ctx.args.includes('--no-messages')) {
      ctx.args.unshift('-s');
    }
    if (ctx.payload.target === 'wsl2' && (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs <= 30000)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted filesystem detected. Auto-extending timeout to 60000ms to prevent premature aborts... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.timeoutMs = 60000;
    }
  }
}
