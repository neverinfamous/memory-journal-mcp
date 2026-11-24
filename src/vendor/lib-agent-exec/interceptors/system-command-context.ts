// @ts-nocheck
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { getPositionalArgs } from '../command-utils.js';
import type { ExecutionContext } from './types.js';

export const EXACT_SHELL_CHARS: readonly string[] = ['|', '>', '<', '&&', '||', ';'];

export const PATTERN_TOOLS: readonly string[] = [
  'grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe',
  'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'fd', 'fd.exe', 'fdfind', 'fdfind.exe',
  'node', 'node.exe', 'python', 'python.exe', 'tail', 'tail.exe', 'head', 'head.exe',
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

const PWSH_INLINE_FLAGS = new Set(['-c', '-command', '-ec', '-encodedcommand', '-en']);
const PWSH_VALUE_FLAGS = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-settingsfile', '-custompipename',
]);
const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const POSIX_SHELL_NAMES = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe']);
const PWSH_SHELL_NAMES = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);

export function resolveInlineCommand(args: string[], cmdBasename = ''): InlineCommand {
  const lowerCmd = cmdBasename.toLowerCase();
  const isPosixShell = POSIX_SHELL_NAMES.has(lowerCmd);
  const isPwshShell = PWSH_SHELL_NAMES.has(lowerCmd);
  const isCmdShell = lowerCmd === 'cmd' || lowerCmd === 'cmd.exe';
  const isWslCmd = lowerCmd === 'wsl' || lowerCmd === 'wsl.exe';
  let inlineIdx = -1;
  let skipOptArgIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    if (low === '--') break;
    const rawArg = args[i] ?? '';
    if (isPosixShell && (rawArg === '--rcfile' || rawArg === '--init-file' || /^[-+][a-zA-Z]*[oO]$/.test(rawArg))) {
      if (rawArg.startsWith('-') && !rawArg.startsWith('--') && rawArg.includes('c')) { inlineIdx = i; skipOptArgIdx = i + 1; break; }
      i++;
      continue;
    }
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
      if (pwshHead === '-file' || pwshHead === '-f') break;
      if (PWSH_INLINE_FLAGS.has(pwshHead)) { inlineIdx = i; break; }
      if (!low.startsWith('-')) break;
      continue;
    }
    if (isPosixShell && !rawArg.startsWith('--') && /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/.test(rawArg)) {
      const oPos = Math.max(rawArg.search(/[oO]/), 1);
      const beforeOptArg = rawArg.slice(0, oPos + 1);
      if (rawArg.startsWith('-') && beforeOptArg.includes('c')) {
        inlineIdx = i;
        skipOptArgIdx = i + 1;
        break;
      }
      if (oPos < rawArg.length - 1) {
        if (rawArg.startsWith('-') && rawArg.slice(1).includes('c')) { inlineIdx = i; skipOptArgIdx = i + 1; break; }
        continue;
      }
      i++;
      continue;
    }
    const isMatch = isPosixShell
      ? (rawArg === '-c' || (/^-[a-zA-Z]+$/.test(rawArg) && rawArg.includes('c')))
      : isCmdShell
        ? low === '/c'
        : (isWslCmd ? (low === '-e' || low === '--exec') : INLINE_FLAGS.includes(low));
    if (isMatch) { inlineIdx = i; break; }
    if (!low.startsWith('-') && !(isCmdShell && low.startsWith('/')) && !(isPosixShell && low.startsWith('+'))) {
      break;
    }
  }
  if (inlineIdx === -1) {
    return { hasInlineCmd: false, inlineFlag: '', innerCmdStr: '' };
  }
  const flagArg = args[inlineIdx];
  const rawLower = flagArg !== undefined ? flagArg.toLowerCase() : '';
  const pwshColon = isPwshShell ? rawLower.indexOf(':') : -1;
  const inlineFlag = pwshColon !== -1 ? rawLower.slice(0, pwshColon) : rawLower;
  const inlineColonVal = pwshColon !== -1 && flagArg !== undefined ? flagArg.slice(pwshColon + 1) : '';
  const trailingArgs = args.slice(inlineIdx + 1).filter((_, idx) => inlineIdx + 1 + idx !== skipOptArgIdx);
  const restArgs = (inlineColonVal.length > 0 ? [inlineColonVal, ...trailingArgs] : trailingArgs).filter(a => a.length > 0);
  const innerCmdStr = restArgs.length > 1 ? restArgs.join(' ') : (restArgs[0] ?? '');
  return {
    hasInlineCmd: true,
    inlineFlag,
    innerCmdStr,
  };
}
