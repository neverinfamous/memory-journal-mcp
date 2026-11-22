// @ts-nocheck
import path from 'node:path';
import { convertToWslPath } from './command-utils.js';
import { buildNonCodeSpans, isIndexInSpans } from './quote-spans.js';
import { healModuleImports, type HealModuleImportOptions } from './path-module-healer.js';
import { healSingleEvalPath, isPosixSystemPath } from './path-eval-path.js';
import { logPathHeal } from './path-healer.js';

type HealTarget = 'windows' | 'wsl2';
type NonCodeSpans = ReturnType<typeof buildNonCodeSpans>;

const TOKEN_RE = /([^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`|\s+)/g;
const READ_DIR_TOOLS: ReadonlySet<string> = new Set(['ls', 'dir']);
const MUTATING_FILE_TOOLS: ReadonlySet<string> = new Set(['rm', 'cp', 'mv', 'touch', 'mkdir', 'chmod']);
const RUNNER_SUBCOMMANDS: ReadonlySet<string> = new Set(['run', 'test', 'exec', 'x', 'dev', 'start', 'build']);

const READONLY_PS_PATH_CMDLETS: ReadonlySet<string> = new Set([
  'get-content', 'gc', 'type', 'get-childitem', 'gci', 'select-string', 'sls',
  'test-path', 'get-item', 'gi', 'resolve-path', 'rvpa', 'get-filehash',
]);
const FILE_TOOL_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  head: new Set(['-n', '--lines', '-c', '--bytes']),
  tail: new Set(['-n', '--lines', '-c', '--bytes', '-s', '--sleep-interval', '--pid', '--max-unchanged-stats']),
  diff: new Set(['-U', '--unified', '-C', '--context', '-W', '--width', '-I', '--ignore-matching-lines', '-S', '--starting-file', '-x', '--exclude', '-X', '--exclude-from']),
};
const RUNNER_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-e', '--eval', '-p', '--print', '-c', '--config', '--env-file', '--outfile', '--outdir',
  '-r', '--preload', '--require', '--import', '--cwd', '-m', '--conditions', '-C', '--filter', '--port',
]);
const RUNNER_ABORT_SUBCMDS: ReadonlySet<string> = new Set([
  'add', 'remove', 'rm', 'install', 'i', 'upgrade', 'update', 'outdated',
  'link', 'unlink', 'pm', 'patch', 'x', 'exec', 'repl', 'publish', 'init', 'create', 'help',
]);
const SHELL_EVAL_INTERPRETER_RE = /^(?:bash|sh|zsh|ash|dash|pwsh|powershell|cmd)(?:\.exe)?$/i;

function emitEvalPathHeal(hint: string, action: string, deferredLogs?: string[]): void {
  if (deferredLogs !== undefined) {
    deferredLogs.push(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: ${action}\x1b[0m`);
    return;
  }
  logPathHeal(hint, action);
}

