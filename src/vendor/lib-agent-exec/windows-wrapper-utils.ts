// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {
  FLAGS_WITH_ARG_BY_TOOL,
  convertToWindowsPath,
  convertToWslPath,
  escapeUnixArg,
  findPatternExprIndex,
} from './command-utils.js';
import type { ExecPayload } from './schema.js';

const UNIX_GLOB_UTILS = new Set(['grep', 'ls', 'rm', 'cp', 'mv', 'cat', 'rg']);
const GLOB_FILTER_PREV_FLAGS = new Set([
  '-g', '--glob', '--iglob', '--include', '--exclude', '-name', '-iname', '-path', '-wholename', '-filter',
]);

function rewriteUnmatchedRgWinGlobs(args: string[], cmd: string): { args: string[]; rewrittenCount: number } {
  const base = path.basename(cmd).toLowerCase().replace(/\.exe$/, '');
  if (base !== 'rg') return { args, rewrittenCount: 0 };
  const patternIdx = findPatternExprIndex(cmd, args);
  const toolFlags = FLAGS_WITH_ARG_BY_TOOL['rg'] ?? [];
  const nextArgs: string[] = [];
  const unmatchedGlobs: string[] = [];
  let hasTargetPath = false;
  let seenDoubleDash = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') {
      seenDoubleDash = true;
      nextArgs.push(a);
      continue;
    }
    if (!seenDoubleDash && toolFlags.includes(a) && i + 1 < args.length) {
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
      unmatchedGlobs.push(a);
      continue;
    }
    hasTargetPath = true;
    nextArgs.push(a);
  }

  if (unmatchedGlobs.length === 0) return { args, rewrittenCount: 0 };
  const globFlags = unmatchedGlobs.flatMap(g => ['-g', g]);
  const dashDashIdx = nextArgs.indexOf('--');
  if (dashDashIdx !== -1) nextArgs.splice(dashDashIdx, 0, ...globFlags);
  else nextArgs.unshift(...globFlags);
  if (!hasTargetPath) nextArgs.push('.');
  return { args: nextArgs, rewrittenCount: unmatchedGlobs.length };
}

function collectGlobCandidateIndices(args: readonly string[], patternExprIdx: number): number[] {
  const globIdxs: number[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const a = args[idx];
    if (a === undefined || idx === patternExprIdx) continue;
    const prev = idx > 0 ? args[idx - 1] : undefined;
    if (prev !== undefined && GLOB_FILTER_PREV_FLAGS.has(prev)) continue;
    if (a.startsWith('-g=') || a.startsWith('--glob=') || a.startsWith('--include=') || a.startsWith('--exclude=')) continue;
    if ((a.includes('*') || a.includes('?')) && !a.startsWith('-')) globIdxs.push(idx);
  }
  return globIdxs;
}

function rewriteWindowsFindWrapper(cmd: string, args: string[], payload: ExecPayload): { cmd: string; args: string[] } {
  const base = path.basename(cmd).toLowerCase();
  if (base !== 'find' && base !== 'find.exe') return { cmd, args };
  const isUnixFind = args.some(
    a => a.startsWith('-name') || a.startsWith('-type') || a.startsWith('-exec') || a.startsWith('-mtime') || a === '.' || a === '..',
  );
  if (!isUnixFind) return { cmd, args };
  const originalArgs = args.map(a => escapeUnixArg(a, false)).join(' ');
  console.error(`\n   💡 AGENT HINT: Detected Unix-style 'find' command. Forwarding to 'sh -c' to bypass Windows find.exe limits.`);
  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    payload.target = 'wsl2';
  }
  return { cmd: 'sh', args: ['-c', `find ${originalArgs}`] };
}

