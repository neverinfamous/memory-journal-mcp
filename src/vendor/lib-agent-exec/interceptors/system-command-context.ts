// @ts-nocheck
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { getPositionalArgs } from '../command-utils.js';
import type { ExecutionContext } from './types.js';

export const EXACT_SHELL_CHARS: readonly string[] = ['|', '>', '<', '&&', '||', ';'];

export const PATTERN_TOOLS: readonly string[] = [
  'grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe',
  'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'fd', 'fd.exe', 'fdfind', 'fdfind.exe',
  'node', 'node.exe', 'python', 'python.exe', 'bun', 'bun.exe', 'tail', 'tail.exe', 'head', 'head.exe',
  'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe',
];

export const SHELL_NAMES: readonly string[] = [
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe',
];

export const INLINE_FLAGS: readonly string[] = [
  '-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval', '-execute', '--execute',
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

// [INTENT]: Basename of the first command token, so "curl https://example.com" is not classified as example.com.
export function resolveOriginalCmd(payload: ExecPayload, cmd: string): string {
  if (!('command' in payload) || typeof payload.command !== 'string') return cmd;
  const cmdStr = payload.command.trim();
  const firstToken = cmdStr.includes(' ') ? cmdStr.split(/\s+/)[0] : cmdStr;
  return path.basename(firstToken ?? cmdStr).toLowerCase();
}

export function buildSystemCommandContext(ctx: ExecutionContext): SystemCommandDerived {
  const { cmdBasename, payload, args } = ctx;
  const isCommand = payload.type === 'command';
  const rawCmdStr = 'command' in payload && typeof payload.command === 'string' && payload.command.trim().includes(' ')
    ? payload.command.trim()
    : cmdBasename.trim();
  const embeddedArgs = rawCmdStr.includes(' ') ? rawCmdStr.split(/\s+/).slice(1) : [];
  const combinedArgs = [...embeddedArgs, ...args];
  const positionalArgs = getPositionalArgs(cmdBasename, combinedArgs);
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();
  const originalCmd = resolveOriginalCmd(payload, cmd);
  return { cmdBasename, payload, args, isCommand, embeddedArgs, positionalArgs, hasStdin, cmd, originalCmd };
}

const PWSH_INLINE_FLAGS = new Set(['-c', '-command', '-ec', '-encodedcommand', '-en']);
const POSIX_SHELL_NAMES = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe']);
const PWSH_SHELL_NAMES = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);

export function resolveInlineCommand(args: string[], cmdBasename = ''): InlineCommand {
  const lowerCmd = cmdBasename.toLowerCase();
  const isPosixShell = POSIX_SHELL_NAMES.has(lowerCmd);
  const isPwshShell = PWSH_SHELL_NAMES.has(lowerCmd);
  const isCmdShell = lowerCmd === 'cmd' || lowerCmd === 'cmd.exe';
  let inlineIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    if (low === '--') break;
    if (isPosixShell && (low === '-o' || low === '+o')) { i++; continue; }
    if (isPwshShell && (low === '-file' || low === '-f')) break;
    const isMatch = isPosixShell
      ? (low === '-c' || (/^-[a-z]+$/.test(low) && low.includes('c')))
      : isPwshShell
        ? PWSH_INLINE_FLAGS.has(low)
        : isCmdShell
          ? low === '/c'
          : INLINE_FLAGS.includes(low);
    if (isMatch) { inlineIdx = i; break; }
    if (!low.startsWith('-') && !(isCmdShell && low.startsWith('/')) && !(isPosixShell && low.startsWith('+'))) {
      break;
    }
  }
  if (inlineIdx === -1) {
    return { hasInlineCmd: false, inlineFlag: '', innerCmdStr: '' };
  }
  const flagArg = args[inlineIdx];
  const restArgs = args.slice(inlineIdx + 1).filter(a => a.length > 0);
  const inlineFlag = flagArg !== undefined ? flagArg.toLowerCase() : '';
  const innerCmdStr = restArgs.length > 1 ? restArgs.join(' ') : (restArgs[0] ?? '');
  return {
    hasInlineCmd: true,
    inlineFlag,
    innerCmdStr,
  };
}
