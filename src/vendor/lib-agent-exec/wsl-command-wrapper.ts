// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { hasBalancedWrappingQuotes } from './regex-healer.js';
import { BUILT_INS } from './utils.js';
import {
  FLAGS_WITH_ARG_BY_TOOL,
  convertToWslPath,
  sanitizeWslRegex,
  findPatternExprIndex,
  hasSearchFixedStringsFlag,
  hasSearchPcre2Flag,
  inspectCombinedShortFlag,
  buildWslEnvArgs,
  buildPwshWrapper,
  escapeUnixArg,
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
  rg: new Set(['-e', '--regexp', '-r', '--replace', '--path-separator', '--context-separator', '--field-context-separator', '--field-match-separator']),
  find: new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex']),
};
const JQ_TWO_VALUE_EXEMPT_FLAGS = new Set(['--arg', '--argjson']);
const JQ_ONE_VALUE_EXEMPT_FLAGS = new Set(['--rawfile', '--slurpfile', '--argfile']);

export function collectWslPathExemptIndices(cmd: string, args: readonly string[]): Set<number> {
  const exempt = new Set<number>();
  const patternIdx = findPatternExprIndex(cmd, [...args]);
  if (patternIdx !== -1) exempt.add(patternIdx);
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(WSL_PATTERN_VALUE_FLAGS, base) ? WSL_PATTERN_VALUE_FLAGS[base] : undefined;
  const toolValueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
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
    const shortInfo = inspectCombinedShortFlag(base, a, toolValueFlags);
    const tailFlag = shortInfo.tailChar.length > 0 ? `-${shortInfo.tailChar}` : '';
    const isPatternValue = (valueFlags !== undefined && (valueFlags.has(a) || (shortInfo.takesSeparateValue && tailFlag.length > 0 && valueFlags.has(tailFlag))))
      || (base === 'rg' && shortInfo.takesSeparateValue && ['e', 'r', 'g'].includes(shortInfo.tailChar));
    if (isPatternValue && i + 1 < args.length) {
      exempt.add(i + 1);
      i += 1;
    } else if (shortInfo.takesSeparateValue && i + 1 < args.length) {
      i += 1;
    }
  }
  return exempt;
}

function hasOddTrailingBackslashes(pattern: string): boolean {
  if (!pattern.endsWith('$')) return false;
  let slashes = 0;
  for (let i = pattern.length - 2; i >= 0 && pattern[i] === '\\'; i--) slashes += 1;
  return slashes % 2 === 1;
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
    const shortInfo = inspectCombinedShortFlag(base, a, valueFlags);
    if (['-E', '--extended-regexp', '-G', '--basic-regexp', '-P', '--perl-regexp', '-F', '--fixed-strings'].includes(a)) {
      return true;
    }
    if (shortInfo.shortPrefix.length > 1 && /^-[a-zA-Z]*[EGPF][a-zA-Z]*$/.test(shortInfo.shortPrefix)) {
      return true;
    }
    if (shortInfo.takesSeparateValue) i++;
  }
  return false;
}

function hasGrepBasicRegexpFlag(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const shortInfo = inspectCombinedShortFlag(base, a, valueFlags);
    if (a === '-G' || a === '--basic-regexp') return true;
    if (shortInfo.shortPrefix.length > 1 && /^-[a-zA-Z]*G[a-zA-Z]*$/.test(shortInfo.shortPrefix)) return true;
    if (shortInfo.takesSeparateValue) i++;
  }
  return false;
}

