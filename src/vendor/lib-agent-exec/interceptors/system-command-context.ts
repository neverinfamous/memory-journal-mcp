// @ts-nocheck
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { getPositionalArgs } from '../command-utils.js';
import type { ExecutionContext } from './types.js';

export const EXACT_SHELL_CHARS: readonly string[] = ['|', '>', '<', '&&', '||', ';'];

export const PATTERN_TOOLS: readonly string[] = [
  'grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe',
  'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'fd', 'fd.exe', 'fdfind', 'fdfind.exe',
  'node', 'node.exe', 'python', 'python.exe', 'sqlite3', 'sqlite3.exe', 'tail', 'tail.exe', 'head', 'head.exe',
  'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe',
];

export const SHELL_NAMES: readonly string[] = [
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe',
];

export const INLINE_FLAGS: readonly string[] = [
  '-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval', '--exec', '-execute', '--execute',
];

export interface SystemCommandDerived {
  cmdBasename: string;
  payload: ExecPayload;
  args: string[];
  isCommand: boolean;
  embeddedArgs: string[];
  positionalArgs: string[];
  hasStdin: boolean;
  cmd: string;
  originalCmd: string;
}

export interface InlineCommand {
  hasInlineCmd: boolean;
  inlineFlag: string;
  innerCmdStr: string;
}

// [INTENT]: Basename of the first command token, so "curl https://example.com" is not classified as example.com,
// while preserving intact executable paths whose parent folders contain spaces (e.g. "C:\Program Files\...\pwsh.exe").
export function resolveOriginalCmd(payload: ExecPayload, cmd: string): string {
  if (!('command' in payload) || typeof payload.command !== 'string') return cmd;
  const cmdStr = payload.command.trim();
  const baseLower = path.basename(cmdStr).toLowerCase();
  if (baseLower === cmd) return cmd;
  const firstToken = cmdStr.includes(' ') ? cmdStr.split(/\s+/)[0] : cmdStr;
  return path.basename(firstToken ?? cmdStr).toLowerCase();
}

export function buildSystemCommandContext(ctx: ExecutionContext): SystemCommandDerived {
  const { cmdBasename, payload, args } = ctx;
  const isCommand = payload.type === 'command';
  const payloadCmdTrim = 'command' in payload && typeof payload.command === 'string' ? payload.command.trim() : '';
  const isIntactExecutablePath = payloadCmdTrim.length > 0
    && !payloadCmdTrim.toLowerCase().startsWith(`${cmdBasename.toLowerCase()} `)
    && path.basename(payloadCmdTrim).toLowerCase() === cmdBasename.toLowerCase();
  const rawCmdStr = payloadCmdTrim.includes(' ') && !isIntactExecutablePath
    ? payloadCmdTrim
    : cmdBasename.trim();
  const embeddedArgs = rawCmdStr.includes(' ') && !isIntactExecutablePath ? rawCmdStr.split(/\s+/).slice(1) : [];
  const combinedArgs = [...embeddedArgs, ...args];
  const positionalArgs = getPositionalArgs(cmdBasename, combinedArgs);
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();
  const originalCmd = resolveOriginalCmd(payload, cmd);
  return { cmdBasename, payload, args, isCommand, embeddedArgs, positionalArgs, hasStdin, cmd, originalCmd };
}

export function isPwshCommandFlag(head: string): boolean {
  return head === '-c' || (head.length >= 4 && '-command'.startsWith(head));
}

export function isPwshFileFlag(head: string): boolean {
  return head === '-f' || (head.length >= 3 && '-file'.startsWith(head));
}

export function isPwshEncodedCommandFlag(head: string): boolean {
  return head === '-e' || head === '-ec' || (head.length >= 3 && '-encodedcommand'.startsWith(head));
}

export function isPwshInlineStopFlag(head: string): boolean {
  return isPwshCommandFlag(head) || isPwshEncodedCommandFlag(head);
}

const PWSH_VALUE_FLAGS = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-configurationfile', '-settingsfile',
  '-custompipename', '-windowstyle', '-w',
]);
const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const POSIX_SHELL_NAMES = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe']);
const PWSH_SHELL_NAMES = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);

