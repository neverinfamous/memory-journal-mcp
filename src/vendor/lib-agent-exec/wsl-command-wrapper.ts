// @ts-nocheck
import path from 'node:path';
import { hasBalancedWrappingQuotes } from './regex-healer.js';
import {
  FLAGS_WITH_ARG_BY_TOOL,
  convertToWslPath,
  sanitizeWslRegex,
  findPatternExprIndex,
  hasSearchFixedStringsFlag,
  hasSearchPcre2Flag,
  extractLeadingShortFlags,
  buildWslEnvArgs,
  isPwsh,
  isCmd,
} from './command-utils.js';
import type { ExecPayload } from './schema.js';

const GREP_BASENAMES = new Set(['grep', 'grep.exe']);
const SEARCH_BASENAMES = new Set(['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe']);
const WSL_PATTERN_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  sed: new Set(['-e', '--expression']),
  awk: new Set(['-F', '--field-separator', '-v', '--assign']),
  gawk: new Set(['-F', '--field-separator', '-v', '--assign']),
  grep: new Set(['-e', '--regexp']),
  egrep: new Set(['-e', '--regexp']),
  fgrep: new Set(['-e', '--regexp']),
  rg: new Set(['-e', '--regexp']),
  find: new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex']),
};
const JQ_TWO_VALUE_EXEMPT_FLAGS = new Set(['--arg', '--argjson']);
const JQ_ONE_VALUE_EXEMPT_FLAGS = new Set(['--rawfile', '--slurpfile']);

export function collectWslPathExemptIndices(cmd: string, args: readonly string[]): Set<number> {
  const exempt = new Set<number>();
  const patternIdx = findPatternExprIndex(cmd, [...args]);
  if (patternIdx !== -1) exempt.add(patternIdx);
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(WSL_PATTERN_VALUE_FLAGS, base) ? WSL_PATTERN_VALUE_FLAGS[base] : undefined;
  const isJq = base === 'jq' || base === 'yq';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (isJq && JQ_TWO_VALUE_EXEMPT_FLAGS.has(a)) {
      if (i + 1 < args.length) exempt.add(i + 1);
      if (i + 2 < args.length) exempt.add(i + 2);
      i += 2;
      continue;
    }
    if (isJq && JQ_ONE_VALUE_EXEMPT_FLAGS.has(a)) {
      if (i + 1 < args.length) exempt.add(i + 1);
      i += 2;
      continue;
    }
    if (valueFlags !== undefined && valueFlags.has(a) && i + 1 < args.length) {
      exempt.add(i + 1);
      i += 1;
    }
  }
  return exempt;
}

function hasOddTrailingBackslashes(pattern: string): boolean {
  const m = pattern.match(/(\\*)\$$/);
  return ((m?.[1]?.length ?? 0) % 2) === 1;
}

export function collectArgJsonValueIndices(cmd: string, args: readonly string[]): Set<number> {
  const out = new Set<number>();
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  if (base !== 'jq' && base !== 'yq') return out;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--argjson' && i + 2 < args.length) {
      out.add(i + 2);
      i += 2;
    } else if (a === '--arg' || a === '--slurpfile' || a === '--rawfile') {
      i += 2;
    }
  }
  return out;
}

function hasAnyGrepExplicitMatcherFlag(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (valueFlags !== undefined && valueFlags.includes(a)) { i++; continue; }
    if (['-E', '--extended-regexp', '-G', '--basic-regexp', '-P', '--perl-regexp', '-F', '--fixed-strings'].includes(a)) {
      return true;
    }
    const head = extractLeadingShortFlags(base, a);
    if (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*[EGPF][a-zA-Z]*$/.test(head)) {
      return true;
    }
  }
  return false;
}

function hasGrepBasicRegexpFlag(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (valueFlags !== undefined && valueFlags.includes(a)) { i++; continue; }
    if (a === '-G' || a === '--basic-regexp') return true;
    const head = extractLeadingShortFlags(base, a);
    if (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*G[a-zA-Z]*$/.test(head)) return true;
  }
  return false;
}

function switchGrepMatcherToPcre2(cmd: string, args: string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  let switched = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (valueFlags !== undefined && valueFlags.includes(a)) { i++; continue; }
    const head = extractLeadingShortFlags(base, a);
    if (a === '-P' || a === '--perl-regexp' || (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*P[a-zA-Z]*$/.test(head))) {
      return false;
    }
    if (a === '-E' || a === '--extended-regexp') {
      args[i] = '-P';
      switched = true;
    } else if (head.startsWith('-') && !head.startsWith('--') && /^-[a-zA-Z]*E[a-zA-Z]*$/.test(head)) {
      args[i] = head.replace(/E/g, 'P') + a.slice(head.length);
      switched = true;
    }
  }
  if (!switched) {
    args.unshift('-P');
    return true;
  }
  return false;
}

