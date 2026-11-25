// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath, convertToWslPath } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { handleFindInterception } from './search-interceptor.js';
import type { ExecutionContext } from './types.js';

export function handleListArm(ctx: ExecutionContext, cmd: string, cmdBasename: string): void {
  if (isWrapperShell(cmd)) return;
  if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' directory listing command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
  }
  const cleanBase = cmdBasename.toLowerCase().replace(/\.exe$/, '');
  const isWindowsListCmd = ['dir', 'get-childitem', 'gci'].includes(cleanBase);
  if (rewriteListFilterToFind(ctx, isWindowsListCmd)) return;
  if (rewriteRecursiveListToFind(ctx, isWindowsListCmd)) return;
  renameDirToLs(ctx, cmdBasename);
  ctx.args = cleanWindowsListArgs(ctx.args, isWindowsListCmd);
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function isWrapperShell(cmd: string): boolean {
  return ['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd);
}

function isListValueFlag(arg: string, isWindowsListCmd: boolean): boolean {
  if (!isWindowsListCmd) return false;
  return ['-depth', '-filter', '-include', '-exclude'].includes(arg.toLowerCase());
}

function rewriteListFilterToFind(ctx: ExecutionContext, isWindowsListCmd: boolean): boolean {
  const filterIdx = ctx.args.findIndex((arg) => {
    const low = arg.toLowerCase();
    return low === '-filter' || low === '-include' || low.startsWith('-filter:') || low.startsWith('-include:');
  });
  if (filterIdx === -1) return false;
  const rawFlag = ctx.args[filterIdx] ?? '';
  const colonIdx = rawFlag.indexOf(':');
  const skipNextToken = colonIdx === -1;
  const pattern = skipNextToken ? ctx.args[filterIdx + 1] : rawFlag.slice(colonIdx + 1);
  if (pattern === undefined || pattern.length === 0) return false;
  applyFindRewrite(ctx, findListTargetPath(ctx.args, filterIdx, isWindowsListCmd, skipNextToken), pattern, !hasRecurseFlag(ctx.args, isWindowsListCmd));
  return true;
}

function isWinSwitch(arg: string, isWindowsListCmd: boolean): boolean {
  if (!isWindowsListCmd) return false;
  return /^\/(?:[sSbBwWpPqQcC4]|[aA](?::[dhrsalio-]+|(?:-?[dhrsalio]){1,3})?|[oO](?::[nesdg-]+|(?:-?[nesdg]){1,3})?)$/.test(arg);
}

function collectListPositionals(args: readonly string[], isWindowsListCmd: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (isListValueFlag(arg, isWindowsListCmd)) { i++; continue; }
    if (!arg.startsWith('-') && !isWinSwitch(arg, isWindowsListCmd)) out.push(arg);
  }
  return out;
}

function rewriteRecursiveListToFind(ctx: ExecutionContext, isWindowsListCmd: boolean): boolean {
  if (!hasRecurseFlag(ctx.args, isWindowsListCmd)) return false;
  const patternArg = collectListPositionals(ctx.args, isWindowsListCmd)[0];
  if (patternArg === undefined) return false;
  const located = splitPatternPath(patternArg);
  if (located.pattern.length === 0 || located.pattern === '.' || located.pattern === '..') return false;
  const isGlobPattern = /[*?[\]]/.test(located.pattern);
  const hostPattern = /^\/mnt\/[a-zA-Z](?:\/|$)/.test(patternArg) ? convertToWindowsPath(patternArg) : patternArg;
  const rawCwd = ctx.payload.cwd ?? ctx.cwd ?? process.cwd();
  const hostCwd = /^\/mnt\/[a-zA-Z](?:\/|$)/.test(rawCwd) ? convertToWindowsPath(rawCwd) : rawCwd;
  const isWinNonHostPath = (val: string): boolean =>
    process.platform === 'win32' && (val.startsWith('/') || val.startsWith('~'));
  const isExistingDir = !(isWinNonHostPath(hostPattern) || isWinNonHostPath(hostCwd))
    && fs.statSync(path.resolve(hostCwd, hostPattern), { throwIfNoEntry: false })?.isDirectory() === true;
  const isWindowsDirFilePattern = isWindowsListCmd && !located.pattern.startsWith('.') && !isExistingDir && /\.[a-zA-Z0-9_-]+$/.test(located.pattern);
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
  if (ctx.payload.type === 'command') ctx.payload.args = newArgs;
  handleFindInterception(ctx);
}

