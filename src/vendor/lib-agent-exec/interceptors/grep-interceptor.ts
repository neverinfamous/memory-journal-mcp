// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath, convertToWslPath, extractLeadingShortFlags, findPatternExprIndex, FLAGS_WITH_ARG_BY_TOOL, inspectCombinedShortFlag } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { injectRecursiveGrepExclusions } from './grep-exclusions.js';
import { unbundleSearchCommandArgs } from './search-flag-unpack.js';
import {
  hasBackslashRegexEscape,
  hasUnambiguousRegexMeta,
  hasUnmistakableStructuredPathPrefix,
  hasUriOrNonDriveColon,
  isGlobPathArg,
  isLikelyDirectoryArg,
  isSecondExistingTargetOnly,
  statPathKindOnDisk,
} from './search-path-utils.js';
import { type ExecutionContext } from './types.js';

function routeGrepToWsl(ctx: ExecutionContext, hasStdin: boolean): void {
  if (process.platform !== 'win32' || ctx.payload.target === 'wsl2') return;
  ctx.payload.target = 'wsl2';
  const msg = hasStdin
    ? `\n   💡 AGENT INTERCEPT: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)`
    : `\n   💡 AGENT INTERCEPT: '${ctx.cmdBasename}' search command detected. Switching execution target to WSL2... (Frictionless Recovery)`;
  emitInterceptBanner(msg);
}

const DEFAULT_GREP_VALUE_FLAGS: ReadonlySet<string> = new Set(FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
const GREP_VALUE_FLAG_MAP = new Map<string, ReadonlySet<string>>([
  ['grep', DEFAULT_GREP_VALUE_FLAGS],
  ['egrep', new Set(FLAGS_WITH_ARG_BY_TOOL['egrep'] ?? DEFAULT_GREP_VALUE_FLAGS)],
  ['fgrep', new Set(FLAGS_WITH_ARG_BY_TOOL['fgrep'] ?? DEFAULT_GREP_VALUE_FLAGS)],
]);

function getGrepValueFlags(cmdBasename: string): { base: string; valueFlags: ReadonlySet<string> } {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = GREP_VALUE_FLAG_MAP.get(base) ?? DEFAULT_GREP_VALUE_FLAGS;
  return { base, valueFlags };
}

function collectGrepPositionalIndices(cmdBasename: string, args: readonly string[]): number[] {
  const { base, valueFlags } = getGrepValueFlags(cmdBasename);
  const indices: number[] = [];
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!seenDoubleDash && arg === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && arg.startsWith('-')) {
      const shortPrefix = !arg.startsWith('--') ? extractLeadingShortFlags(base, arg) : '';
      const lastShort = shortPrefix.length > 1 ? `-${shortPrefix[shortPrefix.length - 1]}` : '';
      const isSeparateValue = valueFlags.has(arg) || (arg.length === shortPrefix.length && lastShort !== '' && valueFlags.has(lastShort));
      if (isSeparateValue) i++;
      continue;
    }
    indices.push(i);
  }
  return indices;
}

function hasGrepHelpOrVersion(args: readonly string[], cmdBasename: string): boolean {
  const { base, valueFlags } = getGrepValueFlags(cmdBasename);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--help' || arg === '-V' || arg === '--version') return true;
    const shortPrefix = arg.startsWith('-') && !arg.startsWith('--') ? extractLeadingShortFlags(base, arg) : '';
    const lastShort = shortPrefix.length > 1 ? `-${shortPrefix[shortPrefix.length - 1]}` : '';
    if (valueFlags.has(arg) || (arg.length === shortPrefix.length && lastShort !== '' && valueFlags.has(lastShort))) i++;
  }
  return false;
}

function resolveGrepHostCwd(ctx: ExecutionContext): string | undefined {
  const raw = ctx.payload.cwd;
  if (raw !== undefined && raw.length > 0) {
    if (process.platform === 'win32') {
      if ((raw.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) || raw.startsWith('~')) {
        return ctx.cwd;
      }
      if (/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) return convertToWindowsPath(raw);
    }
    return raw;
  }
  return ctx.cwd;
}

function hasGrepPatternFlag(args: readonly string[], cmdBasename: string): boolean {
  const { base, valueFlags } = getGrepValueFlags(cmdBasename);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    const shortInfo = inspectCombinedShortFlag(base, arg, valueFlags);
    const shortPrefix = shortInfo.shortPrefix;
    if (
      arg === '-e' || (arg.startsWith('-e') && !arg.startsWith('--')) ||
      arg === '--regexp' || arg.startsWith('--regexp=') ||
      arg === '-f' || (arg.startsWith('-f') && !arg.startsWith('--')) ||
      arg === '--file' || arg.startsWith('--file=') ||
      (shortPrefix.length > 1 && (shortPrefix.endsWith('e') || shortPrefix.endsWith('f')))
    ) {
      return true;
    }
    if (shortInfo.takesSeparateValue) i++;
  }
  return false;
}

