// @ts-nocheck
import path from 'node:path';
import { buildNonCodeSpans, isIndexInSpans } from './quote-spans.js';
import { healModuleImports, type HealModuleImportOptions } from './path-module-healer.js';
import { healSingleEvalPath, isPosixSystemPath } from './path-eval-path.js';
import { logPathHeal } from './path-healer.js';

type HealTarget = 'windows' | 'wsl2';
type NonCodeSpans = ReturnType<typeof buildNonCodeSpans>;

const TOKEN_RE = /([^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`|\s+)/g;
const DIR_TOOLS: ReadonlySet<string> = new Set(['ls', 'dir', 'rm', 'cp', 'mv', 'mkdir', 'chmod']);
const RUNNER_SUBCOMMANDS: ReadonlySet<string> = new Set(['run', 'test', 'exec', 'x', 'dev', 'start', 'build']);

function healEvalMcpConfig(code: string): string {
  if (!code.includes('.gemini/mcp_config.json') && !code.includes('.gemini\\mcp_config.json')) return code;
  if (code.includes('antigravity-ide') || code.includes('.gemini/config')) return code;
  console.error(`\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path in eval code to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`);
  return code.replace(/\.gemini[\\/]mcp_config\.json/g, '.gemini/antigravity-ide/mcp_config.json');
}

function quoteWrap(token: string, healed: string): string {
  const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
  return `${quote}${healed}${quote}`;
}

function healFileToolToken(token: string, isDirTool: boolean, cmdWord: string, cwd: string, target: HealTarget | undefined): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '').replace(/[\\/]+$/, '');
  if (isDirTool && !cleanPath.includes('/') && !cleanPath.includes('\\') && !cleanPath.includes('.')) return null;
  const healed = healSingleEvalPath(trimmed, isDirTool, cwd, target);
  if (healed === null || healed === trimmed) return null;
  const isBarrel = /(?:^|[/\\])index\.[jt]sx?$/i.test(healed) && !/(?:^|[/\\])index\.[jt]sx?$/i.test(trimmed);
  const hint = isBarrel
    ? `Path '${trimmed}' in eval code not found on disk, but barrel '${healed}' exists.`
    : `Path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`;
  logPathHeal(hint, `Auto-correcting eval command to '${cmdWord} ... ${healed}'... (Frictionless Recovery)`);
  return quoteWrap(token, healed);
}

function healInspectionMatch(fullMatch: string, cmdWord: string, restArgs: string, offset: number, spans: NonCodeSpans, cwd: string, target: HealTarget | undefined): string {
  if (isIndexInSpans(spans, offset)) return fullMatch;
  const isDirTool = DIR_TOOLS.has(cmdWord.toLowerCase());
  const tokens = restArgs.match(TOKEN_RE) ?? [];
  let modified = false;
  const healedTokens = tokens.map((token) => {
    const healed = healFileToolToken(token, isDirTool, cmdWord, cwd, target);
    if (healed === null) return token;
    modified = true;
    return healed;
  });
  if (!modified) return fullMatch;
  return `${cmdWord}${healedTokens.join('')}`;
}

function healEvalFileTools(code: string, cwd: string, target: HealTarget | undefined): string {
  const fileInspectionRegex = /(?:^|(?<=[;&|\n]))\s*(cat|head|tail|wc|ls|dir|rm|cp|mv|touch|mkdir|chmod|diff)\b([^;&|\n]*)/gi;
  const spans = buildNonCodeSpans(code);
  return code.replace(fileInspectionRegex, (fullMatch: string, cmdWord: string, restArgs: string, offset: number) => {
    return healInspectionMatch(fullMatch, cmdWord, restArgs, offset, spans, cwd, target);
  });
}

function healEvalSearchTools(code: string, cwd: string, target: HealTarget | undefined): string {
  const searchMatchRegex = /\b(grep|egrep|fgrep|rg)\s+((?:-[^\s"'`;&|]+\s+)*)(?:(-e\s+(?:"[^"]*"|'[^']*'|[^\s]+)\s+)|(?:("[^"]*"|'[^']*'|[^\s]+)\s+))([^\s"'`;&|]+)/g;
  return code.replace(searchMatchRegex, (fullMatch: string, cmdWord: string, flagsPart: string, optE: string | undefined, optPattern: string | undefined, targetPath: string) => {
    const patternPart = (optE ?? optPattern ?? '').trim();
    const cleanTargetPath = targetPath.replace(/[\\/]+$/, '');
    if (path.extname(cleanTargetPath).length === 0 && !cleanTargetPath.includes('/') && !cleanTargetPath.includes('\\')) return fullMatch;
    const healed = healSingleEvalPath(targetPath, true, cwd, target);
    if (healed === null) return fullMatch;
    logPathHeal(`Search path '${targetPath}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting search path in eval command to '${healed}'... (Frictionless Recovery)`);
    return `${cmdWord} ${flagsPart}${patternPart} ${healed}`;
  });
}

