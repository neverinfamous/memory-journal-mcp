// @ts-nocheck
import { convertToWslPath } from '../command-utils.js';
import { GREP_EXCLUDE_DIRS } from './grep-exclusions.js';
import { ExecutionContext } from './types.js';

const FIND_NAME_FLAGS = ['-name', '-iname', '-path', '-ipath', '-wholename'];
const FIND_ACTIONS = [
  '-print', '-print0', '-exec', '-execdir', '-ok', '-okdir',
  '-delete', '-ls', '-fls', '-fprint', '-fprint0', '-fprintf',
];

function findFindTargetPath(args: string[], filterIdx: number): string {
  for (let i = 0; i < args.length; i++) {
    if (i === filterIdx || i === filterIdx + 1) continue;
    const arg = args[i];
    if (arg !== undefined && !arg.startsWith('-') && !arg.startsWith('/')) return convertToWslPath(arg);
  }
  return '.';
}

function rewritePowerShellFindFilter(ctx: ExecutionContext): boolean {
  const filterIdx = ctx.args.findIndex((arg) => ['-filter', '-include'].includes(arg.toLowerCase()));
  if (filterIdx === -1 || filterIdx + 1 >= ctx.args.length) return false;
  const pattern = ctx.args[filterIdx + 1];
  if (pattern === undefined) return false;
  const hasRecurse = ctx.args.some((arg) => ['-recurse', '-r', '-R', '/s'].includes(arg.toLowerCase()));
  const newArgs = [findFindTargetPath(ctx.args, filterIdx)];
  if (!hasRecurse) newArgs.push('-maxdepth', '1');
  newArgs.push('-name', pattern);
  ctx.args = newArgs;
  return !hasRecurse;
}

function healFindTypeValues(ctx: ExecutionContext): void {
  for (let i = 0; i < ctx.args.length; i++) {
    if (ctx.args[i] !== '-type' || i + 1 >= ctx.args.length) continue;
    const typeVal = ctx.args[i + 1];
    if (typeVal === 'file') {
      ctx.args[i + 1] = 'f';
      continue;
    }
    if (typeVal === 'dir' || typeVal === 'directory') {
      ctx.args[i + 1] = 'd';
      continue;
    }
    if (typeVal !== undefined && !/^[bcdpflsD]$/.test(typeVal)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'find -type ${typeVal}' is invalid. Rewriting to '-name ${typeVal}'... (Frictionless Recovery)\x1b[0m`);
      ctx.args[i] = '-name';
    }
  }
}

function healFindExecEmptyArgs(ctx: ExecutionContext): void {
  const execIdx = ctx.args.findIndex((arg) => arg === '-exec' || arg === '-execdir');
  if (execIdx === -1) return;
  for (let i = execIdx + 1; i < ctx.args.length; i++) {
    if (ctx.args[i] === '' || ctx.args[i] === '""' || ctx.args[i] === "''") {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected empty argument in 'find -exec' (PowerShell {} scriptblock conversion). Rewriting to '{}'... (Frictionless Recovery)\x1b[0m`);
      ctx.args[i] = '{}';
    }
  }
}

function healFindMissingNameFlag(ctx: ExecutionContext): void {
  const patternIndex = ctx.args.findIndex((arg, idx) => {
    if (idx === 0 || arg.startsWith('-') || arg === '(' || arg === '!' || arg === '\\(') return false;
    return arg.includes('*') || arg.includes('?');
  });
  if (patternIndex === -1) return;
  const prev = ctx.args[patternIndex - 1];
  if (prev !== undefined && FIND_NAME_FLAGS.includes(prev)) return;
  const pattern = ctx.args[patternIndex];
  if (pattern === undefined) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected wildcard pattern '${pattern}' without -name flag. Auto-injecting '-name' flag... (Frictionless Recovery)\x1b[0m`);
  ctx.args.splice(patternIndex, 1, '-name', pattern);
}

function stripFindTrailingWildcard(targetPath: string): string {
  if (!targetPath.endsWith('/*') && !targetPath.endsWith('\\*')) return targetPath;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping trailing wildcard from find root path '${targetPath}' to prevent literal glob failure... (Frictionless Recovery)\x1b[0m`);
  return targetPath.slice(0, -2) || '.';
}

