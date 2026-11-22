// @ts-nocheck
import { convertToWindowsPath, convertToWslPath, findPatternExprIndex, getPositionalArgs } from '../command-utils.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { normalizeRipgrepInvocation } from './ripgrep-flag-normalize.js';
import { healRipgrepPatternShape, readRipgrepSearchFlags } from './ripgrep-pattern-heal.js';
import { ExecutionContext } from './types.js';

const RG_NON_PATH_VALUE_FLAGS = new Set([
  '-e', '--regexp', '-r', '--replace', '-g', '--glob', '--iglob',
]);

const RG_NON_PATH_ATTACHED_PREFIXES = ['--regexp=', '--replace=', '--glob=', '--iglob='];

function isAttachedRgNonPathFlag(arg: string): boolean {
  if (RG_NON_PATH_ATTACHED_PREFIXES.some(p => arg.startsWith(p))) return true;
  return !arg.startsWith('--') && arg.length > 2 && (/^-[a-zA-Z]*[erg]/.test(arg) ? /^-[erg]./.test(arg) : false);
}

function collectRgNonPathIndices(args: readonly string[], patternIdx: number): Set<number> {
  const exempt = new Set<number>();
  if (patternIdx !== -1) exempt.add(patternIdx);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (RG_NON_PATH_VALUE_FLAGS.has(arg) && i + 1 < args.length) {
      exempt.add(i + 1);
      i++;
    } else if (isAttachedRgNonPathFlag(arg)) {
      exempt.add(i);
    }
  }
  return exempt;
}

function ripgrepTargetsLinuxOnlyPath(args: string[], patternIdx: number): boolean {
  const exempt = collectRgNonPathIndices(args, patternIdx);
  return args.some((arg, idx) =>
    !exempt.has(idx) && arg.startsWith('/') && !arg.startsWith('//') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)
  );
}

function preferNativeOrWslRipgrep(ctx: ExecutionContext): void {
  if (process.platform !== 'win32' || ctx.payload.target === 'wsl2') return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  if (resolveNativeBinary('rg') === null) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: No native 'rg' binary on PATH. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
    return;
  }
  if (ripgrepTargetsLinuxOnlyPath(ctx.args, patternIdx)) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'rg' targets a Linux-only POSIX path. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
    return;
  }
  const exempt = collectRgNonPathIndices(ctx.args, patternIdx);
  ctx.args = ctx.args.map((arg, idx) =>
    !exempt.has(idx) && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg) ? convertToWindowsPath(arg) : arg
  );
}

function appendRipgrepDefaultTarget(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasHelpOrVersion: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
): void {
  if (hasStdin || hasHelpOrVersion) return;
  const updatedPositional = getPositionalArgs(ctx.cmdBasename, ctx.args);
  const patternOrFilesMode = hasPatternFlag || hasFiles;
  const targetPositionals = patternOrFilesMode ? updatedPositional : updatedPositional.slice(1);
  if (targetPositionals.includes('.')) return;
  const needsDot = (patternOrFilesMode && updatedPositional.length === 0) || (!patternOrFilesMode && updatedPositional.length === 1);
  if (!needsDot) return;
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'rg' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
  ctx.args.push('.');
}

function finalizeRipgrepArgs(ctx: ExecutionContext, unbundledFlags: boolean, hasHelpOrVersion: boolean): void {
  if (ctx.payload.target === 'wsl2') {
    const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
    const exempt = collectRgNonPathIndices(ctx.args, patternIdx);
    ctx.args = ctx.args.map((arg, idx) => exempt.has(idx) ? arg : convertToWslPath(arg));
  }
  if (unbundledFlags && !hasHelpOrVersion && !ctx.args.includes('--no-messages')) ctx.args.unshift('--no-messages');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

export function handleRipgrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  const unbundledFlags = normalizeRipgrepInvocation(ctx);
  const flags = readRipgrepSearchFlags(ctx);
  const hasHelpOrVersion = healRipgrepPatternShape(ctx, hasStdin, flags);
  preferNativeOrWslRipgrep(ctx);
  const updatedFlags = readRipgrepSearchFlags(ctx);
  appendRipgrepDefaultTarget(ctx, hasStdin, hasHelpOrVersion, updatedFlags.hasPatternFlag, updatedFlags.hasFiles);
  finalizeRipgrepArgs(ctx, unbundledFlags, hasHelpOrVersion);
}
