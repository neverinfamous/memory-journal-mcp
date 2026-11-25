// @ts-nocheck
import path from 'node:path';
import { FLAGS_WITH_ARG_SET_BY_TOOL, convertToWslPath, inspectCombinedShortFlag } from './command-utils.js';
import { buildNonCodeSpans, isIndexInSpans } from './quote-spans.js';
import { healModuleImports, type HealModuleImportOptions } from './path-module-healer.js';
import { healSingleEvalPath, healSingleEvalPathResult, isPosixSystemPath } from './path-eval-path.js';
import { createPathProbeCache, logPathHeal, type PathProbeCache } from './path-healer.js';

type HealTarget = 'windows' | 'wsl2';
type NonCodeSpans = ReturnType<typeof buildNonCodeSpans>;

const TOKEN_RE = /(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+|\s+/g;
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
const LEADING_QUOTE_RE = /^['"`]/;
const OUTER_QUOTES_RE = /^['"`]|['"`]$/g;
const TRAILING_SEPS_RE = /[\\/]+$/;
const LEADING_WS_RE = /^[ \t]*/;
const WS_ONLY_RE = /^\s+$/;
const SHELL_REDIRECT_RE = /^(?:\d*>>?|\d*<<?|<&|>&|&>|&>>)(?:\S*)?$/;
const MCP_CONFIG_SLASH_RE = /\.gemini[\\/]mcp_config\.json/g;
const UNSAFE_MUTATING_SHELL_RE = /[$`{}|;&<>\n\r]/;
const ESCAPED_SHELL_META_RE = /\\[$()*?&!`]/;
const DRIVE_WIN_PREFIX_RE = /^[a-zA-Z]:[/\\]/;
const PLAIN_REL_WIN_RE = /^[a-zA-Z0-9_.\\/-]+$/;
const BARREL_INDEX_RE = /(?:^|[/\\])index\.[jt]sx?$/i;
const ATTACHED_SEARCH_PAT_RE = /^-[ef]./;
const LONG_SEARCH_PAT_EQ_RE = /^--(?:regexp|file)=/;
const TS_KEYWORD_PREFIX_RE = /\b(?:export|import|declare)\s+$/;
const TS_DECL_REST_RE = /^[ \t]*(?:[=:<{]|extends\b|[A-Za-z_$][\w$]*[ \t]*(?:<[^>\r\n]*>[ \t]*)?=)/;
const PS_INTERP_BASENAME_RE = /^(?:pwsh|powershell|cmd)(?:\.exe)?$/i;
const GCI_CMDLET_RE = /Get-ChildItem|gci/i;
const RUNNER_EXT_RE = /\.(?:ts|js|mjs|cjs|py|json)$/i;
const PS_CMDLET_HEAD_RE = /^([a-zA-Z][a-zA-Z0-9-]*)\b/;
const FIND_STMT_RE = /(?:^|(?<=[;&|\n]))[ \t]*find\b/i;

function emitEvalPathHeal(hint: string, action: string, deferredLogs?: string[]): void {
  if (deferredLogs !== undefined) {
    deferredLogs.push(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: ${action}\x1b[0m`);
    return;
  }
  logPathHeal(hint, action);
}

function isShellRedirectToken(trimmed: string): boolean {
  return trimmed.length > 0 && !LEADING_QUOTE_RE.test(trimmed) && SHELL_REDIRECT_RE.test(trimmed);
}

function healEvalMcpConfig(code: string, deferredLogs?: string[]): string {
  if (!code.includes('.gemini/mcp_config.json') && !code.includes('.gemini\\mcp_config.json')) return code;
  if (code.includes('antigravity-ide') || code.includes('.gemini/config')) return code;
  const msg = `\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path in eval code to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`;
  if (deferredLogs !== undefined) deferredLogs.push(msg);
  else console.error(msg);
  return code.replace(MCP_CONFIG_SLASH_RE, '.gemini/antigravity-ide/mcp_config.json');
}

function quoteWrap(token: string, healed: string): string {
  const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
  return `${quote}${healed}${quote}`;
}

function healFileToolToken(token: string, isDirTool: boolean, isMutatingTool: boolean, cmdWord: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[], cache?: PathProbeCache): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  if (isMutatingTool) {
    if (target !== 'wsl2') return null;
    const unquoted = trimmed.replace(OUTER_QUOTES_RE, '');
    if (UNSAFE_MUTATING_SHELL_RE.test(unquoted) || ESCAPED_SHELL_META_RE.test(unquoted)) return null;
    const isDriveWin = DRIVE_WIN_PREFIX_RE.test(unquoted);
    const isPlainRelWin = unquoted.includes('\\') && PLAIN_REL_WIN_RE.test(unquoted);
    if (isDriveWin || isPlainRelWin) {
      const converted = convertToWslPath(unquoted);
      return converted === unquoted ? null : quoteWrap(token, converted);
    }
    return null;
  }
  const unquoted = trimmed.replace(OUTER_QUOTES_RE, '');
  const cleanPath = unquoted.replace(TRAILING_SEPS_RE, '');
  if (isDirTool && !cleanPath.includes('/') && !cleanPath.includes('\\') && !cleanPath.includes('.')) return null;
  const res = healSingleEvalPathResult(trimmed, isDirTool, cwd, target, cache);
  if (res === null || res.healed === unquoted) return null;
  const { healed, normalizedOnly } = res;
  const isBarrel = BARREL_INDEX_RE.test(healed) && !BARREL_INDEX_RE.test(trimmed);
  const hint = normalizedOnly
    ? `Path '${trimmed}' in eval code requires WSL path normalization.`
    : (isBarrel
      ? `Path '${trimmed}' in eval code not found on disk, but barrel '${healed}' exists.`
      : `Path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`);
  const action = normalizedOnly
    ? `Normalizing existing path to '${healed}'... (Frictionless Recovery)`
    : `Auto-correcting eval command to '${cmdWord} ... ${healed}'... (Frictionless Recovery)`;
  emitEvalPathHeal(hint, action, deferredLogs);
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

function healInspectionMatch(fullMatch: string, cmdWord: string, restArgs: string, offset: number, spans: NonCodeSpans, cwd: string, target: HealTarget | undefined, deferredLogs?: string[], cache?: PathProbeCache): string {
  if (isIndexInSpans(spans, offset)) return fullMatch;
  const prefixWs = LEADING_WS_RE.exec(fullMatch)?.[0] ?? '';
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
    const healed = healFileToolToken(token, isDirTool, isMutatingTool, cmdWord, cwd, target, deferredLogs, cache);
    if (healed === null) return token;
    modified = true;
    return healed;
  });
  return modified ? `${prefixWs}${cmdWord}${healedTokens.join('')}` : fullMatch;
}

const FILE_INSPECTION_RE = /(?:^|(?<=[;&|\n]))[ \t]*(cat|head|tail|wc|ls|dir|rm|cp|mv|touch|mkdir|chmod|diff)\b([^;&|\n#]*)/gi;
const SEARCH_MATCH_RE = /(?:^|(?<=[;&|\n]))[ \t]*(grep|egrep|fgrep|rg)\b([^;&|\n#]*)/g;
const PS_CMDLET_RE = /(?:^|(?<=[;&|\n]))[ \t]*(Get-Content|gc|type|Get-ChildItem|gci)\b([^;&|\n#]*)/gi;
const RUNNER_EVAL_RE = /(?:^|(?<=[;&|\n]))[ \t]*(bun|node|tsx|ts-node|python|python3)\b([^;&|\n#]*)/gi;
const PATH_FLAG_RE = /(-Path\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'`;|]+))/gi;

function healEvalFileTools(code: string, cwd: string, target: HealTarget | undefined, getSpans: () => NonCodeSpans, deferredLogs?: string[], cache?: PathProbeCache): string {
  let spans: NonCodeSpans | null = null;
  FILE_INSPECTION_RE.lastIndex = 0;
  return code.replace(FILE_INSPECTION_RE, (fullMatch: string, cmdWord: string, restArgs: string, offset: number) => {
    spans ??= getSpans();
    return healInspectionMatch(fullMatch, cmdWord, restArgs, offset, spans, cwd, target, deferredLogs, cache);
  });
}

function healSearchToken(
  token: string,
  state: { seenDoubleDash: boolean; skipNext: boolean; hasPatternFlag: boolean; posCount: number; sawRedirect: boolean },
  cmdBase: string,
  cwd: string,
  target: HealTarget | undefined,
  deferredLogs?: string[],
  cache?: PathProbeCache,
): string | null {
  if (WS_ONLY_RE.test(token) || state.sawRedirect) return null;
  if (isShellRedirectToken(token.trim())) { state.sawRedirect = true; return null; }
  if (state.skipNext) { state.skipNext = false; return null; }
  if (!state.seenDoubleDash && token === '--') { state.seenDoubleDash = true; return null; }
  if (!state.seenDoubleDash && token.startsWith('-')) {
    const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_SET_BY_TOOL, cmdBase) ? FLAGS_WITH_ARG_SET_BY_TOOL[cmdBase] : undefined;
    const shortInfo = inspectCombinedShortFlag(cmdBase, token, toolFlags);
    const sp = shortInfo.shortPrefix;
    const isCombinedPattern = sp.length > 1 && (sp.includes('e') || sp.includes('f'));
    if (SEARCH_EVAL_PATTERN_FLAGS.has(token) || isCombinedPattern) {
      state.hasPatternFlag = true;
      if (SEARCH_EVAL_PATTERN_FLAGS.has(token) || shortInfo.takesSeparateValue) state.skipNext = true;
    } else if (ATTACHED_SEARCH_PAT_RE.test(token) || LONG_SEARCH_PAT_EQ_RE.test(token)) {
      state.hasPatternFlag = true;
    } else if (SEARCH_EVAL_VALUE_FLAGS.has(token) || shortInfo.takesSeparateValue) {
      state.skipNext = true;
    }
    return null;
  }
  const posIdx = state.posCount++;
  if (!state.hasPatternFlag && posIdx === 0) return null;
  const unquoted = token.replace(OUTER_QUOTES_RE, '');
  const cleanTargetPath = unquoted.replace(TRAILING_SEPS_RE, '');
  if (path.extname(cleanTargetPath).length === 0 && !cleanTargetPath.includes('/') && !cleanTargetPath.includes('\\')) return null;
  const res = healSingleEvalPathResult(token, true, cwd, target, cache);
  if (res === null || res.healed === unquoted) return null;
  const hint = res.normalizedOnly
    ? `Search path '${token}' in eval code requires WSL path normalization.`
    : `Search path '${token}' in eval code not found on disk, but found at '${res.healed}'.`;
  const action = res.normalizedOnly
    ? `Normalizing search path to '${res.healed}'... (Frictionless Recovery)`
    : `Auto-correcting search path in eval command to '${res.healed}'... (Frictionless Recovery)`;
  emitEvalPathHeal(hint, action, deferredLogs);
  return quoteWrap(token, res.healed);
}

function healEvalSearchTools(code: string, cwd: string, target: HealTarget | undefined, getSpans: () => NonCodeSpans, deferredLogs?: string[], cache?: PathProbeCache): string {
  let spans: NonCodeSpans | null = null;
  SEARCH_MATCH_RE.lastIndex = 0;
  return code.replace(SEARCH_MATCH_RE, (fullMatch: string, cmdWord: string, restArgs: string, offset: number) => {
    spans ??= getSpans();
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const prefixWs = LEADING_WS_RE.exec(fullMatch)?.[0] ?? '';
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const cmdBase = cmdWord.toLowerCase();
    const state = { seenDoubleDash: false, skipNext: false, hasPatternFlag: false, posCount: 0, sawRedirect: false };
    let modified = false;
    const healedTokens = tokens.map((token) => {
      const healed = healSearchToken(token, state, cmdBase, cwd, target, deferredLogs, cache);
      if (healed === null) return token;
      modified = true;
      return healed;
    });
    return modified ? `${prefixWs}${cmdWord}${healedTokens.join('')}` : fullMatch;
  });
}

const CODE_TS_JS_INDICATOR_RE = /\b(?:const|let|var|function|import|export|interface)\b/;

function isLikelyTypeScriptTypeOrJs(code: string, offset: number, cmdlet: string, restArgs: string, hasCodeLevelTsOrJs: () => boolean): boolean {
  if (cmdlet.toLowerCase() !== 'type') return false;
  const before = code.slice(Math.max(0, offset - 32), offset);
  if (TS_KEYWORD_PREFIX_RE.test(before)) return true;
  if (TS_DECL_REST_RE.test(restArgs)) return true;
  return hasCodeLevelTsOrJs();
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
    if (WS_ONLY_RE.test(tok)) { prefix += tok; i++; continue; }
    if (!tok.startsWith('-')) {
      return { prefix, targetToken: tok, suffix: restTokens.slice(i + 1).join('') };
    }
    const lower = tok.toLowerCase();
    prefix += tok;
    i++;
    if (lower === '-path' || lower === '-literalpath') {
      while (i < restTokens.length && WS_ONLY_RE.test(restTokens[i] ?? '')) { prefix += restTokens[i]; i++; }
      const targetToken = restTokens[i];
      if (targetToken === undefined) return null;
      return { prefix, targetToken, suffix: restTokens.slice(i + 1).join('') };
    }
    if (!tok.includes(':') && PS_READ_VALUE_FLAGS.has(lower)) {
      while (i < restTokens.length && WS_ONLY_RE.test(restTokens[i] ?? '')) { prefix += restTokens[i]; i++; }
      if (i < restTokens.length) { prefix += restTokens[i]; i++; }
    }
  }
  return null;
}

function healEvalPowerShell(code: string, cwd: string, target: HealTarget | undefined, getSpans: () => NonCodeSpans, deferredLogs?: string[], interpreter?: string, cache?: PathProbeCache): string {
  if (target === 'wsl2') return code;
  if (interpreter !== undefined && !PS_INTERP_BASENAME_RE.test(path.basename(interpreter.trim()))) return code;
  let spans: NonCodeSpans | null = null;
  let codeLevelTsOrJs: boolean | null = null;
  const hasCodeLevelTsOrJs = (): boolean => {
    codeLevelTsOrJs ??= CODE_TS_JS_INDICATOR_RE.test(code) || code.includes('=>');
    return codeLevelTsOrJs;
  };
  PS_CMDLET_RE.lastIndex = 0;
  return code.replace(PS_CMDLET_RE, (fullMatch: string, cmdlet: string, restArgs: string, offset: number) => {
    spans ??= getSpans();
    if (isIndexInSpans(spans, offset)) return fullMatch;
    if (isLikelyTypeScriptTypeOrJs(code, offset, cmdlet, restArgs, hasCodeLevelTsOrJs)) return fullMatch;
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const parsed = extractPsLeadingPath(tokens);
    if (parsed === null || LEADING_QUOTE_RE.test(parsed.targetToken) || /['"`]$/.test(parsed.targetToken)) return fullMatch;
    const prefixWs = LEADING_WS_RE.exec(fullMatch)?.[0] ?? '';
    const allowDirs = GCI_CMDLET_RE.test(cmdlet);
    const healed = healSingleEvalPath(parsed.targetToken, allowDirs, cwd, target, cache);
    if (healed === null) return fullMatch;
    emitEvalPathHeal(`Path '${parsed.targetToken}' in eval code not found on disk, but found at '${healed}'.`, `Auto-correcting eval command to '${cmdlet}${parsed.prefix}${healed}'... (Frictionless Recovery)`, deferredLogs);
    return `${prefixWs}${cmdlet}${parsed.prefix}${healed}${parsed.suffix}`;
  });
}

function healRunnerToken(token: string, runnerCmd: string, cwd: string, target: HealTarget | undefined, deferredLogs?: string[], cache?: PathProbeCache): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) return null;
  const cleanPath = trimmed.replace(OUTER_QUOTES_RE, '');
  if (RUNNER_SUBCOMMANDS.has(cleanPath.toLowerCase())) return null;
  const isPathLike = cleanPath.includes('/') || cleanPath.includes('\\') || RUNNER_EXT_RE.test(cleanPath);
  if (!isPathLike) return null;
  const res = healSingleEvalPathResult(trimmed, false, cwd, target, cache);
  if (res === null || res.healed === cleanPath) return null;
  const hint = res.normalizedOnly
    ? `Script path '${trimmed}' in eval code requires WSL path normalization.`
    : `Script path '${trimmed}' in eval code not found on disk, but found at '${res.healed}'.`;
  const action = res.normalizedOnly
    ? `Normalizing script path to '${res.healed}'... (Frictionless Recovery)`
    : `Auto-correcting eval command to '${runnerCmd} ... ${res.healed}'... (Frictionless Recovery)`;
  emitEvalPathHeal(hint, action, deferredLogs);
  return quoteWrap(token, res.healed);
}

function stepRunnerToken(
  token: string,
  state: { sawRedirect: boolean; skipNext: boolean; aborted: boolean; sawScript: boolean },
  runnerCmd: string,
  cwd: string,
  target: HealTarget | undefined,
  deferredLogs?: string[],
  cache?: PathProbeCache,
): string | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || state.aborted || state.sawRedirect || state.sawScript) return null;
  if (isShellRedirectToken(trimmed)) { state.sawRedirect = true; return null; }
  if (state.skipNext) { state.skipNext = false; return null; }
  if (trimmed.startsWith('-')) {
    const flagKey = trimmed.split('=')[0] ?? trimmed;
    if (runnerCmd.toLowerCase() === 'bun' && flagKey === '--cwd') { state.aborted = true; return null; }
    if (!trimmed.includes('=') && RUNNER_VALUE_FLAGS.has(flagKey)) state.skipNext = true;
    const lowerRunner = runnerCmd.toLowerCase();
    const isPython = lowerRunner === 'python' || lowerRunner === 'python3';
    if (
      flagKey === '-e' || flagKey === '--eval' || flagKey === '-p' || flagKey === '--print' ||
      flagKey === '-pe' || flagKey === '-ep' ||
      (isPython && (flagKey === '-c' || flagKey === '-m' || trimmed.startsWith('-c') || trimmed.startsWith('-m')))
    ) {
      state.sawScript = true;
    }
    return null;
  }
  const lowerPos = trimmed.replace(OUTER_QUOTES_RE, '').toLowerCase();
  if (runnerCmd.toLowerCase() === 'bun' && RUNNER_ABORT_SUBCMDS.has(lowerPos)) { state.aborted = true; return null; }
  if (RUNNER_SUBCOMMANDS.has(lowerPos)) return null;
  state.sawScript = true;
  return healRunnerToken(token, runnerCmd, cwd, target, deferredLogs, cache);
}

function healEvalRunners(code: string, cwd: string, target: HealTarget | undefined, getSpans: () => NonCodeSpans, deferredLogs?: string[], cache?: PathProbeCache): string {
  let spans: NonCodeSpans | null = null;
  RUNNER_EVAL_RE.lastIndex = 0;
  return code.replace(RUNNER_EVAL_RE, (fullMatch: string, runnerCmd: string, restArgs: string, offset: number) => {
    spans ??= getSpans();
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const prefixWs = LEADING_WS_RE.exec(fullMatch)?.[0] ?? '';
    const tokens = restArgs.match(TOKEN_RE) ?? [];
    const state = { sawRedirect: false, skipNext: false, aborted: false, sawScript: false };
    let modified = false;
    const healedTokens = tokens.map((token) => {
      const healed = stepRunnerToken(token, state, runnerCmd, cwd, target, deferredLogs, cache);
      if (healed === null) return token;
      modified = true;
      return healed;
    });
    return modified ? `${prefixWs}${runnerCmd}${healedTokens.join('')}` : fullMatch;
  });
}

const DIR_CAPABLE_PS_CMDLETS: ReadonlySet<string> = new Set([
  'get-childitem', 'gci', 'test-path', 'get-item', 'gi', 'resolve-path', 'rvpa',
]);

function getReadOnlyPsPathMode(code: string, offset: number): 'dir' | 'file' | null {
  const prevBoundary = Math.max(
    code.lastIndexOf(';', offset),
    code.lastIndexOf('&', offset),
    code.lastIndexOf('|', offset),
    code.lastIndexOf('\n', offset),
  );
  const leadingStmt = code.slice(prevBoundary + 1, offset).trim();
  const cmdletMatch = leadingStmt.match(PS_CMDLET_HEAD_RE);
  const name = cmdletMatch?.[1]?.toLowerCase();
  if (name === undefined || !READONLY_PS_PATH_CMDLETS.has(name)) return null;
  return DIR_CAPABLE_PS_CMDLETS.has(name) ? 'dir' : 'file';
}

function healEvalPathFlag(code: string, cwd: string, target: HealTarget | undefined, getSpans: () => NonCodeSpans, deferredLogs?: string[], cache?: PathProbeCache): string {
  if (target === 'wsl2' || FIND_STMT_RE.test(code)) return code;
  let spans: NonCodeSpans | null = null;
  PATH_FLAG_RE.lastIndex = 0;
  return code.replace(PATH_FLAG_RE, (fullMatch: string, flagPrefix: string, qDouble: string | undefined, qSingle: string | undefined, unquoted: string | undefined, offset: number) => {
    spans ??= getSpans();
    const mode = isIndexInSpans(spans, offset) ? null : getReadOnlyPsPathMode(code, offset);
    if (mode === null) return fullMatch;
    const rawPath = qDouble ?? qSingle ?? unquoted ?? '';
    if (rawPath.length === 0 || rawPath.includes('*') || rawPath.includes('?') || isPosixSystemPath(rawPath)) return fullMatch;
    const healed = healSingleEvalPath(rawPath, mode === 'dir', cwd, target, cache);
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
  const probeCache = createPathProbeCache();
  let cachedCode: string | null = null;
  let cachedSpans: NonCodeSpans | null = null;
  const getSpans = (): NonCodeSpans => {
    if (cachedCode !== updated || cachedSpans === null) {
      cachedCode = updated;
      cachedSpans = buildNonCodeSpans(updated, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
    }
    return cachedSpans;
  };
  updated = healEvalFileTools(updated, cwd, target, getSpans, deferredLogs, probeCache);
  updated = healEvalSearchTools(updated, cwd, target, getSpans, deferredLogs, probeCache);
  updated = healEvalPowerShell(updated, cwd, target, getSpans, deferredLogs, options?.interpreter, probeCache);
  updated = healEvalRunners(updated, cwd, target, getSpans, deferredLogs, probeCache);
  return healEvalPathFlag(updated, cwd, target, getSpans, deferredLogs, probeCache);
}
