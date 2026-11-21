// @ts-nocheck
import path from 'node:path';
import { hasBalancedWrappingQuotes } from './regex-healer.js';
import {
  convertToWslPath,
  sanitizeWslRegex,
  findPatternExprIndex,
  buildWslEnvArgs,
  isPwsh,
  isCmd,
} from './command-utils.js';
import type { ExecPayload } from './schema.js';

const GREP_BASENAMES = new Set(['grep', 'grep.exe']);
const SEARCH_BASENAMES = new Set(['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe']);

function hasOddTrailingBackslashes(pattern: string): boolean {
  const m = pattern.match(/(\\*)\$$/);
  return ((m?.[1]?.length ?? 0) % 2) === 1;
}

function escapeWslRegexLineEndings(localCmd: string, localArgs: string[], patternIdx: number): void {
  const base = path.basename(localCmd).toLowerCase();
  if (patternIdx === -1 || localArgs.includes('-F') || localArgs.includes('--fixed-strings') || base === 'fgrep') {
    return;
  }
  const originalPattern = localArgs[patternIdx];
  if (originalPattern === undefined) return;
  let updatedPattern = sanitizeWslRegex(originalPattern);
  localArgs[patternIdx] = updatedPattern;

  let activeIdx = patternIdx;
  if (updatedPattern !== originalPattern && GREP_BASENAMES.has(base) && !localArgs.includes('-E') && !localArgs.includes('-P')) {
    localArgs.unshift('-E');
    activeIdx += 1;
  }

  updatedPattern = localArgs[activeIdx] ?? updatedPattern;
  if (!updatedPattern.endsWith('$') || hasOddTrailingBackslashes(updatedPattern)) return;

  const isGrepOrEgrep = base === 'grep' || base === 'grep.exe' || base === 'egrep' || base === 'egrep.exe';
  const isRg = base === 'rg' || base === 'rg.exe';
  if (isGrepOrEgrep && localArgs.includes('-E')) {
    localArgs[localArgs.indexOf('-E')] = '-P';
  } else if (isGrepOrEgrep && !localArgs.includes('-P')) {
    localArgs.unshift('-P');
    activeIdx += 1;
  } else if (isRg && !localArgs.includes('-P') && !localArgs.includes('--pcre2')) {
    // [INVARIANT]: Never rewrite ripgrep `-E` (--encoding) into `-P`; prepend `-P` cleanly instead.
    localArgs.unshift('-P');
    activeIdx += 1;
  }
  const current = localArgs[activeIdx];
  if (current !== undefined) {
    localArgs[activeIdx] = current.replace(/\$$/, () => '\\r?$');
  }
}

export function normalizeWslCommandArgs(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const wslCmd = convertToWslPath(cmd);
  const patternExprIdx = findPatternExprIndex(wslCmd, args);
  const isShellC = ['sh', 'bash'].includes(path.basename(wslCmd).toLowerCase()) && args[0] === '-c';

  const wslArgs = args.map((a, idx) => {
    if (isShellC && idx === 1) return a;
    let cleaned = a;
    if (
      (cleaned.startsWith('"') && hasBalancedWrappingQuotes(cleaned, '"')) ||
      (cleaned.startsWith("'") && hasBalancedWrappingQuotes(cleaned, "'"))
    ) {
      cleaned = cleaned.slice(1, -1);
    }
    if (idx === patternExprIdx) return cleaned;
    return convertToWslPath(cleaned);
  });

  const lowerCmd = wslCmd.toLowerCase();
  if (lowerCmd === 'diff' || lowerCmd === 'diff.exe') {
    if (!wslArgs.includes('--strip-trailing-cr')) {
      wslArgs.unshift('--strip-trailing-cr');
    }
  } else if (SEARCH_BASENAMES.has(path.basename(lowerCmd))) {
    escapeWslRegexLineEndings(wslCmd, wslArgs, patternExprIdx);
  }

  return { cmd: wslCmd, args: wslArgs };
}

export function wrapFinalWslCommand(
  cmd: string,
  args: string[],
  payload: ExecPayload,
  cwd: string,
  envOverrides: Record<string, string>,
  tempScriptPath: string | null,
): { cmd: string; args: string[] } {
  const isPosixInternalCwd = payload.cwd !== undefined && typeof payload.cwd === 'string' &&
    (payload.cwd.startsWith('/') || payload.cwd.startsWith('~'));
  const wslCwd = isPosixInternalCwd
    ? (payload.cwd ?? cwd)
    : convertToWslPath(payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : cwd);

  const wslEnvArgs = buildWslEnvArgs(payload.env, envOverrides);
  const patternExprIdx = findPatternExprIndex(path.basename(cmd), args);
  const isShellC = ['sh', 'bash'].includes(path.basename(cmd).toLowerCase()) && args[0] === '-c';
  let wslArgs = isShellC
    ? [args[0] ?? '-c', args[1] ?? '', ...args.slice(2).map(a => convertToWslPath(a))]
    : args.map((arg, idx) => (idx === patternExprIdx ? arg : convertToWslPath(arg)));

  let wslCmd = cmd;
  if (/[a-zA-Z]:[/\\]/.test(wslCmd)) {
    wslCmd = convertToWslPath(wslCmd);
  } else if (wslCmd === 'python') {
    wslCmd = 'python3';
  } else if (isPwsh(wslCmd) || isCmd(wslCmd)) {
    wslCmd = 'bash';
    if (tempScriptPath !== null && tempScriptPath.length > 0) {
      wslArgs = [convertToWslPath(tempScriptPath)];
    }
  }

  return {
    cmd: 'wsl.exe',
    args: ['--cd', wslCwd, '-e', 'env', ...wslEnvArgs, wslCmd, ...wslArgs],
  };
}