function switchGrepMatcherToPcre2(cmd: string, args: string[]): boolean {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  let switched = false;
  let hasPcre2 = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const shortInfo = inspectCombinedShortFlag(base, a, valueFlags);
    const head = shortInfo.shortPrefix;
    if (a === '-P' || a === '--perl-regexp' || (head.length > 1 && /^-[a-zA-Z]*P[a-zA-Z]*$/.test(head))) {
      hasPcre2 = true;
    } else if (a === '-E' || a === '--extended-regexp') {
      args[i] = '-P';
      switched = true;
    } else if (head.length > 1 && /^-[a-zA-Z]*E[a-zA-Z]*$/.test(head)) {
      args[i] = head.replace(/E/g, 'P') + a.slice(head.length);
      switched = true;
    }
    if (shortInfo.takesSeparateValue) i++;
  }
  if (!switched && !hasPcre2) {
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
  if (GREP_BASENAMES.has(base) && hasGrepBasicRegexpFlag(localCmd, localArgs)) {
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
    if (!a.startsWith('--') && /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/.test(a)) {
      if (a.startsWith('-') && a.slice(1).includes('c')) {
        return i + 2 < cmdArgs.length ? i + 2 : -1;
      }
      i += 1;
      continue;
    }
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
  const baseCmd = path.basename(lowerCmd);
  if (baseCmd === 'diff' || baseCmd === 'diff.exe') {
    if (!wslArgs.includes('--strip-trailing-cr')) {
      wslArgs.unshift('--strip-trailing-cr');
    }
  } else if (SEARCH_BASENAMES.has(baseCmd)) {
    finalCmd = escapeWslRegexLineEndings(wslCmd, wslArgs, patternExprIdx);
  }

  return { cmd: finalCmd, args: wslArgs };
}

const SHELL_OPERATORS = ['&&', '||', '|', '|&', '>', '>>', '<', '<<', '<<<', ';', '2>', '1>', '2>&1', '&'];
const SHELL_OPERATORS_SET = new Set(SHELL_OPERATORS);
const SHELL_OP_VALUE_FLAGS = new Set([
  '-d', '--delimiter', '-e', '-f', '-F', '-t', '--field-separator',
  '-m', '--message', '--msg', '-b', '--body', '--title',
]);

function matchAttachedRedirection(trimmed: string): RegExpMatchArray | null {
  const m = trimmed.match(/^([0-9]?>>?|[0-9]?<)(.+)$/);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  const target = m[2];
  if (target.startsWith('=') || target.startsWith('<') || target.startsWith('>') || target.includes('>')) return null;
  if ((m[1] === '>' || m[1] === '<') && /^\d+\.\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?$/.test(target)) return null;
  return m;
}

function isShellWrapExemptArg(
  idx: number,
  trimmed: string,
  localBase: string,
  localArgs: readonly string[],
  exemptIndices: ReadonlySet<number>,
): boolean {
  if (exemptIndices.has(idx)) return true;
  const prev = idx > 0 ? localArgs[idx - 1] : undefined;
  if (prev !== undefined && SHELL_OP_VALUE_FLAGS.has(prev)) return true;
  return localBase === 'find'
    && trimmed === ';'
    && localArgs.slice(0, idx).some(x => x === '-exec' || x === '-execdir' || x === '-ok' || x === '-okdir');
}

export function wrapBuiltinOrShellCommand(
  localCmd: string,
  localArgs: string[],
  target: ExecPayload['target'],
): { cmd: string; args: string[] } {
  const localBase = path.basename(localCmd).toLowerCase().replace(/\.exe$/, '');
  if (findWslShellInlineScriptIndex(localCmd, localArgs) !== -1) return { cmd: localCmd, args: localArgs };
  const exemptIndices = collectWslPathExemptIndices(localCmd, localArgs);
  const hasHardShellMeta = /[|&;<>$`{}\r\n]/.test(localCmd);
  const isRootedPath = /^(?:\/|[a-zA-Z]:[\\/])/.test(localCmd);
  const hasParenCmdMeta = /[()]/.test(localCmd) && !(isRootedPath && !hasHardShellMeta);
  const isPlainSpacedPath = localCmd.includes(' ') && !hasHardShellMeta && !hasParenCmdMeta
    && (isRootedPath || fs.existsSync(localCmd));
  const hasCmdMeta = hasHardShellMeta || hasParenCmdMeta || (localCmd.includes(' ') && !isPlainSpacedPath);
  const hasArgMeta = localArgs.some((a, idx) => {
    const trimmed = a.trim();
    if (isShellWrapExemptArg(idx, trimmed, localBase, localArgs, exemptIndices)) return false;
    return SHELL_OPERATORS_SET.has(trimmed) || matchAttachedRedirection(trimmed) !== null;
  });
  if (!BUILT_INS.includes(localCmd.toLowerCase()) && !(target === 'wsl2' && (hasCmdMeta || hasArgMeta))) {
    return { cmd: localCmd, args: localArgs };
  }
  console.error(`\n   💡 AGENT HINT: '${localCmd}' is a shell built-in or contains shell metacharacters.`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell to prevent execution failure...`);
  if (process.platform === 'win32' && target !== 'wsl2') return buildPwshWrapper(localCmd, localArgs);
  const isCompoundCmd = hasCmdMeta;
  const renderedArgs = localArgs.map((a, idx) => {
    const trimmed = a.trim();
    const skipOp = isShellWrapExemptArg(idx, trimmed, localBase, localArgs, exemptIndices);
    if (!skipOp && SHELL_OPERATORS_SET.has(trimmed)) return trimmed;
    const redir = !skipOp ? matchAttachedRedirection(trimmed) : null;
    if (redir?.[1] !== undefined && redir[2] !== undefined) {
      return /^&(?:\d+|-)$/.test(redir[2]) ? trimmed : `${redir[1]}${escapeUnixArg(redir[2], false)}`;
    }
    return escapeUnixArg(a, false);
  });
  return { cmd: 'sh', args: ['-c', [isCompoundCmd ? localCmd : escapeUnixArg(localCmd, false), ...renderedArgs].join(' ')] };
}

function findEmbeddedShellInlineIdx(cmdBase: string, args: readonly string[]): number {
  const isCmdShell = isCmd(cmdBase);
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    if (low === '--') return -1;
    if (isCmdShell) {
      if (low === '/k') return -1;
      if (low === '/c') return i;
      continue;
    }
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    if (head === '-file' || head === '-f' || head === '-encodedcommand' || head === '-ec' || head === '-en') return -1;
    if (head === '-c' || head === '-command') return i;
  }
  return -1;
}

