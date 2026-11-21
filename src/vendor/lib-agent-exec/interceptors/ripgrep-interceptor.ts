// @ts-nocheck
import { convertToWindowsPath, convertToWslPath, findPatternExprIndex, getPositionalArgs } from '../command-utils.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { normalizeRipgrepInvocation } from './ripgrep-flag-normalize.js';
import { healRipgrepPatternShape, readRipgrepSearchFlags } from './ripgrep-pattern-heal.js';
import { ExecutionContext } from './types.js';

function ripgrepTargetsLinuxOnlyPath(args: string[], patternIdx: number): boolean {
  return args.some((arg, idx) =>
    idx !== patternIdx && arg.startsWith('/') && !arg.startsWith('//') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)
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
  ctx.args = ctx.args.map((arg, idx) =>
    idx !== patternIdx && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg) ? convertToWindowsPath(arg) : arg
  );
}

function appendRipgrepDefaultTarget(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasHelpOrVersion: boolean,
  hasPatternFlag: boolean,
): void {
  if (hasStdin || hasHelpOrVersion || ctx.args.includes('.')) return;
  const updatedPositional = getPositionalArgs(ctx.cmdBasename, ctx.args);
  const needsDot = (hasPatternFlag && updatedPositional.length === 0) || (!hasPatternFlag && updatedPositional.length === 1);
  if (!needsDot) return;
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'rg' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
  ctx.args.push('.');
}

function finalizeRipgrepArgs(ctx: ExecutionContext, unbundledFlags: boolean, hasHelpOrVersion: boolean): void {
  if (ctx.payload.target === 'wsl2') {
    const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
    ctx.args = ctx.args.map((arg, idx) => idx === patternIdx ? arg : convertToWslPath(arg));
  }
  if (unbundledFlags && !hasHelpOrVersion && !ctx.args.includes('--no-messages')) ctx.args.unshift('--no-messages');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

export function handleRipgrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  const unbundledFlags = normalizeRipgrepInvocation(ctx);
  preferNativeOrWslRipgrep(ctx);
  const flags = readRipgrepSearchFlags(ctx);
  const hasHelpOrVersion = healRipgrepPatternShape(ctx, hasStdin, flags);
  appendRipgrepDefaultTarget(ctx, hasStdin, hasHelpOrVersion, flags.hasPatternFlag);
  finalizeRipgrepArgs(ctx, unbundledFlags, hasHelpOrVersion);
}
