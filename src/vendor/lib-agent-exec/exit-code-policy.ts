// @ts-nocheck
import path from 'node:path';
import type { ExecPayload } from './schema.js';

export interface ExitCodeAnalysis {
  isGrepNoMatch: boolean;
  isGrepMatchesFound: boolean;
  isDiffFound: boolean;
  isOutdatedInfo: boolean;
  isLsNoMatch: boolean;
  isRmNoMatch: boolean;
  isFindNoMatch: boolean;
}

const NO_HEAL: ExitCodeAnalysis = {
  isGrepNoMatch: false,
  isGrepMatchesFound: false,
  isDiffFound: false,
  isOutdatedInfo: false,
  isLsNoMatch: false,
  isRmNoMatch: false,
  isFindNoMatch: false,
};

const GREP_BASENAMES = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'rg', 'rg.exe']);
const DIFF_BASENAMES = new Set(['diff', 'diff.exe']);
const OUTDATED_BASENAMES = new Set(['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe']);
const WRAPPER_BASENAMES = new Set([
  'wsl', 'wsl.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'cmd', 'cmd.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe',
]);

function commandBasename(command: string): string {
  return path.basename(command).toLowerCase();
}

function invocationText(payload: ExecPayload): string {
  if (payload.type === 'command') {
    const args = payload.args !== undefined ? payload.args.join(' ') : '';
    return `${payload.command} ${args}`.toLowerCase();
  }
  if (payload.type === 'eval') return payload.code.toLowerCase();
  return '';
}

function stderrBlocksGrep(stderr: string): boolean {
  return stderr.includes('fatal:') || stderr.includes('grep:');
}

function stderrBlocksDiff(stderr: string): boolean {
  return stderr.includes('No such file or directory') || stderr.includes('diff:');
}

function stderrBlocksOutdated(stderr: string): boolean {
  return stderr.includes('ERR_PNPM') || stderr.includes('npm ERR!') || stderr.includes('error:') || stderr.includes('Error:');
}

const TOOL_BOUNDARY = /(?:^|[|;&\n]\s*|\b(?:wsl|bash|sh|cmd|pwsh|powershell)(?:\.exe)?\s+)(?:\S*\/)?/;

function hasWrappedTool(text: string, tool: string): boolean {
  return new RegExp(`${TOOL_BOUNDARY.source}(?:${tool})\\b`).test(text);
}

function matchesGrep(payload: ExecPayload, text: string): boolean {
  if (payload.type === 'command') {
    const cmd = commandBasename(payload.command);
    if (GREP_BASENAMES.has(cmd)) return true;
    if (cmd === 'git' || cmd === 'git.exe') return /\bgit(?:\.exe)?\s+(?:-\S+\s+)*grep\b/.test(text);
    if (!WRAPPER_BASENAMES.has(cmd)) return false;
  }
  return hasWrappedTool(text, 'grep|egrep|rg') || /\bgit(?:\.exe)?\s+(?:-\S+\s+)*grep\b/.test(text);
}

function matchesDiff(payload: ExecPayload, text: string): boolean {
  if (payload.type === 'command') {
    const cmd = commandBasename(payload.command);
    if (DIFF_BASENAMES.has(cmd)) return true;
    if (cmd === 'git' || cmd === 'git.exe') return /\bgit(?:\.exe)?\s+(?:-\S+\s+)*diff\b/.test(text);
    if (!WRAPPER_BASENAMES.has(cmd)) return false;
  }
  return hasWrappedTool(text, 'diff') || /\bgit(?:\.exe)?\s+(?:-\S+\s+)*diff\b/.test(text);
}

function matchesOutdated(payload: ExecPayload, text: string): boolean {
  if (payload.type === 'command') {
    const cmd = commandBasename(payload.command);
    if (OUTDATED_BASENAMES.has(cmd)) {
      const args = (payload.args ?? []).filter((arg) => !arg.startsWith('-')).map((arg) => arg.toLowerCase());
      const sub = args.find((arg) => arg !== 'run' && arg !== 'exec' && arg !== 'x' && arg !== 'dlx');
      return sub === 'outdated';
    }
    if (WRAPPER_BASENAMES.has(cmd)) return /(?:npm|pnpm)\s+(?:--?\w+\s+)*outdated\b/.test(text);
    return false;
  }
  return /(?:^|[|;&\n]\s*)(?:npm|pnpm)\s+(?:--?\w+\s+)*outdated\b/.test(text);
}

/**
 * [INVARIANT]: Only exit code 1 from grep, egrep, rg, diff, git diff, and npm/pnpm outdated
 * is a non-match or informational success. Exit codes >= 2 are never rewritten.
 */
export function analyzeExitCode1(
  payload: ExecPayload,
  code: number,
  _stdout: string,
  stderr: string,
): ExitCodeAnalysis {
  if (code !== 1) return { ...NO_HEAL };
  const text = invocationText(payload);
  return {
    isGrepNoMatch: matchesGrep(payload, text) && !stderrBlocksGrep(stderr),
    isGrepMatchesFound: false,
    isDiffFound: matchesDiff(payload, text) && !stderrBlocksDiff(stderr),
    isOutdatedInfo: matchesOutdated(payload, text) && !stderrBlocksOutdated(stderr),
    isLsNoMatch: false,
    isRmNoMatch: false,
    isFindNoMatch: false,
  };
}
