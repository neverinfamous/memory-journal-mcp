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
  retargetListInterpreter(ctx);
  if (rewriteListFilterToFind(ctx)) return;
  if (rewriteRecursiveListToFind(ctx, cmdBasename)) return;
  renameDirToLs(ctx, cmdBasename);
  ctx.args = cleanWindowsListArgs(ctx.args);
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

function rewriteListFilterToFind(ctx: ExecutionContext): boolean {
  const filterIdx = ctx.args.findIndex(arg => ['-filter', '-include'].includes(arg.toLowerCase()));
  if (filterIdx === -1 || filterIdx + 1 >= ctx.args.length) return false;
  const pattern = ctx.args[filterIdx + 1];
  if (pattern === undefined) return false;
  applyFindRewrite(ctx, findListTargetPath(ctx.args, filterIdx), pattern, !hasRecurseFlag(ctx.args));
  return true;
}

function rewriteRecursiveListToFind(ctx: ExecutionContext, cmdBasename: string): boolean {
  if (!hasRecurseFlag(ctx.args)) return false;
  const patternArg = ctx.args.filter(arg => !arg.startsWith('-') && !arg.startsWith('/'))[0];
  if (patternArg === undefined) return false;
  const located = splitPatternPath(patternArg);
  if (located.pattern.length === 0 || located.pattern === '.' || located.pattern === '..') return false;
  const isGlobPattern = /[*?[\]]/.test(located.pattern);
  const isWindowsDirFilePattern = ['dir', 'get-childitem', 'gci'].includes(cmdBasename.toLowerCase())
    && /\.[a-zA-Z0-9_-]+$/.test(located.pattern);
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

function findListTargetPath(args: string[], filterIdx: number): string {
  for (let i = 0; i < args.length; i++) {
    if (i === filterIdx || i === filterIdx + 1) continue;
    const arg = args[i];
    if (arg !== undefined && !arg.startsWith('-')) return convertToWslPath(arg);
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
  return { targetPath: convertToWslPath(dirPart), pattern };
}

function renameDirToLs(ctx: ExecutionContext, cmdBasename: string): void {
  if (!['dir', 'get-childitem', 'gci'].includes(cmdBasename.toLowerCase())) return;
  if (ctx.payload.type === 'command') ctx.payload.command = 'ls';
}

function cleanWindowsListArgs(args: string[]): string[] {
  const cleanedArgs: string[] = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const arg = args[i];
    if (arg === undefined) continue;
    const translated = translateListFlag(arg.toLowerCase(), args, i);
    if (translated === null) {
      cleanedArgs.push(convertToWslPath(arg));
      continue;
    }
    if (translated.consumeNext) skipNext = true;
    cleanedArgs.push(...translated.outputs);
  }
  return cleanedArgs;
}

function translateListFlag(lower: string, args: string[], index: number): { consumeNext: boolean; outputs: string[] } | null {
  if (lower === '-path' || lower === '-path:') return { consumeNext: false, outputs: [] };
  if (lower === '-depth' || lower === '-depth:') {
    const next = args[index + 1];
    return { consumeNext: next !== undefined && /^\d+$/.test(next), outputs: [] };
  }
  if (lower.startsWith('-depth:')) return { consumeNext: false, outputs: [] };
  if (lower === '-filter' || lower === '-include') return { consumeNext: true, outputs: [] };
  if (lower === '-recurse' || lower === '/s') return { consumeNext: false, outputs: ['-R'] };
  if (lower === '/b') return { consumeNext: false, outputs: ['-1'] };
  if (lower === '-file' || lower === '-directory' || lower === '/ad' || lower === '/a:d') {
    return { consumeNext: false, outputs: [] };
  }
  if (/^\/[aA](?::?[a-zA-Z-]*)?$/.test(lower)) {
    return { consumeNext: false, outputs: lower.includes('h') ? ['-a'] : [] };
  }
  const orderFlag = translateOrderFlag(lower);
  if (orderFlag !== null) return orderFlag;
  if (lower === '/w' || lower === '/p' || lower === '/q' || lower === '/c' || lower === '/4') {
    return { consumeNext: false, outputs: [] };
  }
  if (lower === '-name') return { consumeNext: false, outputs: ['-1'] };
  if (lower === '-force' || lower === '-hidden') return { consumeNext: false, outputs: ['-a'] };
  if (lower === '-readonly') return { consumeNext: false, outputs: [] };
  return null;
}

function translateOrderFlag(lower: string): { consumeNext: boolean; outputs: string[] } | null {
  if (!/^\/[oO](?::?[a-zA-Z-]*)?$/.test(lower)) return null;
  const outputs: string[] = [];
  if (lower.includes('t') || lower.includes('d')) outputs.push('-t');
  if (lower.includes('s')) outputs.push('-S');
  return { consumeNext: false, outputs };
}