function hasRecurseFlag(args: string[], isWindowsListCmd: boolean): boolean {
  return args.some(arg =>
    isWindowsListCmd
      ? ['-recurse', '-r', '/s'].includes(arg.toLowerCase())
      : arg === '-R' || arg === '--recursive',
  );
}

function findListTargetPath(args: string[], filterIdx: number, isWindowsListCmd: boolean, skipNextFilterVal = true): string {
  for (let i = 0; i < args.length; i++) {
    if (i === filterIdx || (skipNextFilterVal && i === filterIdx + 1)) continue;
    const arg = args[i];
    if (arg === undefined) continue;
    if (isListValueFlag(arg, isWindowsListCmd)) { i++; continue; }
    if (isWindowsListCmd && arg.toLowerCase().startsWith('-path:')) {
      const rawVal = arg.slice('-path:'.length);
      if (rawVal.length > 0) return convertToWslPath(rawVal);
      continue;
    }
    if (!arg.startsWith('-') && !isWinSwitch(arg, isWindowsListCmd)) return convertToWslPath(arg);
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
  if (dirPart.length === 0) return { targetPath: '/', pattern };
  const normalizedDir = /^[a-zA-Z]:$/.test(dirPart) ? `${dirPart}/` : dirPart;
  return { targetPath: convertToWslPath(normalizedDir), pattern };
}

function renameDirToLs(ctx: ExecutionContext, cmdBasename: string): void {
  const cleanBase = cmdBasename.toLowerCase().replace(/\.exe$/, '');
  if (!['dir', 'get-childitem', 'gci'].includes(cleanBase)) return;
  ctx.cmdBasename = 'ls';
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
  if (lower.startsWith('-path:')) {
    const rawVal = (args[index] ?? '').slice('-path:'.length);
    return { consumeNext: false, outputs: rawVal.length > 0 ? [convertToWslPath(rawVal)] : [] };
  }
  if (lower === '-depth' || lower === '-depth:') {
    const next = args[index + 1];
    return { consumeNext: next !== undefined && /^\d+$/.test(next), outputs: [] };
  }
  if (lower.startsWith('-depth:') || lower.startsWith('-filter:') || lower.startsWith('-include:') || lower.startsWith('-exclude:')) {
    return { consumeNext: false, outputs: [] };
  }
  if (lower === '-filter' || lower === '-include' || lower === '-exclude') return { consumeNext: true, outputs: [] };
  if (lower === '-recurse' || (isWindowsListCmd && lower === '/s')) return { consumeNext: false, outputs: ['-R'] };
  if (isWindowsListCmd && lower === '/b') return { consumeNext: false, outputs: ['-1'] };
  if (lower === '-file' || lower === '-directory' || (isWindowsListCmd && (lower === '/ad' || lower === '/a:d'))) {
    return { consumeNext: false, outputs: [] };
  }
  if (isWindowsListCmd && /^\/a(?::[dhrsalio-]+|(?:-?[dhrsalio]){1,3})?$/.test(lower)) {
    return { consumeNext: false, outputs: /(?<!-)h/.test(lower.slice(2)) ? ['-a'] : [] };
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
  if (!/^\/o(?::[nesdg-]+|(?:-?[nesdg]){1,3})?$/.test(lower)) return null;
  const outputs: string[] = [];
  if (lower.includes('d')) outputs.push('-t');
  if (lower.includes('s')) outputs.push('-S');
  return { consumeNext: false, outputs };
}