function healEvalPowerShell(code: string, cwd: string, target: HealTarget | undefined): string {
  const psCmdletRegex = /\b(Get-Content|gc|type|Get-ChildItem|gci)\s+((?:-[^\s"'`;&|]+\s+)*)([^\s"'`;&|]+)/gi;
  return code.replace(psCmdletRegex, (fullMatch: string, cmdlet: string, flagsPart: string, filePath: string) => {
    const allowDirs = /Get-ChildItem|gci/i.test(cmdlet);
    const healed = healSingleEvalPath(filePath, allowDirs, cwd, target);
    if (healed === null) return fullMatch;
    logPathHeal(`Path '${filePath}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting eval command to '${cmdlet} ${flagsPart}${healed}'... (Frictionless Recovery)`);
    return `${cmdlet} ${flagsPart}${healed}`;
  });
}

function healRunnerToken(token: string, runnerCmd: string, cwd: string, target: HealTarget | undefined): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '');
  if (RUNNER_SUBCOMMANDS.has(cleanPath.toLowerCase())) return null;
  const isPathLike = cleanPath.includes('/') || cleanPath.includes('\\') || /\.(?:ts|js|mjs|cjs|py|json)$/i.test(cleanPath);
  if (!isPathLike) return null;
  const healed = healSingleEvalPath(trimmed, false, cwd, target);
  if (healed === null || healed === trimmed) return null;
  logPathHeal(`Script path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting eval command to '${runnerCmd} ... ${healed}'... (Frictionless Recovery)`);
  return quoteWrap(token, healed);
}

function healEvalRunners(code: string, cwd: string, target: HealTarget | undefined): string {
  const runnerRegex = /(?:^|(?<=[;&|\n]))\s*(bun|node|tsx|ts-node|python|python3)\b([^;&|\n]*)/gi;
  return code.replace(runnerRegex, (fullMatch: string, runnerCmd: string, restArgs: string) => {
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    let modified = false;
    const healedTokens = tokens.map((token) => {
      const healed = healRunnerToken(token, runnerCmd, cwd, target);
      if (healed === null) return token;
      modified = true;
      return healed;
    });
    if (!modified) return fullMatch;
    return `${runnerCmd}${healedTokens.join('')}`;
  });
}

function healEvalPathFlag(code: string, cwd: string, target: HealTarget | undefined): string {
  if (target === 'wsl2' || /(?:^|(?<=[;&|\n]))\s*find\b/i.test(code)) return code;
  const pathFlagRegex = /(-Path\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'`;|]+))/gi;
  return code.replace(pathFlagRegex, (fullMatch: string, flagPrefix: string, qDouble: string | undefined, qSingle: string | undefined, unquoted: string | undefined) => {
    const rawPath = qDouble ?? qSingle ?? unquoted ?? '';
    if (rawPath.length === 0 || rawPath.includes('*') || rawPath.includes('?') || isPosixSystemPath(rawPath)) return fullMatch;
    const healed = healSingleEvalPath(rawPath, true, cwd, target);
    if (healed === null) return fullMatch;
    logPathHeal(`-Path '${rawPath}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting -Path in eval command to '${healed}'... (Frictionless Recovery)`);
    const quote = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
    return `${flagPrefix}${quote}${healed}${quote}`;
  });
}

export function healEvalCodePathHallucinations(code: string, cwd: string, target?: HealTarget, options?: HealModuleImportOptions): string {
  let updated = healEvalMcpConfig(code);
  updated = healModuleImports(updated, cwd, target, options);
  updated = healEvalFileTools(updated, cwd, target);
  updated = healEvalSearchTools(updated, cwd, target);
  updated = healEvalPowerShell(updated, cwd, target);
  updated = healEvalRunners(updated, cwd, target);
  return healEvalPathFlag(updated, cwd, target);
}
