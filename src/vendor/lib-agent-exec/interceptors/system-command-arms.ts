// @ts-nocheck
import { match, P } from 'ts-pattern';
import { convertToWindowsPath, convertToWslPath, getPositionalArgs } from '../command-utils.js';
import { collectWslPathExemptIndices } from '../wsl-command-wrapper.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { handleGrepInterception, handleRipgrepInterception, handleFindInterception } from './search-interceptor.js';
import type { SystemCommandDerived } from './system-command-context.js';
import { handleListArm } from './system-list-arm.js';
import type { ExecutionContext } from './types.js';
import { hasPreDoubleDashHelpOrVersion } from './utils.js';

const WRAPPER_SHELLS = ['sh', 'bash', 'pwsh', 'powershell', 'cmd'];
const PWSH_SCRIPT_FLAGS = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];

export function runSystemCommandArms(ctx: ExecutionContext, derived: SystemCommandDerived, activePositionalArgs: string[]): void {
  const { cmd, originalCmd, isCommand, hasStdin, embeddedArgs, cmdBasename } = derived;
  match({ ...ctx, positionalArgs: activePositionalArgs, hasStdin, cmd, isCommand, isWin32: process.platform === 'win32', originalCmd })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content') }, () => {
      if (originalCmd === 'get-content') {
        ctx.cmdBasename = 'cat';
        if (ctx.payload.type === 'command') ctx.payload.command = 'cat';
      }
      handleCatArm(ctx, cmd, hasStdin, activePositionalArgs);
    })
    .with({ originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe') }, () => {
      handleGrepArm(ctx, cmd, cmdBasename, originalCmd, embeddedArgs, hasStdin);
    })
    .with({ originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com') }, () => {
      handleListArm(ctx, cmd, cmdBasename);
    })
    .with({ originalCmd: P.union('curl', 'curl.exe', 'wget', 'wget.exe', 'invoke-webrequest', 'iwr') }, () => {
      handleCurlArm(ctx, cmdBasename);
    })
    .with({ cmd: P.union('jq', 'jq.exe') }, () => {
      handleJqArm(ctx, cmd);
    })
    .with({ cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'yq', 'yq.exe', 'find', 'find.exe', 'tail', 'tail.exe', 'head', 'head.exe', 'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe') }, () => {
      handlePosixToolArm(ctx, cmdBasename);
    })
    .with({ isCommand: true, originalCmd: P.union('rg', 'rg.exe') }, () => {
      handleRgArm(ctx, cmd, hasStdin);
    })
    .with({ cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args: matchedArgs }) => {
      handlePwshArm(ctx, cmdBasename, matchedArgs);
    })
    .otherwise(() => {});
}

function handleCatArm(ctx: ExecutionContext, cmd: string, hasStdin: boolean, activePositionalArgs: string[]): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  if (hasPreDoubleDashHelpOrVersion(ctx.args)) return;
  if (!hasStdin && activePositionalArgs.length === 0) {
    console.error(`\n   💡 AGENT HINT: 'cat' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Provide a file argument or use view_file.\x1b[0m`);
    process.exit(1);
  }
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'cat' file inspection command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
  }
}

function handleGrepArm(
  ctx: ExecutionContext,
  cmd: string,
  cmdBasename: string,
  originalCmd: string,
  embeddedArgs: string[],
  hasStdin: boolean,
): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  if (embeddedArgs.length > 0 && ctx.args.length === 0) {
    ctx.args = [...embeddedArgs];
    ctx.cmdBasename = originalCmd;
    if (ctx.payload.type === 'command') {
      ctx.payload.command = originalCmd;
      ctx.payload.args = ctx.args;
    }
  }
  if (cmdBasename.toLowerCase().startsWith('select-string')) {
    if (ctx.payload.type === 'command') ctx.payload.command = 'grep';
    ctx.cmdBasename = 'grep';
  }
  handleGrepInterception(ctx, hasStdin);
}

function handleCurlArm(ctx: ExecutionContext, cmdBasename: string): void {
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' network command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }
  if (['invoke-webrequest', 'iwr'].includes(cmdBasename.toLowerCase()) && ctx.payload.type === 'command') {
    ctx.payload.command = 'curl';
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
  }
}

