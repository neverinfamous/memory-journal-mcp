// @ts-nocheck
import { convertToWslPath } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { handleFindInterception } from './search-interceptor.js';
import type { ExecutionContext } from './types.js';

export function handleListArm(ctx: ExecutionContext, cmd: string, cmdBasename: string): void {
  if (isWrapperShell(cmd)) return;
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' directory listing command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
    ctx.payload.target = 'wsl2';
  }
  const cleanBase = cmdBasename.toLowerCase().replace(/\.exe$/, '');
  const isWindowsListCmd = ['dir', 'get-childitem', 'gci'].includes(cleanBase);
  retargetListInterpreter(ctx);
  if (rewriteListFilterToFind(ctx, isWindowsListCmd)) return;
  if (rewriteRecursiveListToFind(ctx, isWindowsListCmd)) return;
  renameDirToLs(ctx, cmdBasename);
  ctx.args = cleanWindowsListArgs(ctx.args, isWindowsListCmd);
}

function isWrapperShell(cmd: string): boolean {
  return ['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd);
}

function retargetListInterpreter(ctx: ExecutionContext): void {
  if (!('interpreter' in ctx.payload) || !ctx.payload.interpreter) return;
  const windowsShells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'];
  if (windowsShells.includes(ctx.payload.interpreter.toLowerCase())) {
    ctx.payload.interpreter = 'bash';
  }
}

function rewriteListFilterToFind(ctx: ExecutionContext, isWindowsListCmd: boolean): boolean {
  const filterIdx = ctx.args.findIndex(arg => ['-filter', '-include'].includes(arg.toLowerCase()));
  if (filterIdx === -1 || filterIdx + 1 >= ctx.args.length) return false;
  const pattern = ctx.args[filterIdx + 1];
  if (pattern === undefined) return false;
  applyFindRewrite(ctx, findListTargetPath(ctx.args, filterIdx, isWindowsListCmd), pattern, !hasRecurseFlag(ctx.args));
  return true;
}

function isWinSwitch(arg: string, isWindowsListCmd: boolean): boolean {
  if (!isWindowsListCmd) return false;
  return /^\/(?:[sSbBwWpPqQcC4]|[aA](?::[dhrsalio-]+|[dhrsalio]{1,3})?|[oO](?::[nesdg-]+|[nesdg]{1,3})?)$/.test(arg);
}

function rewriteRecursiveListToFind(ctx: ExecutionContext, isWindowsListCmd: boolean): boolean {
  if (!hasRecurseFlag(ctx.args)) return false;
  const patternArg = ctx.args.filter(arg => !arg.startsWith('-') && !isWinSwitch(arg, isWindowsListCmd))[0];
  if (patternArg === undefined) return false;
  const located = splitPatternPath(patternArg);
  if (located.pattern.length === 0 || located.pattern === '.' || located.pattern === '..') return false;
  const isGlobPattern = /[*?[\]]/.test(located.pattern);
  const isWindowsDirFilePattern = isWindowsListCmd && /\.[a-zA-Z0-9_-]+$/.test(located.pattern);
  if (!isGlobPattern && !isWindowsDirFilePattern) return false;
  applyFindRewrite(ctx, located.targetPath, located.pattern, false);
  return true;
}

function applyFindRewrite(ctx: ExecutionContext, targetPath: string, pattern: string, limitDepth: boolean): void {
  if (ctx.payload.type === 'command') ctx.payload.command = 'find';
  ctx.cmdBasename = 'find';
  const newArgs = [targetPath];
  if (limitDepth) newArgs.push('-maxdepth', '1');
  if (ctx.args.some(arg => arg.toLowerCase() === '-file')) newArgs.push('-type', 'f');
  if (ctx.args.some(arg => arg.toLowerCase() === '-directory')) newArgs.push('-type', 'd');
  newArgs.push('-name', pattern);
  ctx.args = newArgs;
  handleFindInterception(ctx);
}

function hasRecurseFlag(args: string[]): boolean {
  return args.some(arg => ['-recurse', '-r', '-R', '/s'].includes(arg.toLowerCase()));
}

function findListTargetPath(args: string[], filterIdx: number, isWindowsListCmd: boolean): string {
  for (let i = 0; i < args.length; i++) {
    if (i === filterIdx || i === filterIdx + 1) continue;
    const arg = args[i];
    if (arg !== undefined && !arg.startsWith('-') && !isWinSwitch(arg, isWindowsListCmd)) return convertToWslPath(arg);
  }
  return '.';
}

function splitPatternPath(patternArg: string): { targetPath: string; pattern: string } {
  if (!patternArg.includes('/') && !patternArg.includes('\\')) {
    return { targetPath: '.', pattern: patternArg };
  }
  const lastSep = Math.max(patternArg.lastIndexOf('/'), patternArg.lastIndexOf('\\'));
  const dirPart = patternArg.substring(0, lastSep);
  const pattern = patternArg.substring(lastSep + 1);
  if (dirPart.length === 0) return { targetPath: '.', pattern };
  const normalizedDir = /^[a-zA-Z]:$/.test(dirPart) ? `${dirPart}/` : dirPart;
  return { targetPath: convertToWslPath(normalizedDir), pattern };
}

function renameDirToLs(ctx: ExecutionContext, cmdBasename: string): void {
  const cleanBase = cmdBasename.toLowerCase().replace(/\.exe$/, '');
  if (!['dir', 'get-childitem', 'gci'].includes(cleanBase)) return;
  if (ctx.payload.type === 'command') ctx.payload.command = 'ls';
}

function cleanWindowsListArgs(args: string[], isWindowsListCmd: boolean): string[] {
  const cleanedArgs: string[] = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const arg = args[i];
    if (arg === undefined) continue;
    const translated = translateListFlag(arg.toLowerCase(), args, i, isWindowsListCmd);
    if (translated === null) {
      cleanedArgs.push(convertToWslPath(arg));
      continue;
    }
    if (translated.consumeNext) skipNext = true;
    cleanedArgs.push(...translated.outputs);
  }
  return cleanedArgs;
}

