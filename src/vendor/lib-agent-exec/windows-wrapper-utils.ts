// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {
  FLAGS_WITH_ARG_SET_BY_TOOL,
  convertToWindowsPath,
  convertToWslPath,
  escapeUnixArg,
  findPatternExprIndex,
  inspectCombinedShortFlag,
} from './command-utils.js';
import type { ExecPayload } from './schema.js';

const UNIX_GLOB_UTILS = new Set(['grep', 'ls', 'rm', 'cp', 'mv', 'cat', 'rg']);
const MAX_WIN32_ARGV_CHARS = 24_000;
const GLOB_EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.test-output', '.next', '.turbo']);
const GLOB_EXCLUDE_DIR_REGEXES: ReadonlyMap<string, RegExp> = new Map(
  [...GLOB_EXCLUDE_DIRS].map(dir => [
    dir,
    new RegExp(`(?:^|/)${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|$)`, 'i'),
  ]),
);

function shouldExcludeGlobEntry(entryPath: string, pattern: string): boolean {
  const base = path.posix.basename(entryPath.replace(/\\/g, '/')).toLowerCase();
  const re = GLOB_EXCLUDE_DIR_REGEXES.get(base);
  if (re === undefined) return false;
  return !re.test(pattern);
}

function estimateCommandChars(cmd: string, args: readonly string[]): number {
  let total = cmd.length + 128;
  for (const a of args) total += a.length + 3;
  return total;
}

function splitConcreteDirGlobForRg(globArg: string): { filter: string; targetDir: string } | null {
  const norm = globArg.replace(/\\/g, '/');
  const firstWild = norm.search(/[*?[\]]/);
  if (firstWild === -1) return null;
  const slashBefore = norm.lastIndexOf('/', firstWild);
  if (slashBefore <= 0) return null;
  const rawTargetDir = norm.slice(0, slashBefore);
  const targetDir = /^[a-zA-Z]:$/.test(rawTargetDir) ? `${rawTargetDir}/` : rawTargetDir;
  const filter = norm.slice(slashBefore + 1);
  if (!targetDir || !filter || /[*?[\]]/.test(targetDir)) return null;
  return { filter, targetDir };
}

function rewriteUnmatchedRgWinGlobs(
  args: string[],
  cmd: string,
  overflowedGlobs?: ReadonlySet<string>,
): { args: string[]; rewrittenCount: number; droppedCount: number; needsShellFallback: boolean } {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  if (base !== 'rg') return { args, rewrittenCount: 0, droppedCount: 0, needsShellFallback: false };
  const patternIdx = findPatternExprIndex(cmd, args);
  const toolFlags = FLAGS_WITH_ARG_SET_BY_TOOL['rg'];
  const nextArgs: string[] = [];
  const unmatchedEntries: Array<{ raw: string; overflowed: boolean }> = [];
  let hasTargetPath = false;
  let seenDoubleDash = false;
  let nextDashDashIdx = -1;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      nextDashDashIdx = nextArgs.length;
      nextArgs.push(a);
      continue;
    }
    if (!seenDoubleDash && inspectCombinedShortFlag('rg', a, toolFlags).takesSeparateValue && i + 1 < args.length) {
      nextArgs.push(a, args[i + 1] ?? '');
      i++;
      continue;
    }
    if (!seenDoubleDash && a.startsWith('-')) {
      nextArgs.push(a);
      continue;
    }
    if (i === patternIdx) {
      nextArgs.push(a);
      continue;
    }
    if (a.includes('*') || a.includes('?')) {
      unmatchedEntries.push({ raw: a, overflowed: overflowedGlobs?.has(a) === true });
      continue;
    }
    hasTargetPath = true;
    nextArgs.push(a);
  }

  if (unmatchedEntries.length === 0) return { args, rewrittenCount: 0, droppedCount: 0, needsShellFallback: false };
  if (hasTargetPath && unmatchedEntries.some(e => e.overflowed)) {
    return { args, rewrittenCount: 0, droppedCount: 0, needsShellFallback: true };
  }
  const unmatchedGlobs: string[] = [];
  const extraTargetDirs: string[] = [];
  let droppedCount = 0;
  for (const entry of unmatchedEntries) {
    // [INVARIANT]: When concrete non-glob targets already exist, never inject a global `-g` filter for a 0-match glob
    // because `-g` would silently blind ripgrep from searching all unrelated concrete target paths.
    if (hasTargetPath) {
      droppedCount += 1;
      continue;
    }
    const split = splitConcreteDirGlobForRg(entry.raw);
    if (split !== null) {
      unmatchedGlobs.push(split.filter);
      if (!extraTargetDirs.includes(split.targetDir)) extraTargetDirs.push(split.targetDir);
    } else {
      unmatchedGlobs.push(entry.raw);
    }
  }
  if (unmatchedGlobs.length > 0) {
    const globFlags = unmatchedGlobs.flatMap(g => ['-g', g]);
    if (nextDashDashIdx !== -1) nextArgs.splice(nextDashDashIdx, 0, ...globFlags);
    else nextArgs.unshift(...globFlags);
    if (extraTargetDirs.length > 0) nextArgs.push(...extraTargetDirs);
    else if (!hasTargetPath) nextArgs.push('.');
  }
  return { args: nextArgs, rewrittenCount: unmatchedGlobs.length, droppedCount, needsShellFallback: false };
}

