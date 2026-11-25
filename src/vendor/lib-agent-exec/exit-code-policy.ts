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

const SHELL_EVAL_INTERPRETERS = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'ps1', 'cmd', 'cmd.exe', 'bat']);
const GIT_GLOBAL_VALUE_FLAGS = new Set(['-c', '-C', '--attr-source', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env']);

function commandBasename(command: string): string {
  return path.basename(command).toLowerCase();
}

function splitUnquotedTokens(segment: string, isWindowsShell = false): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === undefined) continue;
    if (escape) { current += ch; escape = false; continue; }
    if (!isWindowsShell && ch === '\\' && quote !== "'") { escape = true; continue; }
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

function splitUnquotedOperators(segment: string, op: '||' | '&&' | '|', isWindowsShell = false): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escape = false;
  let start = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escape) { escape = false; continue; }
    if (!isWindowsShell && ch === '\\' && quote !== "'") { escape = true; continue; }
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

function stripUnquotedHashComments(rawScript: string, isWindowsShell = false): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < rawScript.length; i++) {
    const ch = rawScript[i];
    if (ch === undefined) continue;
    if (escape) { out += ch; escape = false; continue; }
    if (!isWindowsShell && ch === '\\' && quote !== "'") { out += ch; escape = true; continue; }
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

const PRIOR_EARLY_EXIT_RE = /\b(?:set\s+(?:-[a-zA-Z]*[eu]|-o\s+(?:errexit|pipefail|nounset))|exit|return|throw)\b|\$ErrorActionPreference\s*=\s*['"]?Stop['"]?/i;

function splitUnquotedStatements(rawScript: string, isWindowsShell = false): string[] {
  const commentFree = stripUnquotedHashComments(rawScript, isWindowsShell);
  const stmts: string[] = [];
  let quote: '"' | "'" | null = null;
  let escape = false;
  let start = 0;
  for (let i = 0; i < commentFree.length; i++) {
    const ch = commentFree[i];
    if (escape) { escape = false; continue; }
    if (!isWindowsShell && ch === '\\' && quote !== "'") { escape = true; continue; }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; continue; }
    if (ch === quote) { quote = null; continue; }
    if (quote !== null) continue;
    if (ch === ';') {
      const piece = commentFree.slice(start, i).trim();
      if (piece.length > 0) stmts.push(piece);
      start = i + 1;
    } else if (ch === '\n') {
      const piece = commentFree.slice(start, i).trim();
      if (piece.length > 0 && !LINE_CONT_END_RE.test(piece)) {
        stmts.push(piece);
        start = i + 1;
      }
    } else if (ch === '&') {
      const prev = commentFree[i - 1];
      const next = commentFree[i + 1];
      if (prev !== '&' && next !== '&' && prev !== '>' && prev !== '<' && next !== '>') {
        const piece = commentFree.slice(start, i).trim();
        if (piece.length > 0) stmts.push(piece);
        start = i + 1;
      }
    }
  }
  const last = commentFree.slice(start).trim();
  if (last.length > 0) stmts.push(last);
  return stmts;
}

function extractFinalShellSegment(rawScript: string, isWindowsShell = false, implicitStopOnError = false): string {
  const stmts = splitUnquotedStatements(rawScript, isWindowsShell);
  if (stmts.length > 1) {
    const prior = stmts.slice(0, -1);
    if (prior.some(stmt => PRIOR_EARLY_EXIT_RE.test(stmt) || (implicitStopOnError && !BENIGN_AND_SETUP_RE.test(stmt.trim())))) {
      return '';
    }
  }
  const lastStmt = stmts[stmts.length - 1] ?? '';
  if (lastStmt.length === 0) return '';
  const orParts = splitUnquotedOperators(lastStmt, '||', isWindowsShell);
  const activeBranch = (orParts[orParts.length - 1] ?? '').trim();
  const andParts = splitUnquotedOperators(activeBranch, '&&', isWindowsShell);
  for (let i = 0; i < andParts.length - 1; i++) {
    const prefix = (andParts[i] ?? '').trim();
    if (PRIOR_EARLY_EXIT_RE.test(prefix) || !BENIGN_AND_SETUP_RE.test(prefix)) return '';
  }
  const finalChain = (andParts[andParts.length - 1] ?? '').trim();
  const pipeParts = splitUnquotedOperators(finalChain, '|', isWindowsShell);
  return (pipeParts[pipeParts.length - 1] ?? '').trim();
}

const LINE_CONT_END_RE = /(?:&&|\|\||[|\\])$/;
const POSIX_SHORT_EU_RE = /^-[a-zA-Z]*[eu]/;
const POSIX_SHORT_O_CLUSTER_RE = /^-[a-zA-Z]*[oO][a-zA-Z]*$/;
const POSIX_SIGNED_O_CLUSTER_RE = /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/;
const POSIX_STRICT_OPTION_RE = /^(?:errexit|pipefail|nounset)$/i;
const POSIX_SHORT_C_CLUSTER_RE = /^-[a-zA-Z]*c[a-zA-Z]*$/;
const POSIX_WRAPPER_SHELLS = new Set(['bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe']);
const WIN_PWSH_SHELLS = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'ps1']);
const PWSH_WRAPPER_VALUE_FLAGS = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-settingsfile', '-custompipename',
]);
const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);