export function findPosixShellCAndBody(args: readonly string[]): { flagIdx: number; bodyIdx: number } {
  let flagIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') {
      return flagIdx !== -1
        ? { flagIdx, bodyIdx: i + 1 < args.length ? i + 1 : -1 }
        : { flagIdx: -1, bodyIdx: -1 };
    }
    if (a === '--rcfile' || a === '--init-file') {
      i++;
      continue;
    }
    if (!a.startsWith('--') && /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/.test(a)) {
      if (flagIdx === -1 && a.startsWith('-') && a.slice(1).includes('c')) flagIdx = i;
      i++;
      continue;
    }
    if (a === '-c' || a === '--command' || (/^-[a-zA-Z]+$/.test(a) && a.includes('c'))) {
      if (flagIdx === -1) flagIdx = i;
      continue;
    }
    if (a.startsWith('-') || a.startsWith('+')) continue;
    return flagIdx !== -1 ? { flagIdx, bodyIdx: i } : { flagIdx: -1, bodyIdx: -1 };
  }
  return { flagIdx, bodyIdx: -1 };
}

export function resolveInlineCommand(args: string[], cmdBasename = ''): InlineCommand {
  const lowerCmd = cmdBasename.toLowerCase();
  const isPosixShell = POSIX_SHELL_NAMES.has(lowerCmd);
  if (isPosixShell) {
    const { flagIdx, bodyIdx } = findPosixShellCAndBody(args);
    if (flagIdx === -1) return { hasInlineCmd: false, inlineFlag: '', innerCmdStr: '' };
    const inlineFlag = (args[flagIdx] ?? '').toLowerCase();
    const restArgs = (bodyIdx !== -1 ? args.slice(bodyIdx) : []).filter(a => a.length > 0);
    return {
      hasInlineCmd: true,
      inlineFlag,
      innerCmdStr: restArgs.length > 1 ? restArgs.join(' ') : (restArgs[0] ?? ''),
    };
  }
  const isPwshShell = PWSH_SHELL_NAMES.has(lowerCmd);
  const isCmdShell = lowerCmd === 'cmd' || lowerCmd === 'cmd.exe';
  const isWslCmd = lowerCmd === 'wsl' || lowerCmd === 'wsl.exe';
  let inlineIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    if (low === '--') break;
    if (isWslCmd && WSL_VALUE_FLAGS.has(low)) { i++; continue; }
    if (isPwshShell) {
      const colonIdx = low.indexOf(':');
      const pwshHead = colonIdx !== -1 ? low.slice(0, colonIdx) : low;
      if (pwshHead === '-version') {
        const nextTok = colonIdx !== -1 ? low.slice(colonIdx + 1) : (args[i + 1] ?? '');
        if (colonIdx === -1 && /^\d+(?:\.\d+)*$/.test(nextTok)) i++;
        continue;
      }
      if (colonIdx === -1 && PWSH_VALUE_FLAGS.has(pwshHead)) { i++; continue; }
      if (isPwshFileFlag(pwshHead)) break;
      if (isPwshInlineStopFlag(pwshHead)) { inlineIdx = i; break; }
      if (!low.startsWith('-')) break;
      continue;
    }
    const isMatch = isCmdShell
      ? /^\/c(?:$|[=:])/i.test(low)
      : (isWslCmd ? (low === '-e' || low === '--exec') : INLINE_FLAGS.includes(low));
    if (isMatch) { inlineIdx = i; break; }
    if (!low.startsWith('-') && !(isCmdShell && low.startsWith('/'))) {
      break;
    }
  }
  if (inlineIdx === -1) {
    return { hasInlineCmd: false, inlineFlag: '', innerCmdStr: '' };
  }
  const flagArg = args[inlineIdx];
  const rawLower = flagArg !== undefined ? flagArg.toLowerCase() : '';
  const delimIdx = isPwshShell ? rawLower.indexOf(':') : (isCmdShell && rawLower.length > 2 ? 2 : -1);
  const inlineFlag = delimIdx !== -1 ? rawLower.slice(0, delimIdx) : rawLower;
  const inlineColonVal = delimIdx !== -1 && flagArg !== undefined ? flagArg.slice(delimIdx + 1) : '';
  const trailingArgs = args.slice(inlineIdx + 1);
  const restArgs = (inlineColonVal.length > 0 ? [inlineColonVal, ...trailingArgs] : trailingArgs).filter(a => a.length > 0);
  const innerCmdStr = restArgs.length > 1 ? restArgs.join(' ') : (restArgs[0] ?? '');
  return {
    hasInlineCmd: true,
    inlineFlag,
    innerCmdStr,
  };
}