const GLOB_FILTER_PREV_FLAGS = new Set([
  '-g', '--glob', '--iglob', '--include', '--exclude', '--exclude-dir', '--exclude-from',
  '-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-filter',
  '-e', '--regexp', '--expression', '-f', '--file', '-r', '--replace', '--label',
  '-I', '--ignore', '--hide',
]);

function collectPatternOrFilterIndices(cmdBase: string, args: readonly string[], patternExprIdx: number): Set<number> {
  const skip = new Set<number>();
  if (patternExprIdx !== -1) skip.add(patternExprIdx);
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_SET_BY_TOOL, cmdBase) ? FLAGS_WITH_ARG_SET_BY_TOOL[cmdBase] : undefined;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && !a.includes('=') && (GLOB_FILTER_PREV_FLAGS.has(a) || inspectCombinedShortFlag(cmdBase, a, toolFlags).takesSeparateValue)) {
      if (i + 1 < args.length) skip.add(i + 1);
      i++;
    }
  }
  return skip;
}

function collectGlobCandidateIndices(_cmdBase: string, args: readonly string[], exemptIndices: ReadonlySet<number>): number[] {
  const globIdxs: number[] = [];
  let seenDoubleDash = false;
  for (let idx = 0; idx < args.length; idx++) {
    const a = args[idx];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (exemptIndices.has(idx)) continue;
    if (!seenDoubleDash && a.startsWith('-')) continue;
    if (a.includes('*') || a.includes('?')) globIdxs.push(idx);
  }
  return globIdxs;
}

function formatFindArgsForWsl(args: readonly string[]): string {
  let inPaths = true;
  return args.map((a, idx) => {
    if (inPaths) {
      if (a === '-H' || a === '-L' || a === '-P' || a.startsWith('-O')) return escapeUnixArg(a, false);
      if (a === '-D') return escapeUnixArg(a, false);
      if (idx > 0 && args[idx - 1] === '-D') return escapeUnixArg(a, false);
      if (a.startsWith('-') || a === '(' || a === '!' || a === ',') {
        inPaths = false;
      } else {
        return escapeUnixArg(convertToWslPath(a), false);
      }
    }
    return escapeUnixArg(a, false);
  }).join(' ');
}

function rewriteWindowsFindWrapper(cmd: string, args: string[], payload: ExecPayload): { cmd: string; args: string[] } {
  const base = path.basename(cmd).toLowerCase();
  if (base !== 'find' && base !== 'find.exe') return { cmd, args };
  if (payload.target === 'wsl2') return { cmd, args };
  const isUnixFind = args.some(
    a => a.startsWith('-name') || a.startsWith('-type') || a.startsWith('-exec') || a.startsWith('-mtime') || a === '.' || a === '..',
  );
  if (!isUnixFind) return { cmd, args };
  const originalArgs = formatFindArgsForWsl(args);
  if (process.platform === 'win32') {
    payload.target = 'wsl2';
  }
  console.error(`\n   💡 AGENT HINT: Detected Unix-style 'find' command. Forwarding to 'sh -c' to bypass Windows find.exe limits.`);
  return { cmd: 'sh', args: ['-c', `find ${originalArgs}`] };
}

const LS_VALUE_FLAGS = new Set([
  '-I', '--ignore', '--hide', '-w', '--width', '-T', '--tabsize',
  '--block-size', '--format', '--sort', '--time', '--time-style',
  '--quoting-style', '--indicator-style',
]);

