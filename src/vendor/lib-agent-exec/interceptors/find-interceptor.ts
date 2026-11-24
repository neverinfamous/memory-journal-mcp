// @ts-nocheck
import { convertToWslPath } from '../command-utils.js';
import { GREP_EXCLUDE_DIRS } from './grep-exclusions.js';
import { ExecutionContext } from './types.js';

const FIND_NAME_FLAGS = ['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-lname', '-ilname'];
const FIND_ACTIONS = [
  '-print', '-print0', '-printf', '-quit', '-exec', '-execdir', '-ok', '-okdir',
  '-delete', '-ls', '-fls', '-fprint', '-fprint0', '-fprintf',
];

const WIN_FIND_SWITCH_RE = /^\/(?:[sSbBwWpPqQcC4ivn?]|[aA](?::[dhrsalio-]+|[dhrsalio]{1,3})?|[oO](?::[nesdg-]+|[nesdg]{1,3})?)$/;

function findFindTargetPath(args: string[], filterIdx: number): string {
  for (let i = 0; i < args.length; i++) {
    if (i === filterIdx || i === filterIdx + 1) continue;
    const arg = args[i];
    if (arg !== undefined && !arg.startsWith('-') && !(arg.startsWith('/') && !arg.startsWith('/mnt/') && WIN_FIND_SWITCH_RE.test(arg))) {
      return convertToWslPath(arg);
    }
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
  syncFindPayloadArgs(ctx);
  return !hasRecurse;
}

function syncFindPayloadArgs(ctx: ExecutionContext): void {
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function healFindTypeValues(ctx: ExecutionContext): void {
  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined || ['-exec', '-execdir', '-ok', '-okdir', '--'].includes(arg)) break;
    if (arg !== '-type' || i + 1 >= ctx.args.length) continue;
    const typeVal = ctx.args[i + 1];
    if (typeVal === 'file') {
      ctx.args[i + 1] = 'f';
      syncFindPayloadArgs(ctx);
      continue;
    }
    if (typeVal === 'dir' || typeVal === 'directory') {
      ctx.args[i + 1] = 'd';
      syncFindPayloadArgs(ctx);
      continue;
    }
    if (typeVal !== undefined && !/^[bcdpflsD](?:,[bcdpflsD])*$/.test(typeVal)) {
      ctx.args[i] = '-name';
      syncFindPayloadArgs(ctx);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'find -type ${typeVal}' is invalid. Rewriting to '-name ${typeVal}'... (Frictionless Recovery)\x1b[0m`);
    }
  }
}

function healFindExecEmptyArgs(ctx: ExecutionContext): void {
  const execIdx = ctx.args.findIndex((arg) => arg === '-exec' || arg === '-execdir');
  if (execIdx === -1) return;
  for (let i = execIdx + 1; i < ctx.args.length; i++) {
    if (ctx.args[i] === '' || ctx.args[i] === '""' || ctx.args[i] === "''") {
      ctx.args[i] = '{}';
      syncFindPayloadArgs(ctx);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected empty argument in 'find -exec' (PowerShell {} scriptblock conversion). Rewriting to '{}'... (Frictionless Recovery)\x1b[0m`);
    }
  }
}

