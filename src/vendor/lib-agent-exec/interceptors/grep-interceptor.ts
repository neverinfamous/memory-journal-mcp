// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWslPath, findPatternExprIndex, getPositionalArgs } from '../command-utils.js';
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

function hasGrepHelpOrVersion(args: string[]): boolean {
  return args.some((arg) => arg === '-h' || arg === '--help' || arg === '-V' || arg === '--version');
}

function hasGrepPatternFlag(args: string[]): boolean {
  return args.some((arg) =>
    arg === '-e' || arg.startsWith('-e') || arg === '--regexp' || arg.startsWith('--regexp=') || arg === '-f' || arg.startsWith('--file')
  );
}

function recombineGrepStdinPattern(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
): string[] {
  if (!hasStdin || hasPatternFlag || positionalArgs.length <= 1) return positionalArgs;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Grep with stdin detected multiple positional arguments. Recombining into single pattern to prevent file target misinterpretation... (Frictionless Recovery)`);
  const combinedPattern = positionalArgs.join(' ');
  let replaced = false;
  ctx.args = ctx.args.filter((arg) => {
    if (!positionalArgs.includes(arg)) return true;
    if (!replaced) {
      replaced = true;
      return true;
    }
    return false;
  }).map((arg) => positionalArgs.includes(arg) ? combinedPattern : arg);
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
  const cwd = ctx.payload.cwd;
  if (lastArg === undefined || !isGrepPathLike(lastArg, cwd)) return positionalArgs;
  if (intermediateArgs.some((arg) => isGrepPathLike(arg, cwd))) return positionalArgs;
  const patternParts = positionalArgs.slice(0, -1);
  const combinedPattern = patternParts.join(' ');
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in '${ctx.cmdBasename}'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
  let replaced = false;
  const first = patternParts[0];
  ctx.args = ctx.args.filter((arg) => {
    if (!patternParts.includes(arg)) return true;
    if (!replaced && arg === first) {
      replaced = true;
      return true;
    }
    return false;
  }).map((arg) => arg === first ? combinedPattern : arg);
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
  const cwd = ctx.payload.cwd;
  if (!isLikelyDirectoryArg(first, cwd) || isLikelyDirectoryArg(second, cwd)) return positionalArgs;
  if (isSecondExistingTargetOnly(first, second, cwd)) return positionalArgs;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in '${ctx.cmdBasename}' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
  const idx0 = ctx.args.indexOf(first);
  const idx1 = ctx.args.indexOf(second);
  if (idx0 === -1 || idx1 === -1) return positionalArgs;
  const tmp = ctx.args[idx0];
  ctx.args[idx0] = ctx.args[idx1];
  ctx.args[idx1] = tmp;
  return [second, first];
}

function blockEmptyGrep(ctx: ExecutionContext, hasStdin: boolean, hasPatternFlag: boolean, positionalArgs: string[]): void {
  if (positionalArgs.length !== 0 || hasPatternFlag || hasStdin) return;
  console.error(`\n   💡 AGENT HINT: '${ctx.cmdBasename.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
  process.exit(1);
}

function detectGrepRecursive(args: string[]): boolean {
  return args.some((arg) =>
    arg === '-r' || arg === '-R' || arg === '--recursive'
    || (arg.startsWith('-') && !arg.startsWith('--') && !arg.startsWith('-e') && !arg.startsWith('-f') && (arg.includes('r') || arg.includes('R')))
  );
}

function grepCommandName(ctx: ExecutionContext): string {
  return ctx.cmdBasename.replace(/\.exe$/, '');
}

function injectGrepMissingTarget(ctx: ExecutionContext, isRecursive: boolean): boolean {
  if (!isRecursive) {
    console.error(`\n   💡 AGENT HINT: '${grepCommandName(ctx)}' called without file arguments and no recursive flag.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' and '.' to search current directory recursively... (Frictionless Recovery)\x1b[0m`);
    ctx.args.unshift('-r');
    ctx.args.push('.');
    return true;
  }
  if (!ctx.args.includes('.')) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Recursive '${grepCommandName(ctx)}' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
    ctx.args.push('.');
  }
  return isRecursive;
}

function ensureGrepRecursiveSearch(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  positionalArgs: string[],
): boolean {
  const isRecursive = detectGrepRecursive(ctx.args);
  if (hasStdin) return isRecursive;
  const targetFileArgs = hasPatternFlag ? positionalArgs : positionalArgs.slice(1);
  if (targetFileArgs.length === 0) return injectGrepMissingTarget(ctx, isRecursive);
  if (isRecursive || !targetFileArgs.some((arg) => isLikelyDirectoryArg(arg, ctx.payload.cwd))) return isRecursive;
  console.error(`\n   💡 AGENT HINT: '${grepCommandName(ctx)}' called with a directory target without recursive flag.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
  ctx.args.unshift('-r');
  return true;
}

function convertGrepPathsForWsl(ctx: ExecutionContext): void {
  if (ctx.payload.target !== 'wsl2') return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  ctx.args = ctx.args.map((arg, idx) => idx === patternIdx ? arg : convertToWslPath(arg));
}

function applyRecursiveGrepGuards(ctx: ExecutionContext, isRecursive: boolean): void {
  if (!isRecursive) return;
  injectRecursiveGrepExclusions(ctx.args);
  if (!ctx.args.includes('-s') && !ctx.args.includes('--no-messages')) ctx.args.unshift('-s');
  if (ctx.payload.target === 'wsl2' && (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs <= 30000)) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted filesystem detected. Auto-extending timeout to 60000ms to prevent premature aborts... (Frictionless Recovery)\x1b[0m`);
    ctx.payload.timeoutMs = 60000;
  }
}

export function handleGrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  if (!ctx.args) ctx.args = [];
  unbundleSearchCommandArgs(ctx);
  routeGrepToWsl(ctx, hasStdin);
  if (hasGrepHelpOrVersion(ctx.args)) return;
  const hasPatternFlag = hasGrepPatternFlag(ctx.args);
  let positionalArgs = getPositionalArgs(ctx.cmdBasename, ctx.args);
  positionalArgs = recombineGrepStdinPattern(ctx, hasStdin, hasPatternFlag, positionalArgs);
  positionalArgs = recombineGrepMultiwordPattern(ctx, hasStdin, hasPatternFlag, positionalArgs);
  positionalArgs = swapGrepReversedArgs(ctx, hasStdin, hasPatternFlag, positionalArgs);
  blockEmptyGrep(ctx, hasStdin, hasPatternFlag, positionalArgs);
  const isRecursive = ensureGrepRecursiveSearch(ctx, hasStdin, hasPatternFlag, positionalArgs);
  convertGrepPathsForWsl(ctx);
  applyRecursiveGrepGuards(ctx, isRecursive);
}
