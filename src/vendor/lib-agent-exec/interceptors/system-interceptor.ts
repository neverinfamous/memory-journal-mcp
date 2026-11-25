// @ts-nocheck
import { getPositionalArgs } from '../command-utils.js';
import { healPathHallucinations } from '../path-argv-healer.js';
import { runMutatingInterceptors } from './mutating-interceptors.js';
import { runStructuralInterceptors } from './structural-interceptors.js';
import { runSystemCommandArms } from './system-command-arms.js';
import { buildSystemCommandContext, resolveInlineCommand } from './system-command-context.js';
import { healEvalPayload } from './system-eval-healer.js';
import { rewriteInlineInterpreterScripts } from './system-inline-script.js';
import { blockUnsafePipes } from './system-pipe-guard.js';
import { healFragmentedQuoteArgs, unwrapPackageRunnerShell } from './system-runner-unwrap.js';
import { routeEmbeddedShellTools } from './system-shell-routing.js';
import { extendPayloadTimeouts } from './system-timeouts.js';
import type { ExecutionContext } from './types.js';

interface DerivedSyncState {
  cmdBasename: string;
  ctxArgsRef: string[];
  ctxArgsSnapshot: string[];
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function syncDerivedArgs(ctx: ExecutionContext, derived: ReturnType<typeof buildSystemCommandContext>, prev: DerivedSyncState): void {
  if (ctx.cmdBasename === prev.cmdBasename && ctx.args === prev.ctxArgsRef && sameArgs(ctx.args, prev.ctxArgsSnapshot)) {
    return;
  }
  prev.cmdBasename = ctx.cmdBasename;
  prev.ctxArgsRef = ctx.args;
  prev.ctxArgsSnapshot = [...ctx.args];
  derived.cmdBasename = ctx.cmdBasename;
  derived.cmd = ctx.cmdBasename.toLowerCase();
  const combined = derived.embeddedArgs.length === 0 ? ctx.args : [...derived.embeddedArgs, ...ctx.args];
  derived.args = combined;
  derived.positionalArgs = getPositionalArgs(derived.cmdBasename, combined);
}

export function systemInterceptor(ctx: ExecutionContext): void {
  const resolvedCwd = ctx.cwd !== undefined && ctx.cwd.length > 0 ? ctx.cwd : undefined;
  healFragmentedQuoteArgs(ctx);
  unwrapPackageRunnerShell(ctx);
  healEvalPayload(ctx.payload, resolvedCwd);

  const derived = buildSystemCommandContext(ctx);
  const syncState: DerivedSyncState = {
    cmdBasename: ctx.cmdBasename,
    ctxArgsRef: ctx.args,
    ctxArgsSnapshot: [...ctx.args],
  };
  routeEmbeddedShellTools(derived.payload, resolvedCwd);
  extendPayloadTimeouts(derived, resolvedCwd);

  healPathHallucinations(ctx);
  syncDerivedArgs(ctx, derived, syncState);

  runMutatingInterceptors(ctx, { cmd: derived.cmd, cmdBasename: derived.cmdBasename, args: derived.args });
  syncDerivedArgs(ctx, derived, syncState);

  runSystemCommandArms(ctx, derived, derived.positionalArgs);
  syncDerivedArgs(ctx, derived, syncState);

  blockUnsafePipes(derived);

  const inline = resolveInlineCommand(derived.args, derived.cmdBasename);
  runStructuralInterceptors(ctx, {
    cmd: derived.cmd,
    cmdBasename: derived.cmdBasename,
    originalCmd: derived.originalCmd,
    args: derived.args,
    isCommand: derived.isCommand,
    hasInlineCmd: inline.hasInlineCmd,
    inlineFlag: inline.inlineFlag,
    innerCmdStr: inline.innerCmdStr,
    positionalArgs: derived.positionalArgs,
    hasStdin: derived.hasStdin,
  });
  rewriteInlineInterpreterScripts(ctx, derived.isCommand, derived.originalCmd);
}
