// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecPayload } from '../schema.js';
import { RG_VALUE_FLAGS, convertToWindowsPath, convertToWslPath, escapeUnixArg, extractLeadingShortFlags } from '../command-utils.js';
import { isJavaScriptOrTypeScriptCode, isPythonCode, isShellCommandScript } from '../eval-healer.js';
import { buildNonCodeSpans, isIndexInSpans } from '../quote-spans.js';
import { findEcosystemScript } from '../utils.js';
import { AGENT_EXEC_README_URL, splitFirstShellSegment } from './utils.js';
import { parseGrepSearchArgs } from './search-interceptor.js';
import { AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { healEvalGrepSegment, healEvalRgSegment } from './system-eval-search-healer.js';

type EvalPayload = Extract<ExecPayload, { type: 'eval' }>;
const PRUNE_TARGET_DIRS = ['node_modules', '.git', 'dist', '.cache', 'coverage'] as const;
const FIND_ACTION_RE = /(?:^|\s)(?:-print0?|-printf|-quit|-ls|-delete|-exec(?:dir)?|-ok(?:dir)?|-fprint0?|-fprintf)\b/i;

function resolveEvalBaseCwd(payload: EvalPayload, fallbackCwd?: string): string {
  let payloadCwd = payload.cwd !== undefined && payload.cwd.length > 0 && !payload.cwd.startsWith('~') && (!payload.cwd.startsWith('/') || payload.cwd.startsWith('/mnt/'))
    ? payload.cwd
    : undefined;
  if (payloadCwd !== undefined && payloadCwd.startsWith('/mnt/') && process.platform === 'win32') {
    payloadCwd = convertToWindowsPath(payloadCwd);
  }
  return path.resolve(payloadCwd ?? fallbackCwd ?? process.cwd());
}

// [INVARIANT]: Quote the whole find -name operand so an embedded quote cannot break out of the word.
function quoteShellWord(word: string): string {
  return `"${word.replace(/["\\$`]/g, (ch) => `\\${ch}`)}"`;
}