function escapeWslRegexLineEndings(localCmd: string, localArgs: string[], patternIdx: number): string {
  const base = path.basename(localCmd).toLowerCase();
  if (patternIdx === -1 || hasSearchFixedStringsFlag(localCmd, localArgs) || base === 'fgrep') {
    return localCmd;
  }
  const originalPattern = localArgs[patternIdx];
  if (originalPattern === undefined) return localCmd;
  const pcre2 = hasSearchPcre2Flag(localCmd, localArgs);
  let updatedPattern = sanitizeWslRegex(originalPattern, { pcre2 });
  localArgs[patternIdx] = updatedPattern;

  let activeIdx = patternIdx;
  if (updatedPattern !== originalPattern && GREP_BASENAMES.has(base) && !hasAnyGrepExplicitMatcherFlag(localCmd, localArgs)) {
    localArgs.unshift('-E');
    activeIdx += 1;
  }

  updatedPattern = localArgs[activeIdx] ?? updatedPattern;
  if (!updatedPattern.endsWith('$') || hasOddTrailingBackslashes(updatedPattern)) return localCmd;

  const isEgrep = base === 'egrep' || base === 'egrep.exe';
  const isGrepOrEgrep = base === 'grep' || base === 'grep.exe' || isEgrep;
  const isRg = base === 'rg' || base === 'rg.exe';
  let resolvedCmd = localCmd;
  if (isGrepOrEgrep) {
    if (hasGrepBasicRegexpFlag(localCmd, localArgs)) return localCmd;
    if (switchGrepMatcherToPcre2(localCmd, localArgs)) {
      activeIdx += 1;
    }
    if (isEgrep) resolvedCmd = 'grep';
  } else if (isRg && !hasSearchPcre2Flag(localCmd, localArgs)) {
    // [INVARIANT]: Never rewrite ripgrep `-E` (--encoding) into `-P`; prepend `-P` cleanly instead.
    localArgs.unshift('-P');
    activeIdx += 1;
  }
  const current = localArgs[activeIdx];
  if (current !== undefined) {
    localArgs[activeIdx] = current.replace(/\$$/, () => '\\r?$');
  }
  return resolvedCmd;
}

const POSIX_INLINE_SHELLS = new Set(['sh', 'bash', 'zsh', 'ash', 'dash']);

export function findWslShellInlineScriptIndex(cmdName: string, cmdArgs: readonly string[]): number {
  const base = path.basename(cmdName).toLowerCase().replace(/\.exe$/, '');
  if (!POSIX_INLINE_SHELLS.has(base)) return -1;
  for (let i = 0; i < cmdArgs.length; i++) {
    const a = cmdArgs[i];
    if (a === undefined || a === '--') break;
    if (a === '-o' || a === '+o') { i += 1; continue; }
    if (a === '-c' || (/^-[a-zA-Z]+$/.test(a) && a.includes('c'))) {
      return i + 1 < cmdArgs.length ? i + 1 : -1;
    }
    if (!a.startsWith('-') && !a.startsWith('+')) break;
  }
  return -1;
}

export function normalizeWslCommandArgs(cmd: string, args: string[]): { cmd: string; args: string[] } {
  const wslCmd = convertToWslPath(cmd);
  const patternExprIdx = findPatternExprIndex(wslCmd, args);
  const exempt = collectWslPathExemptIndices(wslCmd, args);
  const argJsonValues = collectArgJsonValueIndices(wslCmd, args);
  const inlineScriptIdx = findWslShellInlineScriptIndex(wslCmd, args);

  const wslArgs = args.map((a, idx) => {
    if ((inlineScriptIdx !== -1 && idx === inlineScriptIdx) || argJsonValues.has(idx)) return a;
    let cleaned = a;
    if (
      (cleaned.startsWith('"') && hasBalancedWrappingQuotes(cleaned, '"')) ||
      (cleaned.startsWith("'") && hasBalancedWrappingQuotes(cleaned, "'"))
    ) {
      cleaned = cleaned.slice(1, -1);
    }
    if (exempt.has(idx)) return cleaned;
    return convertToWslPath(cleaned);
  });

  let finalCmd = wslCmd;
  const lowerCmd = wslCmd.toLowerCase();
  if (lowerCmd === 'diff' || lowerCmd === 'diff.exe') {
    if (!wslArgs.includes('--strip-trailing-cr')) {
      wslArgs.unshift('--strip-trailing-cr');
    }
  } else if (SEARCH_BASENAMES.has(path.basename(lowerCmd))) {
    finalCmd = escapeWslRegexLineEndings(wslCmd, wslArgs, patternExprIdx);
  }

  return { cmd: finalCmd, args: wslArgs };
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
  const exempt = collectWslPathExemptIndices(path.basename(cmd), args);
  const inlineScriptIdx = findWslShellInlineScriptIndex(cmd, args);
  let wslArgs = inlineScriptIdx !== -1
    ? args.map((arg, idx) => (idx <= inlineScriptIdx || exempt.has(idx) ? arg : convertToWslPath(arg)))
    : args.map((arg, idx) => (exempt.has(idx) ? arg : convertToWslPath(arg)));

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