function healFindMissingNameFlag(ctx: ExecutionContext): void {
  const execIdx = ctx.args.findIndex((arg) => ['-exec', '-execdir', '-ok', '-okdir'].includes(arg));
  const scanLimit = execIdx === -1 ? ctx.args.length : execIdx;
  for (let idx = 1; idx < scanLimit; idx++) {
    const arg = ctx.args[idx];
    if (arg === undefined || arg.startsWith('-') || arg === '(' || arg === '!' || arg === '\\(') continue;
    const prev = ctx.args[idx - 1];
    if (prev === '-D' || (prev !== undefined && (FIND_NAME_FLAGS.includes(prev) || ['-printf', '-fprintf', '-fprint', '-fprint0', '-fls'].includes(prev)))) continue;
    if (arg.includes('/') || arg.includes('\\') || (!arg.includes('*') && !arg.includes('?'))) continue;
    ctx.args.splice(idx, 1, '-name', arg);
    syncFindPayloadArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected wildcard pattern '${arg}' without -name flag. Auto-injecting '-name' flag... (Frictionless Recovery)\x1b[0m`);
    break;
  }
}

function stripFindTrailingWildcard(targetPath: string, banners: string[]): string {
  if (!targetPath.endsWith('/*') && !targetPath.endsWith('\\*')) return targetPath;
  banners.push(`\n   🛠️ AUTONOMOUS HEALING: Stripping trailing wildcard from find root path '${targetPath}' to prevent literal glob failure... (Frictionless Recovery)\x1b[0m`);
  return targetPath.slice(0, -2) || '.';
}

interface FindTargetSplit {
  prePathOpts: string[];
  targetPaths: string[];
  restOfArgs: string[];
  effectivePaths: string[];
  banners: string[];
}

function isFindPrePathOpt(arg: string): boolean {
  return arg === '-H' || arg === '-L' || arg === '-P' || /^-O[0-3]?$/.test(arg);
}

function splitFindTargets(args: string[]): FindTargetSplit {
  const prePathOpts: string[] = [];
  const targetPaths: string[] = [];
  let firstFlagIdx = -1;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) { i++; continue; }
    if (isFindPrePathOpt(arg)) { prePathOpts.push(arg); i++; continue; }
    if (arg === '-D' && i + 1 < args.length) {
      const opt = args[i + 1];
      prePathOpts.push(arg);
      if (opt !== undefined) prePathOpts.push(opt);
      i += 2;
      continue;
    }
    break;
  }
  for (; i < args.length; i++) {
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
  const banners: string[] = [];
  const effectivePaths = sourcePaths.map((p) => stripFindTrailingWildcard(p, banners));
  return { prePathOpts, targetPaths, restOfArgs, effectivePaths, banners };
}

function pathTargetsDir(targetPath: string, dirLower: string): boolean {
  const cleaned = targetPath.trim().replace(/^(['"])(.*)\1$/, '$2');
  const segments = cleaned.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  return segments.includes(dirLower);
}

const FIND_PATH_PREDICATES = new Set(['-path', '-ipath', '-wholename', '-iwholename', '-name', '-iname']);

function dirIsExplicitlyTargeted(args: string[], effectivePaths: string[], dir: string): boolean {
  const dirLower = dir.toLowerCase();
  if (effectivePaths.some((targetPath) => pathTargetsDir(targetPath, dirLower))) return true;
  for (let i = 0; i < args.length - 1; i++) {
    const a = args[i]?.toLowerCase();
    const val = args[i + 1];
    if (a !== undefined && FIND_PATH_PREDICATES.has(a) && val !== undefined && pathTargetsDir(val, dirLower)) {
      return true;
    }
  }
  return false;
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
  prePathOpts: string[],
  effectivePaths: string[],
  restOfArgs: string[],
  dirsToPrune: string[],
): void {
  if (!isBroadFindSearch(effectivePaths) || dirsToPrune.length === 0) return;
  const hasAction = restOfArgs.some((arg) => FIND_ACTIONS.includes(arg));
  const groupedOr = restOfArgs.length > 0 && hasTopLevelOr(restOfArgs) ? ['(', ...restOfArgs, ')'] : restOfArgs;
  const finalRest = hasAction ? groupedOr : (groupedOr.length === 0 ? ['-print'] : [...groupedOr, '-print']);
  ctx.args = [...prePathOpts, ...effectivePaths, ...buildFindPruneClause(dirsToPrune), ...finalRest];
  syncFindPayloadArgs(ctx);
  if (ctx.payload.timeoutMs === undefined || (ctx.payload.timeoutMs > 0 && ctx.payload.timeoutMs <= 30000)) {
    ctx.payload.timeoutMs = 60000;
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive find on mounted filesystem detected. Auto-injecting directory pruning for node_modules, .git, and cache dirs to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
}

function injectFindDirectoryPruning(ctx: ExecutionContext): void {
  if (
    ctx.args.includes('--help') ||
    ctx.args.includes('--version') ||
    ctx.args.includes('-prune') ||
    ctx.args.includes('-maxdepth') ||
    ctx.args.includes('-depth') ||
    ctx.args.includes('-delete')
  ) {
    return;
  }
  const split = splitFindTargets(ctx.args);
  if (split.targetPaths.length > 0) {
    ctx.args = [...split.prePathOpts, ...split.effectivePaths, ...split.restOfArgs];
    syncFindPayloadArgs(ctx);
  }
  for (const banner of split.banners) console.error(banner);
  const dirsToPrune = GREP_EXCLUDE_DIRS.filter((dir) => !dirIsExplicitlyTargeted(ctx.args, split.effectivePaths, dir));
  applyBroadFindPrune(ctx, split.prePathOpts, split.effectivePaths, split.restOfArgs, dirsToPrune);
}

export function handleFindInterception(ctx: ExecutionContext): void {
  if (rewritePowerShellFindFilter(ctx)) return;
  healFindTypeValues(ctx);
  healFindExecEmptyArgs(ctx);
  healFindMissingNameFlag(ctx);
  injectFindDirectoryPruning(ctx);
}