function isShellRedirectToken(trimmed: string): boolean {
  return trimmed.length > 0 && !/^['"`]/.test(trimmed) && /^(?:\d*>>?|\d*<<?|<&|>&|&>|&>>)(?:\S*)?$/.test(trimmed);
}

function healEvalMcpConfig(code: string, deferredLogs?: string[]): string {
  if (!code.includes('.gemini/mcp_config.json') && !code.includes('.gemini\\mcp_config.json')) return code;
  if (code.includes('antigravity-ide') || code.includes('.gemini/config')) return code;
  const msg = `\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path in eval code to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`;
  if (deferredLogs !== undefined) deferredLogs.push(msg);
  else console.error(msg);
  return code.replace(/\.gemini[\\/]mcp_config\.json/g, '.gemini/antigravity-ide/mcp_config.json');
}

function quoteWrap(token: string, healed: string): string {
  const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
  return `${quote}${healed}${quote}`;
}

function healFileToolToken(token: string, isDirTool: boolean, isMutatingTool: boolean, cmdWord: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  if (isMutatingTool) {
    if (target !== 'wsl2') return null;
    const unquoted = trimmed.replace(/^['"`]|['"`]$/g, '');
    if (/[$`{}|;&<>\n\r]/.test(unquoted) || /\\[$()*?&!`]/.test(unquoted)) return null;
    const isDriveWin = /^[a-zA-Z]:[/\\]/.test(unquoted);
    const isPlainRelWin = unquoted.includes('\\') && /^[a-zA-Z0-9_.\\/-]+$/.test(unquoted);
    if (isDriveWin || isPlainRelWin) {
      const converted = convertToWslPath(unquoted);
      return converted === unquoted ? null : quoteWrap(token, converted);
    }
    return null;
  }
  const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '').replace(/[\\/]+$/, '');
  if (isDirTool && !cleanPath.includes('/') && !cleanPath.includes('\\') && !cleanPath.includes('.')) return null;
  const healed = healSingleEvalPath(trimmed, isDirTool, cwd, target);
  if (healed === null || healed === trimmed) return null;
  const isBarrel = /(?:^|[/\\])index\.[jt]sx?$/i.test(healed) && !/(?:^|[/\\])index\.[jt]sx?$/i.test(trimmed);
  const hint = isBarrel
    ? `Path '${trimmed}' in eval code not found on disk, but barrel '${healed}' exists.`
    : `Path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`;
  emitEvalPathHeal(hint, `Auto-correcting eval command to '${cmdWord} ... ${healed}'... (Frictionless Recovery)`, deferredLogs);
  return quoteWrap(token, healed);
}

const SEARCH_EVAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-t', '--type', '-T', '--type-not', '-g', '--glob', '--iglob',
  '-A', '--after-context', '-B', '--before-context', '-C', '--context',
  '-m', '--max-count', '--exclude', '--exclude-dir', '--exclude-from',
  '--include', '--label', '--color', '--colour', '-E', '--encoding',
  '-M', '--max-columns', '-d', '--max-depth',
]);
const SEARCH_EVAL_PATTERN_FLAGS: ReadonlySet<string> = new Set(['-e', '--regexp', '-f', '--file']);