function replacePositionalSlice(ctx: ExecutionContext, replaceCount: number, combinedPattern: string): void {
  const posIndices = collectGrepPositionalIndices(ctx.cmdBasename, ctx.args).slice(0, replaceCount);
  const firstIdx = posIndices[0];
  if (firstIdx === undefined) return;
  const removeSet = new Set(posIndices.slice(1));
  ctx.args = ctx.args
    .map((arg, idx) => (idx === firstIdx ? combinedPattern : arg))
    .filter((_arg, idx) => !removeSet.has(idx));
}

function recombineGrepStdinPattern(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
): string[] {
  if (!hasStdin || hasPatternFlag || positionalArgs.length <= 1) return positionalArgs;
  const combinedPattern = positionalArgs.join(' ');
  replacePositionalSlice(ctx, positionalArgs.length, combinedPattern);
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Grep with stdin detected multiple positional arguments. Recombining into single pattern to prevent file target misinterpretation... (Frictionless Recovery)`);
  return [combinedPattern];
}

function isGrepPathLike(arg: string, cwd?: string, kindCache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (isGlobPathArg(arg, cwd, kindCache)) return true;
  const kind = statPathKindOnDisk(arg, cwd, kindCache);
  if (kind !== 'none') return true;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (hasUnmistakableStructuredPathPrefix(arg) && !hasUnambiguousRegexMeta(arg.replace(/[+[\]]/g, ''))) return true;
  if (hasUnambiguousRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg, cwd, kindCache)) return false;
  return arg === '.' || arg === '..'
    || arg.includes('/')
    || arg.includes('\\')
    || /^[a-zA-Z]:/.test(arg)
    || /\.[a-zA-Z0-9_-]+$/.test(arg);
}

function recombineGrepMultiwordPattern(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
  kindCache: Map<string, 'dir' | 'file' | 'none'>,
): string[] {
  if (hasStdin || hasPatternFlag || positionalArgs.length <= 2) return positionalArgs;
  const lastArg = positionalArgs[positionalArgs.length - 1];
  const intermediateArgs = positionalArgs.slice(1, -1);
  const cwd = resolveGrepHostCwd(ctx);
  if (lastArg === undefined || !isGrepPathLike(lastArg, cwd, kindCache)) return positionalArgs;
  if (intermediateArgs.some((arg) => isGrepPathLike(arg, cwd, kindCache))) return positionalArgs;
  const patternParts = positionalArgs.slice(0, -1);
  const combinedPattern = patternParts.join(' ');
  replacePositionalSlice(ctx, patternParts.length, combinedPattern);
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in '${ctx.cmdBasename}'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
  return collectGrepPositionalIndices(ctx.cmdBasename, ctx.args).map(idx => ctx.args[idx] ?? '');
}

function swapGrepReversedArgs(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
  kindCache: Map<string, 'dir' | 'file' | 'none'>,
): string[] {
  if (hasStdin || hasPatternFlag || positionalArgs.length !== 2) return positionalArgs;
  const first = positionalArgs[0];
  const second = positionalArgs[1];
  if (first === undefined || second === undefined) return positionalArgs;
  const cwd = resolveGrepHostCwd(ctx);
  if (!isLikelyDirectoryArg(first, cwd, kindCache) || isLikelyDirectoryArg(second, cwd, kindCache)) return positionalArgs;
  if (isSecondExistingTargetOnly(first, second, cwd, kindCache)) return positionalArgs;
  const posIndices = collectGrepPositionalIndices(ctx.cmdBasename, ctx.args);
  const idx0 = posIndices[0];
  const idx1 = posIndices[1];
  if (idx0 === undefined || idx1 === undefined) return positionalArgs;
  const tmp = ctx.args[idx0];
  if (tmp === undefined || ctx.args[idx1] === undefined) return positionalArgs;
  ctx.args[idx0] = ctx.args[idx1];
  ctx.args[idx1] = tmp;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in '${ctx.cmdBasename}' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
  return [second, first];
}

function blockEmptyGrep(ctx: ExecutionContext, hasStdin: boolean, hasPatternFlag: boolean, positionalArgs: string[]): void {
  if (positionalArgs.length !== 0 || hasPatternFlag || hasStdin) return;
  console.error(`\n   💡 AGENT HINT: '${ctx.cmdBasename.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
  process.exit(1);
}

function isGrepShortValueCluster(base: string, arg: string, valueFlags: ReadonlySet<string>): { consumesNext: boolean; isRecursive: boolean } {
  const shortPrefix = !arg.startsWith('--') && arg.startsWith('-') ? extractLeadingShortFlags(base, arg) : '';
  if (shortPrefix.length <= 1) return { consumesNext: false, isRecursive: false };
  const lastShort = `-${shortPrefix[shortPrefix.length - 1]}`;
  return {
    consumesNext: arg.length === shortPrefix.length && valueFlags.has(lastShort),
    isRecursive: shortPrefix.includes('r') || shortPrefix.includes('R'),
  };
}

function detectGrepRecursive(args: readonly string[], cmdBasename: string): boolean {
  const { base, valueFlags } = getGrepValueFlags(cmdBasename);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '-r' || arg === '-R' || arg === '--recursive' || arg === '--dereference-recursive') return true;
    const shortInfo = isGrepShortValueCluster(base, arg, valueFlags);
    if (shortInfo.isRecursive) return true;
    if (valueFlags.has(arg) || shortInfo.consumesNext) i++;
  }
  return false;
}