function wrapTildeScriptArgs(
  wslCmd: string,
  wslArgs: readonly string[],
  payload: ExecPayload,
  tempScriptPath: string | null,
): string[] {
  const tildeScriptPath = payload.type === 'script' && tempScriptPath === null && payload.scriptPath.startsWith('~/')
    ? payload.scriptPath
    : undefined;
  const tildeScriptIdx = tildeScriptPath !== undefined ? wslArgs.indexOf(tildeScriptPath) : -1;
  if (tildeScriptPath === undefined || tildeScriptIdx === -1) return [wslCmd, ...wslArgs];
  if (tildeScriptIdx === 0) {
    return ['sh', '-c', 'c="$1"; s="$HOME/$2"; shift 2; exec "$c" "$s" "$@"', '_', wslCmd, tildeScriptPath.slice(2), ...wslArgs.slice(1)];
  }
  return [
    'sh',
    '-c',
    'n="$1"; m="$2"; s="$HOME/$3"; shift 3; while [ "$n" -gt 0 ]; do set -- "$@" "$1"; shift; n=$((n - 1)); done; set -- "$@" "$s"; while [ "$m" -gt 0 ]; do set -- "$@" "$1"; shift; m=$((m - 1)); done; exec "$@"',
    '_',
    String(tildeScriptIdx + 1),
    String(wslArgs.length - tildeScriptIdx - 1),
    tildeScriptPath.slice(2),
    wslCmd,
    ...wslArgs.slice(0, tildeScriptIdx),
    ...wslArgs.slice(tildeScriptIdx + 1),
  ];
}