function syncCtxPayloadArgs(ctx: ExecutionContext): void {
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function convertWslCommandArgs(ctx: ExecutionContext, cmdBasename: string): void {
  const exempt = collectWslPathExemptIndices(cmdBasename, ctx.args);
  ctx.args = ctx.args.map((arg, idx) => (exempt.has(idx) ? arg : convertToWslPath(arg)));
  syncCtxPayloadArgs(ctx);
}

function handleJqArm(ctx: ExecutionContext, cmd: string): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    routeWindowsJq(ctx);
    return;
  }
  if (ctx.payload.target === 'wsl2') {
    convertWslCommandArgs(ctx, ctx.cmdBasename);
  }
}

function collectJqExternalFiles(args: readonly string[], posArgs: readonly string[]): string[] {
  const files: string[] = [];
  let hasFromFile = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '-f' || a === '--from-file') {
      hasFromFile = true;
      const next = args[i + 1];
      if (next !== undefined) files.push(next);
      i++;
    } else if (a.startsWith('--from-file=')) {
      hasFromFile = true;
      files.push(a.slice('--from-file='.length));
    } else if (a === '--rawfile' || a === '--slurpfile') {
      const pathVal = args[i + 2];
      if (pathVal !== undefined) files.push(pathVal);
      i += 2;
    }
  }
  return [...(hasFromFile ? posArgs : posArgs.slice(1)), ...files];
}

function routeWindowsJq(ctx: ExecutionContext): void {
  const jqPosArgs = getPositionalArgs('jq', ctx.args);
  const jqFileArgs = collectJqExternalFiles(ctx.args, jqPosArgs);
  const targetsLinuxOnlyPath = jqFileArgs.some(arg =>
    arg.startsWith('/') && !arg.startsWith('//') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg),
  );
  if (resolveNativeBinary('jq') === null) {
    ctx.payload.target = 'wsl2';
    convertWslCommandArgs(ctx, ctx.cmdBasename);
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: No native 'jq' binary on PATH. Switching execution target to WSL2... (Frictionless Recovery)`);
    return;
  }
  if (targetsLinuxOnlyPath) {
    ctx.payload.target = 'wsl2';
    convertWslCommandArgs(ctx, ctx.cmdBasename);
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'jq' targets a Linux-only POSIX path. Switching execution target to WSL2... (Frictionless Recovery)`);
    return;
  }
  const exempt = collectWslPathExemptIndices(ctx.cmdBasename, ctx.args);
  ctx.args = ctx.args.map((arg, idx) => {
    if (!exempt.has(idx) && arg.startsWith('--from-file=')) {
      const val = arg.slice('--from-file='.length);
      return /^\/mnt\/[a-zA-Z](?:\/|$)/.test(val) ? `--from-file=${convertToWindowsPath(val)}` : arg;
    }
    return !exempt.has(idx) && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg) ? convertToWindowsPath(arg) : arg;
  });
  syncCtxPayloadArgs(ctx);
}

function handlePosixToolArm(ctx: ExecutionContext, cmdBasename: string): void {
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
  }
  if (['find', 'find.exe'].includes(cmdBasename.toLowerCase())) {
    handleFindInterception(ctx);
  }
  if (ctx.payload.target === 'wsl2') {
    convertWslCommandArgs(ctx, cmdBasename);
  }
}

function handleRgArm(ctx: ExecutionContext, cmd: string, hasStdin: boolean): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  handleRipgrepInterception(ctx, hasStdin);
}

function handlePwshArm(ctx: ExecutionContext, cmdBasename: string, matchedArgs: string[]): void {
  if (ctx.payload.target === 'wsl2') return;
  const scriptFlagIdx = matchedArgs.findIndex(arg => PWSH_SCRIPT_FLAGS.includes(arg.toLowerCase()));
  const searchArgs = scriptFlagIdx === -1 ? matchedArgs : matchedArgs.slice(0, scriptFlagIdx);
  const needsNonInteractive = !searchArgs.some(arg => arg.toLowerCase() === '-noninteractive');
  const needsNoProfile = !searchArgs.some(arg => arg.toLowerCase() === '-noprofile');
  if (needsNonInteractive) ctx.args.unshift('-NonInteractive');
  if (needsNoProfile) ctx.args.unshift('-NoProfile');
  if (needsNonInteractive || needsNoProfile) syncCtxPayloadArgs(ctx);
  if (needsNonInteractive) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.... (Frictionless Recovery)`);
  }
}