// [INVARIANT]: This pattern is not global. Only the bundled flag/pattern match is rewritten.
const bundledSearchFlagsRegex = /(?:^|[;&|\s])(?:rg|ripgrep|grep|egrep|fgrep)\s+(["'])(-[a-zA-Z0-9_-]+(?:\s+\d+)?(?:\s+-[a-zA-Z0-9_-]+(?:\s+\d+)?)*)\s+([^"']+)\1/i;

export function healEvalPayload(payload: ExecPayload, baseCwd?: string): void {
  if (payload.type !== 'eval' || typeof payload.code !== 'string') return;
  const resolvedCwd = resolveEvalBaseCwd(payload, baseCwd);
  const trimmedCode = payload.code.trim();
  healEvalToolAliases(payload, trimmedCode, resolvedCwd);
  healGitInspectEval(payload, trimmedCode, resolvedCwd);
  healFindMissingName(payload, trimmedCode);
  healBroadFindEval(payload);
  unbundleQuotedSearchFlags(payload);
  healUnquotedRgPattern(payload, resolvedCwd);
  healEvalGrepSegment(payload, resolvedCwd);
  healEvalRgSegment(payload, resolvedCwd);
  blockNativeEvalTools(payload.code.trim());
}

function healEvalToolAliases(payload: EvalPayload, trimmedCode: string, baseCwd: string): void {
  if (/^grep_search\s*\(/i.test(trimmedCode)) {
    healGrepSearchFunction(payload, trimmedCode);
    return;
  }
  if (healGrepSearchCli(payload, trimmedCode, baseCwd)) return;
  if (healListDirEval(payload, trimmedCode)) return;
  if (healViewFileEval(payload, trimmedCode)) return;
  healPackageRunnerSearch(payload, trimmedCode);
}

function healGrepSearchFunction(payload: EvalPayload, trimmedCode: string): void {
  const patternMatch = trimmedCode.match(/["'`]?(?:SearchPattern|Query|query|pattern)["'`]?\s*:\s*["'`]([^"'`]+)["'`]/i);
  if (patternMatch === null || patternMatch[1] === undefined) return;
  const pathMatch = trimmedCode.match(/["'`]?(?:SearchPath|path|dir)["'`]?\s*:\s*["'`]([^"'`]+)["'`]/i);
  const caseMatch = trimmedCode.match(/["'`]?(?:CaseInsensitive|caseInsensitive)["'`]?\s*:\s*(true|false)/i);
  const regexMatch = trimmedCode.match(/["'`]?(?:IsRegex|isRegex)["'`]?\s*:\s*(true|false)/i);
  const pattern = patternMatch[1];
  const searchPath = pathMatch !== null && pathMatch[1] !== undefined ? pathMatch[1] : '.';
  const isCaseInsensitive = caseMatch !== null && caseMatch[1] !== undefined ? caseMatch[1].toLowerCase() === 'true' : false;
  const isRegex = regexMatch !== null && regexMatch[1] !== undefined ? regexMatch[1].toLowerCase() === 'true' : false;
  const flags = ['-n'];
  if (isCaseInsensitive) flags.push('-i');
  if (!isRegex) flags.push('-F');
  if (pattern.startsWith('-')) flags.push('-e');
  const isWin32 = process.platform === 'win32';
  if (isWin32) payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `rg ${flags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(isWin32 ? convertToWslPath(searchPath) : searchPath, false)}`;
  console.error(`\n   💡 AGENT HINT: 'grep_search' called as a function inside eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating grep_search function call to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);
}

function healGrepSearchCli(payload: EvalPayload, trimmedCode: string, baseCwd: string): boolean {
  const grepSearchCliMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?grep_search(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (grepSearchCliMatch === null) return false;
  const rawArgs = (grepSearchCliMatch[1] ?? '').trim();
  if (rawArgs.length === 0 || /^\(\s*\)$/.test(rawArgs)) return false;
  const cleanTokens = shellTokens(rawArgs).map(token => stripWrappingQuotes(token));
  const parsed = parseGrepSearchArgs(cleanTokens, baseCwd);
  if (parsed.pattern.length > 0) {
    writeGrepSearchRg(payload, parsed.pattern, parsed.searchPath, parsed.isCaseInsensitive, parsed.isWord, parsed.isRegex);
    return true;
  }
  if (parsed.searchPath.length > 0) {
    const isWin32 = process.platform === 'win32';
    if (isWin32) payload.target = 'wsl2';
    payload.interpreter = 'bash';
    payload.code = `rg --files ${escapeUnixArg(isWin32 ? convertToWslPath(parsed.searchPath) : parsed.searchPath, false)}`;
    console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code without pattern.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg) --files... (Frictionless Recovery)\x1b[0m`);
    return true;
  }
  return false;
}

function writeGrepSearchRg(
  payload: EvalPayload,
  pattern: string,
  searchPath: string,
  isCaseInsensitive: boolean,
  isWord: boolean,
  isRegex: boolean,
): void {
  const isWin32 = process.platform === 'win32';
  if (isWin32) payload.target = 'wsl2';
  payload.interpreter = 'bash';
  const rgFlags = ['-n'];
  if (isCaseInsensitive) rgFlags.push('-i');
  if (isWord) rgFlags.push('-w');
  if (!isRegex) rgFlags.push('-F');
  if (pattern.startsWith('-')) rgFlags.push('-e');
  payload.code = `rg ${rgFlags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(isWin32 ? convertToWslPath(searchPath) : searchPath, false)}`;
  console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
}

function stripOptionalEvalCallParens(raw: string): string {
  const t = raw.trim();
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1).trim() : t;
}

function healListDirEval(payload: EvalPayload, trimmedCode: string): boolean {
  const listDirMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?list_dir(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (listDirMatch === null) return false;
  const rest = stripOptionalEvalCallParens(listDirMatch[1] ?? '').replace(/^['"`]|['"`]$/g, '').trim();
  const targetPath = rest.length > 0 ? rest : '.';
  const isWin32 = process.platform === 'win32';
  if (isWin32) payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `ls ${escapeUnixArg(isWin32 ? convertToWslPath(targetPath) : targetPath, false)}`;
  console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function healViewFileEval(payload: EvalPayload, trimmedCode: string): boolean {
  const viewFileMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?(?:view_file|read_file)(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (viewFileMatch === null) return false;
  const rawArg = (viewFileMatch[1] ?? '').trim();
  let targetPath = '';
  if (rawArg.startsWith('(')) {
    const singleCall = /^\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\)$/.exec(rawArg);
    targetPath = (singleCall?.[1] ?? singleCall?.[2] ?? singleCall?.[3] ?? '').trim();
  } else {
    const inner = rawArg.replace(/^['"`]|['"`]$/g, '').trim();
    if (!inner.includes(',')) targetPath = inner;
  }
  if (targetPath.length === 0) return false;
  const isWin32 = process.platform === 'win32';
  if (isWin32) payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `cat ${escapeUnixArg(isWin32 ? convertToWslPath(targetPath) : targetPath, false)}`;
  console.error(`\n   💡 AGENT HINT: 'view_file/read_file' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating to cat... (Frictionless Recovery)\x1b[0m`);
  return true;
}

function healPackageRunnerSearch(payload: EvalPayload, trimmedCode: string): void {
  const pkgRunnerMatch = trimmedCode.match(/^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:rg|ripgrep|fd|fdfind)\b\s*(.*)$/i);
  if (pkgRunnerMatch === null) return;
  const isFd = /^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:fd|fdfind)\b/i.test(trimmedCode);
  const toolName = isFd ? 'fd' : 'rg';
  const rest = pkgRunnerMatch[1] ?? '';
  if (process.platform === 'win32') payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `${toolName} ${rest}`.trim();
  console.error(`\n   💡 AGENT HINT: '${toolName}' executed via package runner in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating package runner ${toolName} to native ${toolName}... (Frictionless Recovery)\x1b[0m`);
}

function parseSupportedGitInspectArgs(gitSubCmd: string, tokens: readonly string[]): string[] | null {
  if (gitSubCmd === 'status') {
    return tokens.length === 0 ? ['--uncommitted', '--stats'] : null;
  }
  let limitVal: string | undefined;
  let rangeVal: string | undefined;
  let pathVal: string | undefined;
  let sawDoubleDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || tok.length === 0) continue;
    if (!sawDoubleDash && tok === '--') { sawDoubleDash = true; continue; }
    if (sawDoubleDash) {
      if (pathVal !== undefined) return null;
      pathVal = tok;
      continue;
    }
    const nextTok = tokens[i + 1];
    if ((tok === '-n' || tok === '--max-count') && nextTok !== undefined && /^\d+$/.test(nextTok)) {
      limitVal = nextTok;
      i++;
      continue;
    }
    const countMatch = tok.match(/^--max-count=(\d+)$/) ?? tok.match(/^-(\d+)$/);
    if (countMatch?.[1] !== undefined) {
      limitVal = countMatch[1];
      continue;
    }
    if (tok.startsWith('-')) return null;
    if (!/^\.{2,}(?:[/\\].*)?$/.test(tok) && tok.includes('..') && rangeVal === undefined) {
      rangeVal = tok;
      continue;
    }
    return null;
  }
  if (gitSubCmd === 'diff') {
    if (limitVal !== undefined) return null;
    const out = [rangeVal !== undefined ? '--range' : '--uncommitted'];
    if (rangeVal !== undefined) out.push(rangeVal);
    out.push('--stats', '--include-patch');
    if (pathVal !== undefined) out.push('--path', pathVal);
    return out;
  }
  const out: string[] = [];
  if (limitVal !== undefined) out.push('-n', limitVal);
  if (rangeVal !== undefined) out.push('--range', rangeVal);
  if (pathVal !== undefined) out.push('--path', pathVal);
  return out;
}

function healGitInspectEval(payload: EvalPayload, trimmedCode: string, baseCwd: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(trimmedCode);
  if (remainder.trim().length > 0) return;
  const isPosixWslCwd = payload.cwd !== undefined && payload.cwd.length > 0
    && ((payload.cwd.startsWith('/') && !payload.cwd.startsWith('/mnt/')) || payload.cwd.startsWith('~'));
  if (isPosixWslCwd) return;
  const gitInspectMatch = firstSegment.trim().match(/^git\s+(status|log|shortlog|diff)\b(.*)$/i);
  if (gitInspectMatch === null || gitInspectMatch[1] === undefined) return;
  const gitSubCmd = gitInspectMatch[1].toLowerCase();
  const restTokens = shellTokens(gitInspectMatch[2] ?? '').map(token => stripWrappingQuotes(token));
  const extraArgs = parseSupportedGitInspectArgs(gitSubCmd, restTokens);
  if (extraArgs === null) return;
  const scriptCandidate = findEcosystemScript(baseCwd, 'get-git-history-json.ts');
  const fallbackScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../get-git-history-json.ts');
  const script = scriptCandidate ?? fallbackScript;
  if (!fs.existsSync(script)) return;
  if (process.platform === 'win32') payload.target = 'windows';
  payload.interpreter = 'bun';
  payload.code = gitHistorySpawn(script.replace(/\\/g, '/'), baseCwd.replace(/\\/g, '/'), extraArgs);
  console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' inside eval payload detected.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'git ${gitSubCmd}' in eval to get-git-history-json.ts... (Frictionless Recovery)\x1b[0m`);
}

function gitHistorySpawn(scriptPathEscaped: string, cwdEscaped: string, extraArgs: readonly string[]): string {
  const spawnArgs = [scriptPathEscaped, ...extraArgs].map(arg => JSON.stringify(arg)).join(', ');
  return `import { spawnSync } from 'node:child_process'; const res = spawnSync(process.execPath, [${spawnArgs}], { stdio: 'inherit', cwd: ${JSON.stringify(cwdEscaped)} }); process.exit(res.status ?? 1);`;
}

function healFindMissingName(payload: EvalPayload, trimmedCode: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(trimmedCode);
  const findGlobMatch = firstSegment.trim().match(/^find\s+((?:[^\s"']|"[^"]*"|'[^']*')+)\s+((?:[^\s"']|"[^"]*"|'[^']*')+)(.*)$/i);
  if (findGlobMatch === null || findGlobMatch[1] === undefined || findGlobMatch[2] === undefined) return;
  if (!findGlobMatch[2].includes('*') && !findGlobMatch[2].includes('?')) return;
  const searchPath = stripWrappingQuotes(findGlobMatch[1]);
  if (searchPath.startsWith('-') || searchPath === '(' || searchPath === '!' || searchPath === '\\(') return;
  const pattern = stripWrappingQuotes(findGlobMatch[2]);
  if (pattern.includes('/') || pattern.includes('\\')) return;
  const rest = findGlobMatch[3] ?? '';
  const rewrittenFirst = `find ${escapeUnixArg(searchPath)} -name ${quoteShellWord(pattern)} ${rest}`.trim();
  payload.code = `${rewrittenFirst}${remainder}`;
  console.error(`\n   💡 AGENT HINT: 'find' without '-name' flag detected in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-name' flag for pattern '${pattern}'... (Frictionless Recovery)\x1b[0m`);
}

function isBroadFindRootPath(rootPath: string): boolean {
  const clean = stripWrappingQuotes(rootPath.trim());
  return clean === '.' || clean === './' || clean === '..' || clean === '../'
    || clean.startsWith('/mnt/') || /^[a-zA-Z]:/.test(clean);
}

function healBroadFindEval(payload: EvalPayload): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const trimmedFirst = firstSegment.trimStart();
  if (trimmedFirst.includes('-prune')) return;
  const findBodyMatch = trimmedFirst.match(/^find\s+(.+)$/i);
  if (findBodyMatch?.[1] === undefined) return;
  const tokens = shellTokens(findBodyMatch[1]);
  const leadFlags: string[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx] ?? '';
    if (tok === '-H' || tok === '-L' || tok === '-P' || /^-O\d+$/.test(tok)) { leadFlags.push(tok); idx++; continue; }
    if (tok === '-D' && idx + 1 < tokens.length) { leadFlags.push(tok, tokens[idx + 1] ?? ''); idx += 2; continue; }
    break;
  }
  const rootPaths: string[] = [];
  while (idx < tokens.length) {
    const tok = tokens[idx] ?? '';
    if (tok.startsWith('-') || tok === '(' || tok === '\\(' || tok === '!' || tok === ',') break;
    rootPaths.push(tok);
    idx++;
  }
  const restTokens = tokens.slice(idx);
  const rest = restTokens.join(' ').trim();
  if (rootPaths.length === 0 || !rootPaths.some(isBroadFindRootPath)) return;
  if (restTokens.some(t => ['-maxdepth', '-delete', '-depth', '--help', '--version'].includes(t))) return;
  const rootSegs = rootPaths.flatMap(rp => stripWrappingQuotes(rp.trim()).replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean));
  const dirsToPrune = PRUNE_TARGET_DIRS.filter((dir) => {
    const dirLower = dir.toLowerCase();
    return !rootSegs.includes(dirLower) && !rest.toLowerCase().includes(dirLower);
  });
  if (dirsToPrune.length === 0) return;
  const pruneClause = `\\( ${dirsToPrune.map((d) => `-name ${d}`).join(' -o ')} \\) -prune -o`;
  const groupedRest = rest.length > 0 && /(?:^|\s)(?:-o|-or)\b/.test(rest) ? `\\( ${rest} \\)` : rest;
  const printSuffix = FIND_ACTION_RE.test(rest) ? '' : ' -print';
  const body = [ ...leadFlags, ...rootPaths, pruneClause, groupedRest ].filter(s => s.length > 0).join(' ');
  payload.code = `find ${body}${printSuffix}${remainder}`;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Broad find in eval payload detected. Auto-injecting directory pruning for node_modules, .git, and dist to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
}

function unbundleQuotedSearchFlags(payload: EvalPayload): void {
  if (!isShellCommandScript(payload.code) && (isJavaScriptOrTypeScriptCode(payload.code) || isPythonCode(payload.code))) return;
  const match = bundledSearchFlagsRegex.exec(payload.code);
  if (match === null) return;
  const spans = buildNonCodeSpans(payload.code, { includeHashComments: true });
  if (isIndexInSpans(spans, match.index)) return;
  let unbundled = false;
  payload.code = payload.code.replace(bundledSearchFlagsRegex, (full: string, quote: string, flags: string, pattern: string) => {
    const quoted = `${quote}${flags} ${pattern}${quote}`;
    const at = full.lastIndexOf(quoted);
    if (at < 0) return full;
    unbundled = true;
    return `${full.slice(0, at)}${flags} ${quote}${pattern}${quote}`;
  });
  if (unbundled) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern inside quotes in eval code. Unbundling flags... (Frictionless Recovery)\x1b[0m`);
  }
}

function hasFileOrPathLikeWord(words: readonly string[], cwd?: string): boolean {
  const baseCwd = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
  return words.some((word) => {
    if (word.includes('/') || word.includes('\\')) return true;
    if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|json|md|txt|ya?ml|sql|ps1|sh|css|html|xml|log|toml|ini|lock)$/i.test(word)) return true;
    try {
      return fs.statSync(path.resolve(baseCwd, word), { throwIfNoEntry: false }) !== undefined;
    } catch {
      return false;
    }
  });
}

const RG_EVAL_VALUE_FLAGS = new Set(RG_VALUE_FLAGS);

const RG_EXPLICIT_PATTERN_FLAGS = new Set(['-e', '--regexp', '-f', '--file']);

function healUnquotedRgPattern(payload: EvalPayload, baseCwd: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code.trim());
  const rgHead = firstSegment.match(/^rg\s+(.*)$/i);
  if (rgHead?.[1] === undefined) return;
  const tokens = rgHead[1].split(/\s+/);
  const flagTokens: string[] = [];
  const posTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || tok.length === 0) continue;
    if (tok === '--' || /[|><&;]/.test(tok)) return;
    const shortPrefix = tok.startsWith('-') && !tok.startsWith('--') ? extractLeadingShortFlags('rg', tok) : '';
    const tailChar = shortPrefix.length > 1 ? shortPrefix[shortPrefix.length - 1] : '';
    if (
      tok === '--files' ||
      RG_EXPLICIT_PATTERN_FLAGS.has(tok) ||
      tailChar === 'e' ||
      tailChar === 'f' ||
      /^-[ef]./.test(tok) ||
      tok.startsWith('--regexp=') ||
      tok.startsWith('--file=')
    ) {
      return;
    }
    if (tok.startsWith('-')) {
      if (posTokens.length > 0) return;
      flagTokens.push(tok);
      const takesSeparateVal = RG_EVAL_VALUE_FLAGS.has(tok)
        || (tok.length === shortPrefix.length && tailChar !== '' && RG_EVAL_VALUE_FLAGS.has(`-${tailChar}`));
      if (takesSeparateVal && i + 1 < tokens.length) {
        const val = tokens[i + 1];
        if (val !== undefined) flagTokens.push(val);
        i += 1;
      }
      continue;
    }
    posTokens.push(tok);
  }
  if (posTokens.length < 3) return;
  const targetPath = posTokens[posTokens.length - 1];
  const wordTokens = posTokens.slice(0, -1);
  if (targetPath === undefined || !/^(\/[^\s]+|[a-zA-Z]:[^\s]+|\.[^\s]+|[^\s]+\.[a-zA-Z0-9]+)$/.test(targetPath)) return;
  if (!wordTokens.every((w) => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(w)) || hasFileOrPathLikeWord(wordTokens, baseCwd)) return;
  const flags = flagTokens.length > 0 ? `${flagTokens.join(' ')} ` : '';
  payload.code = `rg ${flags}"${wordTokens.join(' ')}" ${targetPath}${remainder}`;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Unquoted search pattern in eval 'rg' detected. Recombining into single quoted pattern... (Frictionless Recovery)\x1b[0m`);
}

function blockNativeEvalTools(trimmedCode: string): void {
  const headMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)(?=$|\s|\()/.exec(trimmedCode);
  const headIdent = headMatch?.[1];
  if (headIdent !== undefined && (AGENT_NATIVE_TOOLS as readonly string[]).includes(headIdent)) {
    console.error(`\n   💡 AGENT HINT: '${headIdent}' is an agent-native tool, NOT executable code or a shell script. Please invoke the '${headIdent}' tool directly.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
    process.exit(1);
  }
  const matchedMcpTool = (ECOSYSTEM_MCP_TOOLS as readonly string[]).find(tool => trimmedCode === tool || trimmedCode.startsWith(`${tool}(`) || trimmedCode.startsWith(`${tool} `));
  if (matchedMcpTool === undefined) return;
  console.error(`\n   💡 AGENT HINT: '${matchedMcpTool}' is an MCP tool, NOT executable code or a shell script. Please call the '${matchedMcpTool}' MCP tool via call_mcp_tool.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  process.exit(1);
}

function shellTokens(rest: string): string[] {
  return rest.match(/(?:[^\s"'`]|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
}

function stripWrappingQuotes(token: string): string {
  const wrapped = (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
    || (token.startsWith('`') && token.endsWith('`'));
  if (!wrapped) return token;
  return token.slice(1, -1);
}