function wrapUnixGlobThroughShell(
  cmdBase: string,
  args: readonly string[],
  patternExprIdx: number,
  payload: ExecPayload,
): { cmd: string; args: string[] } {
  const originalArgs = args.map((a, idx) =>
    idx === patternExprIdx ? escapeUnixArg(a, false) : escapeUnixArg(convertToWslPath(a), true),
  ).join(' ');
  console.error(`\n   💡 AGENT HINT: Detected Unix utility '${cmdBase}' with glob patterns (* or ?).`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Because 'shell: false' is used, globs are not expanded automatically. Routing through 'sh -c' to expand globs...`);
  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    payload.target = 'wsl2';
  }
  if (cmdBase === 'ls') {
    return {
      cmd: 'bash',
      args: ['-c', `shopt -s nullglob; files=(${originalArgs}); if [ \${#files[@]} -gt 0 ]; then ls "\${files[@]}"; fi`],
    };
  }
  return { cmd: 'sh', args: ['-c', `${cmdBase} ${originalArgs}`] };
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
  const globIdxs = collectGlobCandidateIndices(resolvedArgs, patternExprIdx);
  if (globIdxs.length === 0) return { cmd: resolvedCmd, args: resolvedArgs };

  const rawCwd = baseCwd !== undefined && baseCwd.length > 0 ? baseCwd : payload.cwd;
  const normalizedCwd = rawCwd !== undefined && rawCwd.length > 0
    ? (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(rawCwd) ? convertToWindowsPath(rawCwd) : rawCwd)
    : undefined;
  const globCwd = normalizedCwd !== undefined && normalizedCwd.length > 0 ? path.resolve(normalizedCwd) : process.cwd();
  const canExpandInProcess = (cmdBasenameForGlob === 'rg' || cmdBasenameForGlob === 'grep') && fs.existsSync(globCwd);
  if (!canExpandInProcess) {
    return wrapUnixGlobThroughShell(cmdBasenameForGlob, resolvedArgs, patternExprIdx, payload);
  }

  // [INTENT]: rg/grep globs are expanded in-process (no 'sh -c' + WSL hop). Literals are kept when nothing matches.
  const expansion = expandGlobArgsInProcess(resolvedArgs, globIdxs, globCwd, payload.target === 'wsl2');
  resolvedArgs = expansion.args;
  if (expansion.expandedCount > 0) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Expanded glob argument(s) in-process for '${cmdBasenameForGlob}' (${expansion.expandedCount} glob(s), ${expansion.matchCount} match(es)); unmatched globs kept literal... (Frictionless Recovery)`);
  }
  if (cmdBasenameForGlob === 'rg' && payload.target !== 'wsl2') {
    const rewritten = rewriteUnmatchedRgWinGlobs(resolvedArgs, resolvedCmd);
    if (rewritten.rewrittenCount > 0) {
      resolvedArgs = rewritten.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Converted ${rewritten.rewrittenCount} unmatched Win32 rg target glob(s) to '-g' filter(s) to prevent OS error 123... (Frictionless Recovery)`);
    }
  }
  return { cmd: resolvedCmd, args: resolvedArgs };
}

/**
 * [INTENT]: Expand shell-style globs with fs.globSync relative to cwd. `/mnt/<drive>/` globs are expanded via
 * their Windows mapping and converted back so WSL-targeted commands still receive WSL paths.
 * [INVARIANT]: A glob with zero matches is passed through unchanged (literal), matching bash's default.
 */
export function expandGlobArgsInProcess(
  args: string[],
  globIdxs: number[],
  cwd: string,
  toWsl = false,
): { args: string[]; expandedCount: number; matchCount: number } {
  const idxSet = new Set(globIdxs);
  const out: string[] = [];
  let expandedCount = 0;
  let matchCount = 0;
  args.forEach((arg, idx) => {
    if (!idxSet.has(idx)) {
      out.push(arg);
      return;
    }
    const isWslMount = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg);
    const pattern = (isWslMount ? convertToWindowsPath(arg) : arg).replace(/\\/g, '/');
    let matches: string[];
    try {
      matches = fs.globSync(pattern, { cwd }).map(m => m.replace(/\\/g, '/')).sort();
    } catch {
      matches = [];
    }
    if (matches.length === 0) {
      out.push(arg);
      return;
    }
    expandedCount++;
    matchCount += matches.length;
    out.push(...(isWslMount || toWsl ? matches.map(m => convertToWslPath(m)) : matches));
  });
  return { args: out, expandedCount, matchCount };
}