function extractPosixShellScriptText(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') return null;
    if (POSIX_SHORT_EU_RE.test(a) && !a.startsWith('--')) return null;
    if (a.startsWith('-') && !a.startsWith('--') && POSIX_SHORT_O_CLUSTER_RE.test(a) && a.includes('c')) {
      if (a.includes('o') && POSIX_STRICT_OPTION_RE.test(args[i + 1] ?? '')) return null;
      return args[i + 2] ?? '';
    }
    if (POSIX_SIGNED_O_CLUSTER_RE.test(a)) {
      if (a.startsWith('-') && a.includes('o') && POSIX_STRICT_OPTION_RE.test(args[i + 1] ?? '')) return null;
      i += 1;
      continue;
    }
    if (a === '-c' || (a.startsWith('-') && !a.startsWith('--') && POSIX_SHORT_C_CLUSTER_RE.test(a))) {
      return args[i + 1] ?? '';
    }
    if (!a.startsWith('-') && !a.startsWith('+')) return null;
  }
  return null;
}

function extractPwshScriptText(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    const low = a.toLowerCase();
    const colonIdx = low.indexOf(':');
    const head = colonIdx === -1 ? low : low.slice(0, colonIdx);
    if (head === '--' || head === '-f' || head === '-file' || head === '-ec' || head === '-encodedcommand' || head === '-en') {
      return null;
    }
    if (colonIdx === -1 && head === '-version' && /^\d+(?:\.\d+)*$/.test(args[i + 1] ?? '')) { i += 1; continue; }
    if (colonIdx === -1 && PWSH_WRAPPER_VALUE_FLAGS.has(head)) { i += 1; continue; }
    if (head === '-c' || head === '-command') {
      const rest = args.slice(i + 1).join(' ');
      if (colonIdx === -1) return rest;
      const inline = a.slice(colonIdx + 1);
      return rest.length > 0 ? `${inline} ${rest}` : inline;
    }
    if (!a.startsWith('-')) return null;
  }
  return null;
}

function extractWslInnerTokens(args: readonly string[]): string[] {
  const tokens: string[] = [];
  let afterExecOrDd = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (afterExecOrDd) { tokens.push(a); continue; }
    if (a === '--' || a === '-e' || a === '--exec') { afterExecOrDd = true; continue; }
    if (WSL_VALUE_FLAGS.has(a)) { i += 1; continue; }
    if (a.startsWith('-')) continue;
    tokens.push(...args.slice(i));
    break;
  }
  return tokens;
}