function buildLsGlobScript(args: readonly string[], exemptIndices: ReadonlySet<number>): string {
  let seenDd = false;
  const lsFlags: string[] = [];
  const lsOperands: string[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const a = args[idx];
    if (a === undefined) continue;
    if (!seenDd && a === '--') {
      seenDd = true;
      lsFlags.push(escapeUnixArg(a, false));
      continue;
    }
    if (!seenDd && a.startsWith('-')) {
      lsFlags.push(escapeUnixArg(a, false));
      if (LS_VALUE_FLAGS.has(a) && idx + 1 < args.length) {
        const val = args[idx + 1];
        if (val !== undefined) lsFlags.push(escapeUnixArg(val, false));
        idx++;
      }
      continue;
    }
    lsOperands.push(exemptIndices.has(idx) ? escapeUnixArg(a, false) : escapeUnixArg(convertToWslPath(a), true));
  }
  const lsPrefix = lsFlags.length > 0 ? `ls ${lsFlags.join(' ')}` : 'ls';
  if (lsOperands.length === 0) return lsPrefix;
  return `shopt -s nullglob; files=(${lsOperands.join(' ')}); if [ \${#files[@]} -gt 0 ]; then ${lsPrefix} "\${files[@]}"; fi`;
}

function wrapUnixGlobThroughShell(
  cmdBase: string,
  args: readonly string[],
  exemptIndices: ReadonlySet<number>,
  payload: ExecPayload,
): { cmd: string; args: string[] } {
  let seenDoubleDash = false;
  const originalArgs = args.map((a, idx) => {
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      return escapeUnixArg(a, false);
    }
    if (exemptIndices.has(idx) || (!seenDoubleDash && a.startsWith('-'))) {
      return escapeUnixArg(a, false);
    }
    return escapeUnixArg(convertToWslPath(a), true);
  }).join(' ');
  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    payload.target = 'wsl2';
  }
  const wrapped = cmdBase === 'ls'
    ? { cmd: 'bash', args: ['-c', buildLsGlobScript(args, exemptIndices)] }
    : { cmd: 'sh', args: ['-c', `${cmdBase} ${originalArgs}`] };
  if (payload.type === 'command') {
    payload.command = wrapped.cmd;
    payload.args = wrapped.args;
  }
  console.error(`\n   💡 AGENT HINT: Detected Unix utility '${cmdBase}' with glob patterns (* or ?).`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Because 'shell: false' is used, globs are not expanded automatically. Routing through 'sh -c' to expand globs...`);
  return wrapped;
}

/**
 * [INTENT]: Rewrite Unix-style `find` / search / file globs on Windows so `shell: false` invocations do not fail literally.
 */
export function handleWindowsUnixCommandWrappers(
  cmd: string,
  args: string[],
  payload: ExecPayload,
  baseCwd?: string,
): { cmd: string; args: string[] } {
  const findAdjusted = rewriteWindowsFindWrapper(cmd, args, payload);
  const resolvedCmd = findAdjusted.cmd;
  let resolvedArgs = findAdjusted.args;

  const cmdBasenameForGlob = path.basename(resolvedCmd).toLowerCase().replace(/\.exe$/, '');
  if (!UNIX_GLOB_UTILS.has(cmdBasenameForGlob)) return { cmd: resolvedCmd, args: resolvedArgs };

  const patternExprIdx = findPatternExprIndex(cmdBasenameForGlob, resolvedArgs);
  const exemptIndices = collectPatternOrFilterIndices(cmdBasenameForGlob, resolvedArgs, patternExprIdx);
  const globIdxs = collectGlobCandidateIndices(cmdBasenameForGlob, resolvedArgs, exemptIndices);
  if (globIdxs.length === 0) return { cmd: resolvedCmd, args: resolvedArgs };

  const rawPayloadCwd = typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : undefined;
  const isNonHostWslCwd = payload.target === 'wsl2' && rawPayloadCwd !== undefined
    && ((rawPayloadCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd)) || rawPayloadCwd.startsWith('~'));
  const rawCwd = rawPayloadCwd ?? (baseCwd !== undefined && baseCwd.length > 0 ? baseCwd : undefined);
  const normalizedCwd = !isNonHostWslCwd && rawCwd !== undefined
    ? (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawCwd) ? convertToWindowsPath(rawCwd) : rawCwd)
    : undefined;
  const normBaseCwd = baseCwd !== undefined && baseCwd.length > 0
    ? (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(baseCwd) ? convertToWindowsPath(baseCwd) : baseCwd)
    : undefined;
  const globCwd = normalizedCwd !== undefined && normalizedCwd.length > 0
    ? (normBaseCwd !== undefined ? path.resolve(normBaseCwd, normalizedCwd) : path.resolve(normalizedCwd))
    : process.cwd();
  const canExpandInProcess = !isNonHostWslCwd && (cmdBasenameForGlob === 'rg' || cmdBasenameForGlob === 'grep') && fs.existsSync(globCwd);
  if (!canExpandInProcess) {
    return wrapUnixGlobThroughShell(cmdBasenameForGlob, resolvedArgs, exemptIndices, payload);
  }

  // [INTENT]: rg/grep globs expand in-process within Win32 CreateProcessW argv limits; oversized globs degrade to -g filters or shell globs.
  const reserveChars = resolvedCmd.length + 128;
  const preExpansionArgs = [...resolvedArgs];
  const expansion = expandGlobArgsInProcess(resolvedArgs, globIdxs, globCwd, payload.target === 'wsl2', reserveChars);
  resolvedArgs = expansion.args;
  if (expansion.overflowed && (cmdBasenameForGlob !== 'rg' || payload.target === 'wsl2')) {
    return wrapUnixGlobThroughShell(cmdBasenameForGlob, preExpansionArgs, exemptIndices, payload);
  }
  if (expansion.expandedCount > 0) {
    if (payload.type === 'command') payload.args = resolvedArgs;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Expanded glob argument(s) in-process for '${cmdBasenameForGlob}' (${expansion.expandedCount} glob(s), ${expansion.matchCount} match(es)); unmatched globs kept literal... (Frictionless Recovery)`);
  }
  if (cmdBasenameForGlob === 'rg' && payload.target !== 'wsl2') {
    const rewritten = rewriteUnmatchedRgWinGlobs(resolvedArgs, resolvedCmd, expansion.overflowedGlobs);
    if (rewritten.needsShellFallback) {
      return wrapUnixGlobThroughShell(cmdBasenameForGlob, preExpansionArgs, exemptIndices, payload);
    }
    if (rewritten.rewrittenCount > 0 || rewritten.droppedCount > 0) {
      resolvedArgs = rewritten.args;
      if (payload.type === 'command') payload.args = resolvedArgs;
      if (rewritten.rewrittenCount > 0) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Converted ${rewritten.rewrittenCount} unmatched Win32 rg target glob(s) to '-g' filter(s) to prevent OS error 123... (Frictionless Recovery)`);
      }
      if (rewritten.droppedCount > 0) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Dropped ${rewritten.droppedCount} unmatched Win32 rg target glob(s) matching 0 files so search proceeds cleanly across remaining targets... (Frictionless Recovery)`);
      }
    }
  }
  return { cmd: resolvedCmd, args: resolvedArgs };
}

