// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWslPath, findPatternExprIndex, FLAGS_WITH_ARG_BY_TOOL, getPositionalArgs } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { injectRecursiveGrepExclusions } from './grep-exclusions.js';
import { unbundleSearchCommandArgs } from './search-flag-unpack.js';
import {
  existsOnDisk,
  hasBackslashRegexEscape,
  hasUnambiguousRegexMeta,
  hasUnmistakableStructuredPathPrefix,
  hasUriOrNonDriveColon,
  isGlobPathArg,
  isLikelyDirectoryArg,
  isSecondExistingTargetOnly,
} from './search-path-utils.js';
import { ExecutionContext } from './types.js';

function routeGrepToWsl(ctx: ExecutionContext, hasStdin: boolean): void {
  if (hasStdin) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
    return;
  }
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${ctx.cmdBasename}' search command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }
}

function collectGrepPositionalIndices(cmdBasename: string, args: readonly string[]): number[] {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = new Set(FLAGS_WITH_ARG_BY_TOOL[base] ?? FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
  const indices: number[] = [];
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!seenDoubleDash && arg === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && valueFlags.has(arg)) { i++; continue; }
    if (!seenDoubleDash && arg.startsWith('-')) continue;
    indices.push(i);
  }
  return indices;
}

function hasGrepHelpOrVersion(args: readonly string[], cmdBasename: string): boolean {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = new Set(FLAGS_WITH_ARG_BY_TOOL[base] ?? FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--help' || arg === '-V' || arg === '--version') return true;
    if (valueFlags.has(arg)) i++;
  }
  return false;
}

function hasGrepPatternFlag(args: readonly string[], cmdBasename: string): boolean {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = new Set(FLAGS_WITH_ARG_BY_TOOL[base] ?? FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (
      arg === '-e' || (arg.startsWith('-e') && !arg.startsWith('--')) ||
      arg === '--regexp' || arg.startsWith('--regexp=') ||
      arg === '-f' || (arg.startsWith('-f') && !arg.startsWith('--')) ||
      arg === '--file' || arg.startsWith('--file=')
    ) {
      return true;
    }
    if (valueFlags.has(arg)) i++;
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

function existsAsDirectory(arg: string, cwd?: string): boolean {
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const resolved = path.resolve(baseDir, arg);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function isGrepPathLike(arg: string, cwd?: string): boolean {
  if (isGlobPathArg(arg)) return true;
  if (existsOnDisk(arg, cwd)) return true;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (hasUnmistakableStructuredPathPrefix(arg) && !hasUnambiguousRegexMeta(arg.replace(/[+[\]]/g, ''))) return true;
  if (hasUnambiguousRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) return false;
  return arg === '.' || arg === '..'
    || arg.includes('/')
    || arg.includes('\\')
    || /^[a-zA-Z]:/.test(arg)
    || /\.[a-zA-Z0-9_-]+$/.test(arg)
    || existsAsDirectory(arg, cwd);
}

function recombineGrepMultiwordPattern(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
): string[] {
  if (hasStdin || hasPatternFlag || positionalArgs.length <= 2) return positionalArgs;
  const lastArg = positionalArgs[positionalArgs.length - 1];
  const intermediateArgs = positionalArgs.slice(1, -1);
  const cwd = ctx.payload.cwd ?? ctx.cwd;
  if (lastArg === undefined || !isGrepPathLike(lastArg, cwd)) return positionalArgs;
  if (intermediateArgs.some((arg) => isGrepPathLike(arg, cwd))) return positionalArgs;
  const patternParts = positionalArgs.slice(0, -1);
  const combinedPattern = patternParts.join(' ');
  replacePositionalSlice(ctx, patternParts.length, combinedPattern);
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in '${ctx.cmdBasename}'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
  return getPositionalArgs(ctx.cmdBasename, ctx.args);
}

function swapGrepReversedArgs(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
): string[] {
  if (hasStdin || hasPatternFlag || positionalArgs.length !== 2) return positionalArgs;
  const first = positionalArgs[0];
  const second = positionalArgs[1];
  if (first === undefined || second === undefined) return positionalArgs;
  const cwd = ctx.payload.cwd ?? ctx.cwd;
  if (!isLikelyDirectoryArg(first, cwd) || isLikelyDirectoryArg(second, cwd)) return positionalArgs;
  if (isSecondExistingTargetOnly(first, second, cwd)) return positionalArgs;
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

function detectGrepRecursive(args: readonly string[], cmdBasename: string): boolean {
  const base = path.basename(cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const valueFlags = new Set(FLAGS_WITH_ARG_BY_TOOL[base] ?? FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '-r' || arg === '-R' || arg === '--recursive') return true;
    if (valueFlags.has(arg)) { i++; continue; }
    if (arg.startsWith('-') && !arg.startsWith('--') && !arg.startsWith('-e') && !arg.startsWith('-f') && (arg.includes('r') || arg.includes('R'))) {
      return true;
    }
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
): boolean {
  const isRecursive = detectGrepRecursive(ctx.args, ctx.cmdBasename);
  if (hasStdin) return isRecursive;
  const targetFileArgs = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  if (targetFileArgs.length === 0) return injectGrepMissingTarget(ctx, isRecursive, targetFileArgs.includes('.'));
  const cwd = ctx.payload.cwd ?? ctx.cwd;
  if (isRecursive || !targetFileArgs.some((arg) => isLikelyDirectoryArg(arg, cwd))) return isRecursive;
  ctx.args.unshift('-r');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   💡 AGENT HINT: '${grepCommandName(ctx)}' called with a directory target without recursive flag.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function convertGrepPathsForWsl(ctx: ExecutionContext): void {
  if (ctx.payload.target !== 'wsl2') return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  const exempt = new Set<number>();
  if (patternIdx !== -1) exempt.add(patternIdx);
  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined || arg === '--') break;
    if ((arg === '-e' || arg === '--regexp') && i + 1 < ctx.args.length) {
      exempt.add(i + 1);
      i++;
    } else if ((arg.startsWith('-e') && arg.length > 2 && !arg.startsWith('--')) || arg.startsWith('--regexp=')) {
      exempt.add(i);
    }
  }
  ctx.args = ctx.args.map((arg, idx) => exempt.has(idx) ? arg : convertToWslPath(arg));
}

function applyRecursiveGrepGuards(ctx: ExecutionContext, isRecursive: boolean, targetPaths: readonly string[]): void {
  if (!isRecursive) return;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = ctx.args; };
  injectRecursiveGrepExclusions(ctx.args, targetPaths, syncArgs);
  if (!ctx.args.includes('-s') && !ctx.args.includes('--no-messages')) ctx.args.unshift('-s');
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
  let positionalArgs = getPositionalArgs(ctx.cmdBasename, ctx.args);
  positionalArgs = recombineGrepStdinPattern(ctx, hasStdin, hasPatternFlag, positionalArgs);
  positionalArgs = recombineGrepMultiwordPattern(ctx, hasStdin, hasPatternFlag, positionalArgs);
  positionalArgs = swapGrepReversedArgs(ctx, hasStdin, hasPatternFlag, positionalArgs);
  blockEmptyGrep(ctx, hasStdin, hasPatternFlag, positionalArgs);
  const isRecursive = ensureGrepRecursiveSearch(ctx, hasStdin, hasPatternFlag, positionalArgs);
  convertGrepPathsForWsl(ctx);
  const targetPaths = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  applyRecursiveGrepGuards(ctx, !hasStdin && isRecursive, targetPaths);
}