function grepCommandName(ctx: ExecutionContext): string {
  return ctx.cmdBasename.replace(/\.exe$/, '');
}

function injectGrepMissingTarget(ctx: ExecutionContext, isRecursive: boolean, hasDotTarget: boolean): boolean {
  if (!isRecursive) {
    ctx.args.unshift('-r');
    ctx.args.push('.');
    if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
    console.error(`\n   💡 AGENT HINT: '${grepCommandName(ctx)}' called without file arguments and no recursive flag.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' and '.' to search current directory recursively... (Frictionless Recovery)\x1b[0m`);
    return true;
  }
  if (!hasDotTarget) {
    ctx.args.push('.');
    if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Recursive '${grepCommandName(ctx)}' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
  }
  return isRecursive;
}

function ensureGrepRecursiveSearch(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
  kindCache: Map<string, 'dir' | 'file' | 'none'>,
): boolean {
  const isRecursive = detectGrepRecursive(ctx.args, ctx.cmdBasename);
  if (hasStdin) return isRecursive;
  const targetFileArgs = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  if (targetFileArgs.length === 0) return injectGrepMissingTarget(ctx, isRecursive, targetFileArgs.includes('.'));
  const cwd = resolveGrepHostCwd(ctx);
  if (isRecursive || !targetFileArgs.some((arg) => isLikelyDirectoryArg(arg, cwd, kindCache))) return isRecursive;
  ctx.args.unshift('-r');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   💡 AGENT HINT: '${grepCommandName(ctx)}' called with a directory target without recursive flag.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function convertGrepPathsForWsl(ctx: ExecutionContext): void {
  if (ctx.payload.target !== 'wsl2') return;
  const { base, valueFlags } = getGrepValueFlags(ctx.cmdBasename);
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  const exempt = new Set<number>();
  if (patternIdx !== -1) exempt.add(patternIdx);
  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined || arg === '--') break;
    const shortInfo = inspectCombinedShortFlag(base, arg, valueFlags);
    const isPatternValueFlag = arg === '-e' || arg === '--regexp'
      || (shortInfo.takesSeparateValue && shortInfo.tailChar === 'e');
    const isAttachedShortPattern = shortInfo.hasAttachedValue && shortInfo.tailChar === 'e';
    if (isPatternValueFlag && i + 1 < ctx.args.length) {
      exempt.add(i + 1);
      i++;
    } else if (shortInfo.takesSeparateValue && i + 1 < ctx.args.length) {
      i++;
    } else if (isAttachedShortPattern || (arg.startsWith('-e') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--regexp=')) {
      exempt.add(i);
    }
  }
  ctx.args = ctx.args.map((arg, idx) => exempt.has(idx) ? arg : convertToWslPath(arg));
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function applyRecursiveGrepGuards(ctx: ExecutionContext, isRecursive: boolean, targetPaths: readonly string[]): void {
  if (!isRecursive) return;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = ctx.args; };
  injectRecursiveGrepExclusions(ctx.args, targetPaths, syncArgs);
  if (!ctx.args.includes('-s') && !ctx.args.includes('--no-messages')) {
    ctx.args.unshift('-s');
    syncArgs();
  }
  if (ctx.payload.target === 'wsl2' && (ctx.payload.timeoutMs === undefined || (ctx.payload.timeoutMs > 0 && ctx.payload.timeoutMs <= 30000))) {
    ctx.payload.timeoutMs = 60000;
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted filesystem detected. Auto-extending timeout to 60000ms to prevent premature aborts... (Frictionless Recovery)\x1b[0m`);
  }
}

export function handleGrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  unbundleSearchCommandArgs(ctx);
  routeGrepToWsl(ctx, hasStdin);
  if (hasGrepHelpOrVersion(ctx.args, ctx.cmdBasename)) return;
  const hasPatternFlag = hasGrepPatternFlag(ctx.args, ctx.cmdBasename);
  const kindCache = new Map<string, 'dir' | 'file' | 'none'>();
  let positionalArgs = collectGrepPositionalIndices(ctx.cmdBasename, ctx.args).map(idx => ctx.args[idx] ?? '');
  positionalArgs = recombineGrepStdinPattern(ctx, hasStdin, hasPatternFlag, positionalArgs);
  positionalArgs = recombineGrepMultiwordPattern(ctx, hasStdin, hasPatternFlag, positionalArgs, kindCache);
  positionalArgs = swapGrepReversedArgs(ctx, hasStdin, hasPatternFlag, positionalArgs, kindCache);
  blockEmptyGrep(ctx, hasStdin, hasPatternFlag, positionalArgs);
  const isRecursive = ensureGrepRecursiveSearch(ctx, hasStdin, hasPatternFlag, positionalArgs, kindCache);
  convertGrepPathsForWsl(ctx);
  const targetPaths = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  applyRecursiveGrepGuards(ctx, !hasStdin && isRecursive, targetPaths);
}
