// @ts-nocheck
import { match, P } from 'ts-pattern';
import { convertToWindowsPath, convertToWslPath, getPositionalArgs } from '../command-utils.js';
import { collectWslPathExemptIndices } from '../wsl-command-wrapper.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { handleGrepInterception, handleRipgrepInterception, handleFindInterception } from './search-interceptor.js';
import type { SystemCommandDerived } from './system-command-context.js';
import { handleListArm } from './system-list-arm.js';
import type { ExecutionContext } from './types.js';
import { collectJqLibraryPaths, hasPreDoubleDashHelpOrVersion, scanJqFromFiles } from './utils.js';

const WRAPPER_SHELLS = ['sh', 'bash', 'pwsh', 'powershell', 'cmd'];
const PWSH_SCRIPT_FLAGS = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];
const ATTACHED_JQ_MNT_RE = /^(-[a-zA-Z]*[fL])(\/mnt\/[a-zA-Z](?:\/.*|$))/;

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
    .with({ isCommand: true, cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args: matchedArgs }) => {
      handlePwshArm(ctx, cmdBasename, matchedArgs);
    })
    .otherwise(() => {});
}

function handleCatArm(ctx: ExecutionContext, cmd: string, hasStdin: boolean, activePositionalArgs: string[]): void {
  if (WRAPPER_SHELLS.includes(cmd)) return;
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'cat' file inspection command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
  }
  if (hasPreDoubleDashHelpOrVersion(ctx.args)) return;
  if (!hasStdin && activePositionalArgs.length === 0) {
    console.error(`\n   💡 AGENT HINT: 'cat' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Provide a file argument or use view_file.\x1b[0m`);
    process.exit(1);
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
    syncCtxPayloadArgs(ctx);
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
    embeddedArgs.length = 0;
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
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' network command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
  }
  if (['invoke-webrequest', 'iwr'].includes(cmdBasename.toLowerCase())) {
    ctx.cmdBasename = 'curl';
    if (ctx.payload.type === 'command') ctx.payload.command = 'curl';
  }
  if (ctx.payload.target === 'wsl2') {
    ctx.args = ctx.args.map(arg => convertToWslPath(arg));
    syncCtxPayloadArgs(ctx);
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
  const { hasFromFile, files } = scanJqFromFiles(args);
  return [...(hasFromFile ? posArgs : posArgs.slice(1)), ...files, ...collectJqLibraryPaths(args)];
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
    if (!exempt.has(idx) && (arg.startsWith('--from-file=') || arg.startsWith('--library-path='))) {
      const eqIdx = arg.indexOf('=');
      const flagHead = arg.slice(0, eqIdx + 1);
      const val = arg.slice(eqIdx + 1);
      return /^\/mnt\/[a-zA-Z](?:\/|$)/.test(val) ? `${flagHead}${convertToWindowsPath(val)}` : arg;
    }
    if (!exempt.has(idx) && !arg.startsWith('--')) {
      const attached = ATTACHED_JQ_MNT_RE.exec(arg);
      const prefix = attached?.[1];
      const val = attached?.[2];
      if (prefix !== undefined && val !== undefined && prefix.search(/[fL]/) === prefix.length - 1) {
        return `${prefix}${convertToWindowsPath(val)}`;
      }
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
  const scriptFlagIdx = matchedArgs.findIndex((arg) => {
    const low = arg.toLowerCase();
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    return PWSH_SCRIPT_FLAGS.includes(head);
  });
  const searchArgs = scriptFlagIdx === -1 ? matchedArgs : matchedArgs.slice(0, scriptFlagIdx);
  const headArgs = searchArgs.map((arg) => {
    const low = arg.toLowerCase();
    return low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
  });
  const needsNonInteractive = !headArgs.includes('-noninteractive');
  const needsNoProfile = !headArgs.includes('-noprofile');
  if (needsNonInteractive) ctx.args.unshift('-NonInteractive');
  if (needsNoProfile) ctx.args.unshift('-NoProfile');
  if (needsNonInteractive || needsNoProfile) syncCtxPayloadArgs(ctx);
  if (needsNonInteractive) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.... (Frictionless Recovery)`);
  }
}
