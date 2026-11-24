// @ts-nocheck
import { getPositionalArgs } from '../command-utils.js';
import { healPathHallucinations } from '../path-healer.js';
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

function syncDerivedArgs(ctx: ExecutionContext, derived: ReturnType<typeof buildSystemCommandContext>): void {
  derived.cmdBasename = ctx.cmdBasename;
  derived.cmd = ctx.cmdBasename.toLowerCase();
  const combined = [...derived.embeddedArgs, ...ctx.args];
  derived.args = combined;
  derived.positionalArgs = getPositionalArgs(derived.cmdBasename, combined);
}

export function systemInterceptor(ctx: ExecutionContext): void {
  const resolvedCwd = ctx.cwd !== undefined && ctx.cwd.length > 0 ? ctx.cwd : undefined;
  healFragmentedQuoteArgs(ctx);
  unwrapPackageRunnerShell(ctx);
  healEvalPayload(ctx.payload, resolvedCwd);

  const derived = buildSystemCommandContext(ctx);
  routeEmbeddedShellTools(derived.payload, resolvedCwd);
  extendPayloadTimeouts(derived, resolvedCwd);

  healPathHallucinations(ctx);
  syncDerivedArgs(ctx, derived);

  runMutatingInterceptors(ctx, { cmd: derived.cmd, cmdBasename: derived.cmdBasename, args: derived.args });
  syncDerivedArgs(ctx, derived);

  runSystemCommandArms(ctx, derived, derived.positionalArgs);
  syncDerivedArgs(ctx, derived);

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