function translateListFlag(lower: string, args: string[], index: number, isWindowsListCmd: boolean): { consumeNext: boolean; outputs: string[] } | null {
  if (lower === '-path' || lower === '-path:') return { consumeNext: false, outputs: [] };
  if (lower === '-depth' || lower === '-depth:') {
    const next = args[index + 1];
    return { consumeNext: next !== undefined && /^\d+$/.test(next), outputs: [] };
  }
  if (lower.startsWith('-depth:')) return { consumeNext: false, outputs: [] };
  if (lower === '-filter' || lower === '-include') return { consumeNext: true, outputs: [] };
  if (lower === '-recurse' || (isWindowsListCmd && lower === '/s')) return { consumeNext: false, outputs: ['-R'] };
  if (isWindowsListCmd && lower === '/b') return { consumeNext: false, outputs: ['-1'] };
  if (lower === '-file' || lower === '-directory' || (isWindowsListCmd && (lower === '/ad' || lower === '/a:d'))) {
    return { consumeNext: false, outputs: [] };
  }
  if (isWindowsListCmd && /^\/a(?::[dhrsalio-]+|[dhrsalio]{1,3})?$/.test(lower)) {
    return { consumeNext: false, outputs: lower.includes('h') ? ['-a'] : [] };
  }
  const orderFlag = isWindowsListCmd ? translateOrderFlag(lower) : null;
  if (orderFlag !== null) return orderFlag;
  if (isWindowsListCmd && (lower === '/w' || lower === '/p' || lower === '/q' || lower === '/c' || lower === '/4')) {
    return { consumeNext: false, outputs: [] };
  }
  if (lower === '-name') return { consumeNext: false, outputs: ['-1'] };
  if (lower === '-force' || lower === '-hidden') return { consumeNext: false, outputs: ['-a'] };
  if (lower === '-readonly') return { consumeNext: false, outputs: [] };
  return null;
}

function translateOrderFlag(lower: string): { consumeNext: boolean; outputs: string[] } | null {
  if (!/^\/o(?::[nesdg-]+|[nesdg]{1,3})?$/.test(lower)) return null;
  const outputs: string[] = [];
  if (lower.includes('d')) outputs.push('-t');
  if (lower.includes('s')) outputs.push('-S');
  return { consumeNext: false, outputs };
}