/**
 * [INTENT]: Expand shell-style globs with fs.globSync relative to cwd while excluding build/vendor dirs unless explicitly targeted
 * and enforcing Win32 CreateProcessW serialized argv length budgets so massive expansions never trigger ENAMETOOLONG.
 */
export function expandGlobArgsInProcess(
  args: string[],
  globIdxs: number[],
  cwd: string,
  toWsl = false,
  reserveChars = 128,
): { args: string[]; expandedCount: number; matchCount: number; overflowed?: boolean; overflowedGlobs?: Set<string> } {
  const idxSet = new Set(globIdxs);
  const out: string[] = [];
  let expandedCount = 0;
  let matchCount = 0;
  let overflowed = false;
  const overflowedGlobs = new Set<string>();
  let runningChars = estimateCommandChars('', args.filter((_, idx) => !idxSet.has(idx))) + reserveChars;
  args.forEach((arg, idx) => {
    if (!idxSet.has(idx)) {
      out.push(arg);
      return;
    }
    const isWslMount = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(arg);
    const pattern = (isWslMount ? convertToWindowsPath(arg) : arg).replace(/\\/g, '/');
    let matches: string[];
    try {
      matches = fs.globSync(pattern, {
        cwd,
        exclude: (entryPath: string) => shouldExcludeGlobEntry(entryPath, pattern),
      }).map(m => m.replace(/\\/g, '/')).sort();
    } catch (err: unknown) {
      const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        console.error(`⚠️ Glob expansion warning (${pattern}): ${err instanceof Error ? err.message : String(err)}`);
      }
      matches = [];
    }
    if (matches.length === 0) {
      out.push(arg);
      runningChars += arg.length + 3;
      return;
    }
    const mapped = toWsl ? matches.map(m => convertToWslPath(m)) : matches;
    const addedChars = mapped.reduce((sum, m) => sum + m.length + 3, 0);
    if (runningChars + addedChars > MAX_WIN32_ARGV_CHARS) {
      overflowed = true;
      overflowedGlobs.add(arg);
      out.push(arg);
      runningChars += arg.length + 3;
      return;
    }
    runningChars += addedChars;
    expandedCount++;
    matchCount += matches.length;
    out.push(...mapped);
  });
  return {
    args: out,
    expandedCount,
    matchCount,
    ...(overflowed ? { overflowed: true, overflowedGlobs } : {}),
  };
}
