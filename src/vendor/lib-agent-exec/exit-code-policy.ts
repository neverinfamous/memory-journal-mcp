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

const SHELL_EVAL_INTERPRETERS = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']);
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

function commandBasename(command: string): string {
  return path.basename(command).toLowerCase();
}

function splitUnquotedTokens(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === undefined) continue;
    if (escape) { current += ch; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; continue; }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; continue; }
    if (ch === quote) { quote = null; continue; }
    if (/\s/.test(ch) && quote === null) {
      if (current.length > 0) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

const BENIGN_AND_SETUP_RE = /^(?:cd|export|shopt|mkdir|true)\b/;

function splitUnquotedOperators(segment: string, op: '||' | '&&' | '|'): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escape = false;
  let start = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; continue; }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; continue; }
    if (ch === quote) { quote = null; continue; }
    if (quote !== null) continue;
    if (segment.startsWith(op, i)) {
      if (op === '|' && segment[i + 1] === '|') { i++; continue; }
      parts.push(segment.slice(start, i));
      i += op.length - 1;
      start = i + 1;
    }
  }
  parts.push(segment.slice(start));
  return parts;
}

function stripUnquotedHashComments(rawScript: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < rawScript.length; i++) {
    const ch = rawScript[i];
    if (ch === undefined) continue;
    if (escape) { out += ch; escape = false; continue; }
    if (ch === '\\' && quote !== "'") { out += ch; escape = true; continue; }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; out += ch; continue; }
    if (ch === quote) { quote = null; out += ch; continue; }
    if (quote === null && ch === '#') {
      const prev = i === 0 ? '\n' : (rawScript[i - 1] ?? '');
      if (i === 0 || /[\s;|&()]/.test(prev)) {
        while (i < rawScript.length && rawScript[i] !== '\n') i++;
        if (rawScript[i] === '\n') out += '\n';
        continue;
      }
    }
    out += ch;
  }
  return out;
}

const PRIOR_EARLY_EXIT_RE = /\b(?:set\s+(?:-[a-zA-Z]*[eu]|-o\s+(?:errexit|pipefail|nounset))|exit|return)\b|\$ErrorActionPreference\s*=\s*['"]?Stop['"]?/i;

function splitUnquotedStatements(rawScript: string): string[] {
  const commentFree = stripUnquotedHashComments(rawScript);
  const stmts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escape = false;
  let start = 0;
  for (let i = 0; i < commentFree.length; i++) {
    const ch = commentFree[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && quote !== "'") { escape = true; continue; }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; continue; }
    if (ch === quote) { quote = null; continue; }
    if (quote !== null) continue;
    if (ch === ';' || ch === '\n') {
      const piece = commentFree.slice(start, i).trim();
      if (piece.length > 0) stmts.push(piece);
      start = i + 1;
    }
  }
  const last = commentFree.slice(start).trim();
  if (last.length > 0) stmts.push(last);
  return stmts;
}

function extractFinalShellSegment(rawScript: string): string {
  const stmts = splitUnquotedStatements(rawScript);
  if (stmts.length > 1 && stmts.slice(0, -1).some(stmt => PRIOR_EARLY_EXIT_RE.test(stmt))) {
    return '';
  }
  const lastStmt = stmts[stmts.length - 1] ?? '';
  if (lastStmt.length === 0) return '';
  const orParts = splitUnquotedOperators(lastStmt, '||');
  const activeBranch = (orParts[orParts.length - 1] ?? '').trim();
  const andParts = splitUnquotedOperators(activeBranch, '&&');
  for (let i = 0; i < andParts.length - 1; i++) {
    const prefix = (andParts[i] ?? '').trim();
    if (PRIOR_EARLY_EXIT_RE.test(prefix) || !BENIGN_AND_SETUP_RE.test(prefix)) return '';
  }
  const finalChain = (andParts[andParts.length - 1] ?? '').trim();
  const pipeParts = splitUnquotedOperators(finalChain, '|');
  return (pipeParts[pipeParts.length - 1] ?? '').trim();
}

function hasWrapperStrictShellFlags(preFlagArgs: readonly string[]): boolean {
  for (let i = 0; i < preFlagArgs.length; i++) {
    const a = preFlagArgs[i];
    if (a === undefined || a === '--') break;
    if (a === '-o' && /^(?:errexit|pipefail|nounset)$/i.test(preFlagArgs[i + 1] ?? '')) return true;
    if (/^-[a-zA-Z]*[eu]/.test(a)) return true;
  }
  return false;
}

function extractGitSubcommand(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') return null;
    if (GIT_GLOBAL_VALUE_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith('-')) continue;
    return arg.toLowerCase();
  }
  return null;
}

