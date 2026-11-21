// @ts-nocheck
import { match, P } from 'ts-pattern';
import { convertToWindowsPath, convertToWslPath, getPositionalArgs } from '../command-utils.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { handleGrepInterception, handleRipgrepInterception, handleFindInterception } from './search-interceptor.js';
import type { SystemCommandDerived } from './system-command-context.js';
import { handleListArm } from './system-list-arm.js';
import type { ExecutionContext } from './types.js';

const WRAPPER_SHELLS = ['sh', 'bash', 'pwsh', 'powershell', 'cmd'];
const PWSH_SCRIPT_FLAGS = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];

export function runSystemCommandArms(ctx: ExecutionContext, derived: SystemCommandDerived, activePositionalArgs: string[]): void {
  const { cmd, originalCmd, isCommand, hasStdin, embeddedArgs, cmdBasename } = derived;
  match({ ...ctx, positionalArgs: activePositionalArgs, hasStdin, cmd, isCommand, isWin32: process.platform === 'win32', originalCmd })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content') }, () => {
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

function handleJqArm(ctx: ExecutionContext, cmd: string): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    routeWindowsJq(ctx);
    return;
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
  }
}

function routeWindowsJq(ctx: ExecutionContext): void {
  const jqPosArgs = getPositionalArgs('jq', ctx.args);
  const inlineFromFiles = ctx.args.filter(arg => arg.startsWith('--from-file=')).map(arg => arg.slice('--from-file='.length));
  const hasFromFile = ctx.args.some(arg => arg === '-f' || arg === '--from-file') || inlineFromFiles.length > 0;
  const jqFileArgs = hasFromFile ? [...jqPosArgs, ...inlineFromFiles] : jqPosArgs.slice(1);
  const targetsLinuxOnlyPath = jqFileArgs.some(arg =>
    arg.startsWith('/') && !arg.startsWith('//') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg),
  );
  if (resolveNativeBinary('jq') === null) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: No native 'jq' binary on PATH. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
    return;
  }
  if (targetsLinuxOnlyPath) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'jq' targets a Linux-only POSIX path. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
    return;
  }
  ctx.args = ctx.args.map(arg => /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg) ? convertToWindowsPath(arg) : arg);
}

function handlePosixToolArm(ctx: ExecutionContext, cmdBasename: string): void {
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }
  if (['find', 'find.exe'].includes(cmdBasename.toLowerCase())) {
    handleFindInterception(ctx);
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
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
  if (!searchArgs.some(arg => arg.toLowerCase() === '-noninteractive')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.... (Frictionless Recovery)`);
    ctx.args.unshift('-NonInteractive');
  }
  if (!searchArgs.some(arg => arg.toLowerCase() === '-noprofile')) {
    ctx.args.unshift('-NoProfile');
  }
}