export function wrapFinalWslCommand(
  cmd: string,
  args: string[],
  payload: ExecPayload,
  cwd: string,
  envOverrides: Record<string, string>,
  tempScriptPath: string | null,
): { cmd: string; args: string[] } {
  const trimmedPayloadCwd = typeof payload.cwd === 'string' ? payload.cwd.trim().replace(/^['"]|['"]$/g, '').trim() : undefined;
  const isPosixInternalCwd = trimmedPayloadCwd !== undefined &&
    (trimmedPayloadCwd.startsWith('/') || trimmedPayloadCwd.startsWith('~'));
  const isTildePrefix = isPosixInternalCwd && trimmedPayloadCwd.startsWith('~/');
  const tildeSubdirRel = isTildePrefix ? trimmedPayloadCwd.replace(/^~\/+/, '') : '';
  const isTildeSubdir = tildeSubdirRel.length > 0;
  const resolvedHostCwd = trimmedPayloadCwd !== undefined && trimmedPayloadCwd.length > 0
    ? path.resolve(cwd, trimmedPayloadCwd)
    : cwd;
  const wslCwd = isTildePrefix
    ? '~'
    : (isPosixInternalCwd ? (trimmedPayloadCwd ?? cwd) : convertToWslPath(resolvedHostCwd));

  const wslEnvArgs = buildWslEnvArgs(payload.env, envOverrides);
  const exempt = collectWslPathExemptIndices(path.basename(cmd), args);
  const inlineScriptIdx = findWslShellInlineScriptIndex(cmd, args);
  let wslArgs = inlineScriptIdx !== -1
    ? args.map((arg, idx) => (idx <= inlineScriptIdx || exempt.has(idx) ? arg : convertToWslPath(arg)))
    : args.map((arg, idx) => (exempt.has(idx) ? arg : convertToWslPath(arg)));

  let wslCmd = cmd;
  const wslCmdBase = path.posix.basename(wslCmd.replace(/\\/g, '/')).toLowerCase();
  if (/[a-zA-Z]:[/\\]/.test(wslCmd)) {
    wslCmd = convertToWslPath(wslCmd);
  } else if (/^python(?:\.exe)?$/i.test(wslCmdBase)) {
    wslCmd = wslCmd.includes('/') || wslCmd.includes('\\')
      ? `${wslCmd.slice(0, wslCmd.length - wslCmdBase.length)}python3`
      : 'python3';
  } else if (isPwsh(wslCmdBase) || isCmd(wslCmdBase)) {
    if (tempScriptPath !== null && tempScriptPath.length > 0) {
      wslCmd = 'bash';
      const trailingScriptArgs = (payload.type === 'script' || payload.type === 'eval') && Array.isArray(payload.args)
        ? payload.args.map(a => convertToWslPath(a))
        : [];
      wslArgs = [convertToWslPath(tempScriptPath), ...trailingScriptArgs];
    } else {
      const inlineIdx = findEmbeddedShellInlineIdx(wslCmdBase, wslArgs);
      if (inlineIdx !== -1) {
        const flagTok = wslArgs[inlineIdx] ?? '';
        const colonIdx = flagTok.indexOf(':');
        const inlinePart = colonIdx !== -1 ? flagTok.slice(colonIdx + 1) : '';
        const restPart = wslArgs.slice(inlineIdx + 1).join(' ');
        const script = inlinePart.length > 0 ? (restPart.length > 0 ? `${inlinePart} ${restPart}` : inlinePart) : restPart;
        if (script.length > 0) {
          wslCmd = 'bash';
          wslArgs = ['-c', script];
        }
      }
    }
  }

  const innerArgs = wrapTildeScriptArgs(wslCmd, wslArgs, payload, tempScriptPath);

  const execArgs = isTildeSubdir
    ? ['sh', '-c', 'cd -- "$1" && shift && exec "$@"', '_', tildeSubdirRel, 'env', ...wslEnvArgs, ...innerArgs]
    : ['env', ...wslEnvArgs, ...innerArgs];

  return {
    cmd: 'wsl.exe',
    args: ['--cd', wslCwd, '-e', ...execArgs],
  };
}