function extractFinalTokensFromPayload(payload: ExecPayload): { tool: string; args: string[] } | null {
  if (payload.type === 'eval') {
    const interp = (payload.interpreter ?? (payload.target === 'wsl2' ? 'bash' : 'bun')).toLowerCase();
    const baseInterp = path.basename(interp);
    if (!SHELL_EVAL_INTERPRETERS.has(baseInterp)) return null;
    const tokens = splitUnquotedTokens(extractFinalShellSegment(payload.code));
    if (tokens.length === 0) return null;
    const rawTool = tokens[0] ?? '';
    return { tool: commandBasename(rawTool), args: tokens.slice(1) };
  }
  if (payload.type !== 'command') return null;
  const cmd = commandBasename(payload.command);
  const args = payload.args ?? [];
  if (WRAPPER_BASENAMES.has(cmd)) {
    const cIdx = args.findIndex((a) => a === '-c' || a === '-lc' || /^-[a-zA-Z]*c$/.test(a) || a === '/c' || a.toLowerCase() === '-command');
    const preArgs = cIdx !== -1 ? args.slice(0, cIdx + 1) : args;
    if (hasWrapperStrictShellFlags(preArgs)) return null;
    const scriptText = cIdx !== -1 ? (args[cIdx + 1] ?? '') : args.filter(a => !a.startsWith('-')).join(' ');
    const tokens = splitUnquotedTokens(extractFinalShellSegment(scriptText));
    if (tokens.length === 0) return null;
    const rawTool = tokens[0] ?? '';
    return { tool: commandBasename(rawTool), args: tokens.slice(1) };
  }
  return { tool: cmd, args };
}

const NPM_PNPM_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '--dir', '--prefix', '--filter', '-F',
  '--loglevel', '--registry', '--config', '--userconfig', '--globalconfig', '--cache', '--store-dir', '--reporter',
]);

function stderrHasShellOrFsError(stderr: string): boolean {
  return stderr.includes('fatal:') || stderr.includes('mkdir:') ||
    stderr.includes('Permission denied') || stderr.includes('No such file or directory') || stderr.includes('cd:');
}

function stderrBlocksGrep(stderr: string): boolean {
  return stderrHasShellOrFsError(stderr) || stderr.includes('grep:');
}

function stderrBlocksDiff(stderr: string): boolean {
  return stderrHasShellOrFsError(stderr) || stderr.includes('diff:');
}

function stderrBlocksOutdated(stderr: string): boolean {
  return stderrHasShellOrFsError(stderr) || stderr.includes('ERR_PNPM') || stderr.includes('npm ERR!') || stderr.includes('npm error ') ||
    stderr.includes('error:') || stderr.includes('Error:');
}

function matchesGrep(target: { tool: string; args: string[] } | null): boolean {
  if (target === null) return false;
  if (GREP_BASENAMES.has(target.tool)) return true;
  if (target.tool === 'git' || target.tool === 'git.exe') return extractGitSubcommand(target.args) === 'grep';
  return false;
}

function matchesDiff(target: { tool: string; args: string[] } | null): boolean {
  if (target === null) return false;
  if (DIFF_BASENAMES.has(target.tool)) return true;
  if (target.tool === 'git' || target.tool === 'git.exe') return extractGitSubcommand(target.args) === 'diff';
  return false;
}

function matchesOutdated(target: { tool: string; args: string[] } | null): boolean {
  if (target === null || !OUTDATED_BASENAMES.has(target.tool)) return false;
  const isNpm = /^npm(?:\.cmd|\.exe)?$/i.test(target.tool);
  for (let i = 0; i < target.args.length; i++) {
    const arg = target.args[i];
    if (arg === undefined || arg === '--') return false;
    if (NPM_PNPM_GLOBAL_VALUE_FLAGS.has(arg) || (isNpm && (arg === '-w' || arg === '--workspace'))) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg.toLowerCase() === 'outdated';
  }
  return false;
}

export function isGracefulExitAnalysis(analysis: ExitCodeAnalysis): boolean {
  return analysis.isGrepNoMatch ||
    analysis.isGrepMatchesFound ||
    analysis.isDiffFound ||
    analysis.isOutdatedInfo ||
    analysis.isLsNoMatch ||
    analysis.isRmNoMatch ||
    analysis.isFindNoMatch;
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
  const target = extractFinalTokensFromPayload(payload);
  return {
    isGrepNoMatch: matchesGrep(target) && !stderrBlocksGrep(stderr),
    isGrepMatchesFound: false,
    isDiffFound: matchesDiff(target) && !stderrBlocksDiff(stderr),
    isOutdatedInfo: matchesOutdated(target) && !stderrBlocksOutdated(stderr),
    isLsNoMatch: false,
    isRmNoMatch: false,
    isFindNoMatch: false,
  };
}