function extractWrapperFinalTokens(cmd: string, args: readonly string[]): { tool: string; args: string[] } | null {
  if (cmd === 'wsl' || cmd === 'wsl.exe') {
    const inner = extractWslInnerTokens(args);
    const first = inner[0];
    if (first === undefined) return null;
    const innerBase = commandBasename(first);
    if (POSIX_WRAPPER_SHELLS.has(innerBase)) {
      const innerScript = extractPosixShellScriptText(inner.slice(1));
      if (innerScript === null) return null;
      const tokens = splitUnquotedTokens(extractFinalShellSegment(innerScript, false), false);
      const rawTool = tokens[0];
      return rawTool !== undefined ? { tool: commandBasename(rawTool), args: tokens.slice(1) } : null;
    }
    return { tool: innerBase, args: inner.slice(1) };
  }
  const isWinShell = cmd === 'cmd' || cmd === 'cmd.exe' || WIN_PWSH_SHELLS.has(cmd);
  let scriptText: string | null = null;
  if (POSIX_WRAPPER_SHELLS.has(cmd)) {
    scriptText = extractPosixShellScriptText(args);
  } else if (cmd === 'cmd' || cmd === 'cmd.exe') {
    const cIdx = args.findIndex(a => a.toLowerCase() === '/c');
    const preCmdNonFlag = cIdx > 0 && args.slice(0, cIdx).some(a => !a.startsWith('/'));
    if (cIdx !== -1 && !preCmdNonFlag) scriptText = args.slice(cIdx + 1).join(' ');
  } else if (WIN_PWSH_SHELLS.has(cmd)) {
    scriptText = extractPwshScriptText(args);
  }
  if (scriptText === null) return null;
  const tokens = splitUnquotedTokens(extractFinalShellSegment(scriptText, isWinShell, WIN_PWSH_SHELLS.has(cmd)), isWinShell);
  const rawTool = tokens[0];
  return rawTool !== undefined ? { tool: commandBasename(rawTool), args: tokens.slice(1) } : null;
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
    const rawInterp = (payload.interpreter ?? (payload.target === 'wsl2' ? 'bash' : 'bun')).toLowerCase();
    const rawBase = path.basename(rawInterp);
    const baseInterp = payload.target === 'wsl2' && (rawBase === 'ps1' || rawBase === 'bat') ? 'bash' : rawBase;
    if (!SHELL_EVAL_INTERPRETERS.has(baseInterp)) return null;
    const isPwshEval = WIN_PWSH_SHELLS.has(baseInterp);
    const isWinShell = baseInterp === 'cmd' || baseInterp === 'cmd.exe' || baseInterp === 'bat' || isPwshEval;
    const tokens = splitUnquotedTokens(extractFinalShellSegment(payload.code, isWinShell, isPwshEval), isWinShell);
    if (tokens.length === 0) return null;
    const rawTool = tokens[0] ?? '';
    return { tool: commandBasename(rawTool), args: tokens.slice(1) };
  }
  if (payload.type !== 'command') return null;
  const cmd = commandBasename(payload.command);
  const args = payload.args ?? [];
  if (WRAPPER_BASENAMES.has(cmd)) return extractWrapperFinalTokens(cmd, args);
  return { tool: cmd, args };
}

const NPM_PNPM_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '--dir', '--prefix', '--filter', '-F',
  '--loglevel', '--registry', '--config', '--userconfig', '--globalconfig', '--cache', '--store-dir', '--reporter',
]);

function stderrHasShellOrFsError(stderr: string): boolean {
  return stderr.includes('fatal:') || stderr.includes('mkdir:') ||
    stderr.includes('Permission denied') || stderr.includes('No such file or directory') || stderr.includes('cd:') ||
    stderr.includes('Set-Location:') || stderr.includes('New-Item:') ||
    stderr.includes('Cannot find path') ||
    stderr.includes('The system cannot find the path specified') ||
    stderr.includes('The system cannot find the file specified') ||
    stderr.includes('Access is denied') || stderr.includes('Access to the path') ||
    stderr.includes('A subdirectory or file') ||
    stderr.includes('is not recognized') ||
    stderr.includes('command not found') ||
    stderr.includes(': not found');
}

function stderrBlocksGrep(stderr: string): boolean {
  return stderrHasShellOrFsError(stderr) || stderr.includes('grep:') || stderr.includes('rg:') ||
    stderr.includes('error:') || stderr.includes('Error:') || stderr.includes('usage:');
}

function stderrBlocksDiff(stderr: string): boolean {
  return stderrHasShellOrFsError(stderr) || stderr.includes('diff:') ||
    stderr.includes('error:') || stderr.includes('Error:') || stderr.includes('usage:');
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