function healInspectionMatch(fullMatch: string, cmdWord: string, restArgs: string, offset: number, spans: NonCodeSpans, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string {
  if (isIndexInSpans(spans, offset)) return fullMatch;
  const prefixWs = /^\s*/.exec(fullMatch)?.[0] ?? '';
  const lower = cmdWord.toLowerCase();
  const isDirTool = READ_DIR_TOOLS.has(lower);
  const isMutatingTool = MUTATING_FILE_TOOLS.has(lower);
  const valueFlags = Object.hasOwn(FILE_TOOL_VALUE_FLAGS, lower) ? FILE_TOOL_VALUE_FLAGS[lower] : undefined;
  const tokens = restArgs.match(TOKEN_RE) ?? [];
  let modified = false;
  let sawRedirect = false;
  let skipNext = false;
  const healedTokens = tokens.map((token) => {
    const trimmed = token.trim();
    if (trimmed.length === 0 || sawRedirect) return token;
    if (isShellRedirectToken(trimmed)) { sawRedirect = true; return token; }
    if (skipNext) { skipNext = false; return token; }
    if (trimmed.startsWith('-')) {
      const flagKey = trimmed.split('=')[0] ?? trimmed;
      if (!trimmed.includes('=') && valueFlags !== undefined && valueFlags.has(flagKey)) skipNext = true;
      return token;
    }
    const healed = healFileToolToken(token, isDirTool, isMutatingTool, cmdWord, cwd, target, deferredLogs);
    if (healed === null) return token;
    modified = true;
    return healed;
  });
  return modified ? `${prefixWs}${cmdWord}${healedTokens.join('')}` : fullMatch;
}

function healEvalFileTools(code: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string {
  const fileInspectionRegex = /(?:^|(?<=[;&|\n]))\s*(cat|head|tail|wc|ls|dir|rm|cp|mv|touch|mkdir|chmod|diff)\b([^;&|\n#]*)/gi;
  const spans = buildNonCodeSpans(code, { includeHashComments: true });
  return code.replace(fileInspectionRegex, (fullMatch: string, cmdWord: string, restArgs: string, offset: number) => {
    return healInspectionMatch(fullMatch, cmdWord, restArgs, offset, spans, cwd, target, deferredLogs);
  });
}

function healSearchToken(
  token: string,
  state: { seenDoubleDash: boolean; skipNext: boolean; hasPatternFlag: boolean; posCount: number; sawRedirect: boolean },
  cwd: string,
  target: HealTarget | undefined,
  deferredLogs?: string[],
): string | null {
  if (/^\s+$/.test(token) || state.sawRedirect) return null;
  if (isShellRedirectToken(token.trim())) { state.sawRedirect = true; return null; }
  if (state.skipNext) { state.skipNext = false; return null; }
  if (!state.seenDoubleDash && token === '--') { state.seenDoubleDash = true; return null; }
  if (!state.seenDoubleDash && token.startsWith('-')) {
    if (SEARCH_EVAL_PATTERN_FLAGS.has(token)) { state.hasPatternFlag = true; state.skipNext = true; }
    else if (/^-[ef]./.test(token) || /^--(?:regexp|file)=/.test(token)) { state.hasPatternFlag = true; }
    else if (SEARCH_EVAL_VALUE_FLAGS.has(token)) { state.skipNext = true; }
    return null;
  }
  const posIdx = state.posCount++;
  if (!state.hasPatternFlag && posIdx === 0) return null;
  const unquoted = token.replace(/^['"`]|['"`]$/g, '');
  const cleanTargetPath = unquoted.replace(/[\\/]+$/, '');
  if (path.extname(cleanTargetPath).length === 0 && !cleanTargetPath.includes('/') && !cleanTargetPath.includes('\\')) return null;
  const healed = healSingleEvalPath(token, true, cwd, target);
  if (healed === null || healed === unquoted) return null;
  emitEvalPathHeal(`Search path '${token}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting search path in eval command to '${healed}'... (Frictionless Recovery)`, deferredLogs);
  return quoteWrap(token, healed);
}

function healEvalSearchTools(code: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string {
  const searchMatchRegex = /(?:^|(?<=[;&|\n]))\s*(grep|egrep|fgrep|rg)\b([^;&|\n#]*)/g;
  const spans = buildNonCodeSpans(code, { includeHashComments: true });
  return code.replace(searchMatchRegex, (fullMatch: string, cmdWord: string, restArgs: string, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const prefixWs = /^\s*/.exec(fullMatch)?.[0] ?? '';
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const state = { seenDoubleDash: false, skipNext: false, hasPatternFlag: false, posCount: 0, sawRedirect: false };
    let modified = false;
    const healedTokens = tokens.map((token) => {
      const healed = healSearchToken(token, state, cwd, target, deferredLogs);
      if (healed === null) return token;
      modified = true;
      return healed;
    });
    return modified ? `${prefixWs}${cmdWord}${healedTokens.join('')}` : fullMatch;
  });
}

function isLikelyTypeScriptTypeOrJs(code: string, offset: number, cmdlet: string, afterMatch: string): boolean {
  if (cmdlet.toLowerCase() !== 'type') return false;
  const before = code.slice(Math.max(0, offset - 32), offset);
  if (/\b(?:export|import|declare)\s+$/.test(before)) return true;
  if (/^[ \t]*(?:[=:<{]|extends\b)/.test(afterMatch)) return true;
  return /\b(?:const|let|var|function|import|export|interface)\b/.test(code) || /=>/.test(code);
}

const PS_READ_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-encoding', '-tail', '-totalcount', '-first', '-last', '-depth',
  '-filter', '-include', '-exclude', '-delimiter', '-readcount',
]);

function extractPsLeadingPath(restTokens: readonly string[]): { prefix: string; targetToken: string; suffix: string } | null {
  let i = 0;
  let prefix = '';
  while (i < restTokens.length) {
    const tok = restTokens[i] ?? '';
    if (/^\s+$/.test(tok)) { prefix += tok; i++; continue; }
    if (!tok.startsWith('-')) {
      return { prefix, targetToken: tok, suffix: restTokens.slice(i + 1).join('') };
    }
    const lower = tok.toLowerCase();
    prefix += tok;
    i++;
    if (lower === '-path' || lower === '-literalpath') {
      while (i < restTokens.length && /^\s+$/.test(restTokens[i] ?? '')) { prefix += restTokens[i]; i++; }
      const targetToken = restTokens[i];
      if (targetToken === undefined) return null;
      return { prefix, targetToken, suffix: restTokens.slice(i + 1).join('') };
    }
    if (!tok.includes(':') && PS_READ_VALUE_FLAGS.has(lower)) {
      while (i < restTokens.length && /^\s+$/.test(restTokens[i] ?? '')) { prefix += restTokens[i]; i++; }
      if (i < restTokens.length) { prefix += restTokens[i]; i++; }
    }
  }
  return null;
}

function healEvalPowerShell(code: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[], interpreter?: string): string {
  if (target === 'wsl2') return code;
  if (interpreter !== undefined && !/^(?:pwsh|powershell|cmd)(?:\.exe)?$/i.test(path.basename(interpreter.trim()))) return code;
  const psCmdletRegex = /(?:^|(?<=[;&|\n]))\s*(Get-Content|gc|type|Get-ChildItem|gci)\b([^;&|\n#]*)/gi;
  const spans = buildNonCodeSpans(code, { includeHashComments: true });
  return code.replace(psCmdletRegex, (fullMatch: string, cmdlet: string, restArgs: string, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const afterMatch = code.slice(offset + fullMatch.length);
    if (isLikelyTypeScriptTypeOrJs(code, offset, cmdlet, afterMatch)) return fullMatch;
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const parsed = extractPsLeadingPath(tokens);
    if (parsed === null || /^['"`]|['"`]$/.test(parsed.targetToken)) return fullMatch;
    const prefixWs = /^\s*/.exec(fullMatch)?.[0] ?? '';
    const allowDirs = /Get-ChildItem|gci/i.test(cmdlet);
    const healed = healSingleEvalPath(parsed.targetToken, allowDirs, cwd, target);
    if (healed === null) return fullMatch;
    emitEvalPathHeal(`Path '${parsed.targetToken}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting eval command to '${cmdlet}${parsed.prefix}${healed}'... (Frictionless Recovery)`, deferredLogs);
    return `${prefixWs}${cmdlet}${parsed.prefix}${healed}${parsed.suffix}`;
  });
}

function healRunnerToken(token: string, runnerCmd: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '');
  if (RUNNER_SUBCOMMANDS.has(cleanPath.toLowerCase())) return null;
  const isPathLike = cleanPath.includes('/') || cleanPath.includes('\\') || /\.(?:ts|js|mjs|cjs|py|json)$/i.test(cleanPath);
  if (!isPathLike) return null;
  const healed = healSingleEvalPath(trimmed, false, cwd, target);
  if (healed === null || healed === trimmed) return null;
  emitEvalPathHeal(`Script path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting eval command to '${runnerCmd} ... ${healed}'... (Frictionless Recovery)`, deferredLogs);
  return quoteWrap(token, healed);
}

function stepRunnerToken(
  token: string,
  state: { sawRedirect: boolean; skipNext: boolean; aborted: boolean; sawScript: boolean },
  runnerCmd: string,
  cwd: string,
  target: HealTarget | undefined,
  deferredLogs?: string[],
): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || state.aborted || state.sawRedirect || state.sawScript) return null;
  if (isShellRedirectToken(trimmed)) { state.sawRedirect = true; return null; }
  if (state.skipNext) { state.skipNext = false; return null; }
  if (trimmed.startsWith('-')) {
    const flagKey = trimmed.split('=')[0] ?? trimmed;
    if (!trimmed.includes('=') && RUNNER_VALUE_FLAGS.has(flagKey)) state.skipNext = true;
    return null;
  }
  const lowerPos = trimmed.replace(/^['"`]|['"`]$/g, '').toLowerCase();
  if (runnerCmd.toLowerCase() === 'bun' && RUNNER_ABORT_SUBCMDS.has(lowerPos)) { state.aborted = true; return null; }
  if (RUNNER_SUBCOMMANDS.has(lowerPos)) return null;
  state.sawScript = true;
  return healRunnerToken(token, runnerCmd, cwd, target, deferredLogs);
}

function healEvalRunners(code: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string {
  const runnerRegex = /(?:^|(?<=[;&|\n]))\s*(bun|node|tsx|ts-node|python|python3)\b([^;&|\n#]*)/gi;
  const spans = buildNonCodeSpans(code, { includeHashComments: true });
  return code.replace(runnerRegex, (fullMatch: string, runnerCmd: string, restArgs: string, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const prefixWs = /^\s*/.exec(fullMatch)?.[0] ?? '';
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const state = { sawRedirect: false, skipNext: false, aborted: false, sawScript: false };
    let modified = false;
    const healedTokens = tokens.map((token) => {
      const healed = stepRunnerToken(token, state, runnerCmd, cwd, target, deferredLogs);
      if (healed === null) return token;
      modified = true;
      return healed;
    });
    return modified ? `${prefixWs}${runnerCmd}${healedTokens.join('')}` : fullMatch;
  });
}

function isReadOnlyPsPathSegment(code: string, offset: number): boolean {
  const prevBoundary = Math.max(
    code.lastIndexOf(';', offset),
    code.lastIndexOf('&', offset),
    code.lastIndexOf('|', offset),
    code.lastIndexOf('\n', offset),
  );
  const leadingStmt = code.slice(prevBoundary + 1, offset).trim();
  const cmdletMatch = leadingStmt.match(/^([a-zA-Z][a-zA-Z0-9-]*)\b/);
  return cmdletMatch?.[1] !== undefined && READONLY_PS_PATH_CMDLETS.has(cmdletMatch[1].toLowerCase());
}

function healEvalPathFlag(code: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[]): string {
  if (target === 'wsl2' || /(?:^|(?<=[;&|\n]))\s*find\b/i.test(code)) return code;
  const pathFlagRegex = /(-Path\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'`;|]+))/gi;
  const spans = buildNonCodeSpans(code, { includeHashComments: true });
  return code.replace(pathFlagRegex, (fullMatch: string, flagPrefix: string, qDouble: string | undefined, qSingle: string | undefined, unquoted: string | undefined, offset: number) => {
    if (isIndexInSpans(spans, offset) || !isReadOnlyPsPathSegment(code, offset)) return fullMatch;
    const rawPath = qDouble ?? qSingle ?? unquoted ?? '';
    if (rawPath.length === 0 || rawPath.includes('*') || rawPath.includes('?') || isPosixSystemPath(rawPath)) return fullMatch;
    const healed = healSingleEvalPath(rawPath, true, cwd, target);
    if (healed === null) return fullMatch;
    emitEvalPathHeal(`-Path '${rawPath}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting -Path in eval command to '${healed}'... (Frictionless Recovery)`, deferredLogs);
    const quote = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
    return `${flagPrefix}${quote}${healed}${quote}`;
  });
}

export function healEvalCodePathHallucinations(code: string, cwd: string, target?: HealTarget, options?: HealModuleImportOptions): string {
  const deferredLogs = options?.deferredLogs;
  let updated = healEvalMcpConfig(code, deferredLogs);
  updated = healModuleImports(updated, cwd, target, options);
  if (options?.interpreter !== undefined && !SHELL_EVAL_INTERPRETER_RE.test(path.basename(options.interpreter.trim()))) {
    return updated;
  }
  updated = healEvalFileTools(updated, cwd, target, deferredLogs);
  updated = healEvalSearchTools(updated, cwd, target, deferredLogs);
  updated = healEvalPowerShell(updated, cwd, target, deferredLogs, options?.interpreter);
  updated = healEvalRunners(updated, cwd, target, deferredLogs);
  return healEvalPathFlag(updated, cwd, target, deferredLogs);
}