interface FindTargetSplit {
  targetPaths: string[];
  restOfArgs: string[];
  effectivePaths: string[];
}

function splitFindTargets(args: string[]): FindTargetSplit {
  const targetPaths: string[] = [];
  let firstFlagIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('-') || arg === '(' || arg === '!' || arg === '\\(') {
      firstFlagIdx = i;
      break;
    }
    targetPaths.push(arg);
  }
  const restOfArgs = firstFlagIdx === -1 ? [] : args.slice(firstFlagIdx);
  const sourcePaths = targetPaths.length > 0 ? targetPaths : ['.'];
  return { targetPaths, restOfArgs, effectivePaths: sourcePaths.map(stripFindTrailingWildcard) };
}

function pathTargetsDir(targetPath: string, dirLower: string): boolean {
  const segments = targetPath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  return segments.includes(dirLower);
}

function dirIsExplicitlyTargeted(args: string[], effectivePaths: string[], dir: string): boolean {
  const dirLower = dir.toLowerCase();
  if (args.some((arg) => arg.toLowerCase().includes(dirLower))) return true;
  return effectivePaths.some((targetPath) => pathTargetsDir(targetPath, dirLower));
}

function isBroadFindSearch(effectivePaths: string[]): boolean {
  return effectivePaths.some((targetPath) => {
    const norm = targetPath.replace(/\\/g, '/').trim();
    if (norm === '.' || norm === '..' || norm === '' || norm === './' || norm === '../') return true;
    return /^[a-zA-Z]:[\\/]/.test(targetPath) || norm.startsWith('/mnt/') || norm.startsWith('/') || norm.startsWith('~');
  });
}

function buildFindPruneClause(dirsToPrune: string[]): string[] {
  const pruneConditions: string[] = [];
  for (let i = 0; i < dirsToPrune.length; i++) {
    if (i > 0) pruneConditions.push('-o');
    const dir = dirsToPrune[i];
    if (dir !== undefined) pruneConditions.push('-name', dir);
  }
  return ['(', ...pruneConditions, ')', '-prune', '-o'];
}

function hasTopLevelOr(args: readonly string[]): boolean {
  let depth = 0;
  for (const a of args) {
    if (a === '(' || a === '\\(') depth++;
    else if (a === ')' || a === '\\)') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (a === '-o' || a === '-or')) return true;
  }
  return false;
}

function applyBroadFindPrune(
  ctx: ExecutionContext,
  effectivePaths: string[],
  restOfArgs: string[],
  dirsToPrune: string[],
): void {
  if (!isBroadFindSearch(effectivePaths) || dirsToPrune.length === 0) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive find on mounted filesystem detected. Auto-injecting directory pruning for node_modules, .git, and cache dirs to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
  const hasAction = restOfArgs.some((arg) => FIND_ACTIONS.includes(arg));
  const groupedOr = restOfArgs.length > 0 && hasTopLevelOr(restOfArgs) ? ['(', ...restOfArgs, ')'] : restOfArgs;
  const finalRest = hasAction ? groupedOr : (groupedOr.length === 0 ? ['-print'] : [...groupedOr, '-print']);
  ctx.args = [...effectivePaths, ...buildFindPruneClause(dirsToPrune), ...finalRest];
  if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs <= 30000) ctx.payload.timeoutMs = 60000;
}

function injectFindDirectoryPruning(ctx: ExecutionContext): void {
  if (ctx.args.includes('-prune') || ctx.args.includes('-maxdepth')) return;
  const split = splitFindTargets(ctx.args);
  if (split.targetPaths.length > 0) ctx.args = [...split.effectivePaths, ...split.restOfArgs];
  const dirsToPrune = GREP_EXCLUDE_DIRS.filter((dir) => !dirIsExplicitlyTargeted(ctx.args, split.effectivePaths, dir));
  applyBroadFindPrune(ctx, split.effectivePaths, split.restOfArgs, dirsToPrune);
}

export function handleFindInterception(ctx: ExecutionContext): void {
  if (rewritePowerShellFindFilter(ctx)) return;
  healFindTypeValues(ctx);
  healFindExecEmptyArgs(ctx);
  healFindMissingNameFlag(ctx);
  injectFindDirectoryPruning(ctx);
}
