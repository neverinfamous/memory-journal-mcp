// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { convertToWslPath, escapeUnixArg } from '../command-utils.js';
import { findEcosystemScript } from '../utils.js';
import { AGENT_EXEC_README_URL } from './utils.js';
import { parseGrepSearchArgs } from './search-interceptor.js';
import { AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { healEvalGrepSegment, healEvalRgSegment } from './system-eval-search-healer.js';

type EvalPayload = Extract<ExecPayload, { type: 'eval' }>;

// [INVARIANT]: Quote the whole find -name operand so an embedded quote cannot break out of the word.
function quoteShellWord(word: string): string {
  return `"${word.replace(/["\\$`]/g, (ch) => `\\${ch}`)}"`;
}

// [INVARIANT]: This pattern is not global. Only the bundled flag/pattern match is rewritten.
const bundledSearchFlagsRegex = /(?:^|[;&|\s])(?:rg|ripgrep|grep|egrep|fgrep)\s+(["'])(-[a-zA-Z0-9_-]+(?:\s+\d+)?(?:\s+-[a-zA-Z0-9_-]+(?:\s+\d+)?)*)\s+([^"']+)\1/i;

export function healEvalPayload(payload: ExecPayload): void {
  if (payload.type !== 'eval' || typeof payload.code !== 'string') return;
  const trimmedCode = payload.code.trim();
  healEvalToolAliases(payload, trimmedCode);
  healGitInspectEval(payload, trimmedCode);
  healFindMissingName(payload, trimmedCode);
  healBroadFindEval(payload);
  unbundleQuotedSearchFlags(payload);
  healUnquotedRgPattern(payload);
  healEvalGrepSegment(payload);
  healEvalRgSegment(payload);
  blockNativeEvalTools(trimmedCode);
}

function healEvalToolAliases(payload: EvalPayload, trimmedCode: string): void {
  if (/^grep_search\s*\(/i.test(trimmedCode)) {
    healGrepSearchFunction(payload, trimmedCode);
    return;
  }
  if (healGrepSearchCli(payload, trimmedCode)) return;
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
  console.error(`\n   💡 AGENT HINT: 'grep_search' called as a function inside eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating grep_search function call to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);
  const flags = ['-n'];
  if (isCaseInsensitive) flags.push('-i');
  if (!isRegex) flags.push('-F');
  payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `rg ${flags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(convertToWslPath(searchPath), false)}`;
}

function healGrepSearchCli(payload: EvalPayload, trimmedCode: string): boolean {
  const grepSearchCliMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?grep_search(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (grepSearchCliMatch === null) return false;
  const cleanTokens = shellTokens(grepSearchCliMatch[1] ?? '').map(token => stripWrappingQuotes(token));
  const parsed = parseGrepSearchArgs(cleanTokens);
  if (parsed.pattern.length > 0) {
    writeGrepSearchRg(payload, parsed.pattern, parsed.searchPath, parsed.isCaseInsensitive, parsed.isWord, parsed.isRegex);
    return true;
  }
  if (parsed.searchPath.length > 0) {
    console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code without pattern.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg) --files... (Frictionless Recovery)\x1b[0m`);
    payload.target = 'wsl2';
    payload.interpreter = 'bash';
    payload.code = `rg --files ${escapeUnixArg(convertToWslPath(parsed.searchPath), false)}`;
  }
  return true;
}

function writeGrepSearchRg(
  payload: EvalPayload,
  pattern: string,
  searchPath: string,
  isCaseInsensitive: boolean,
  isWord: boolean,
  isRegex: boolean,
): void {
  console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
  payload.interpreter = 'bash';
  const rgFlags = ['-n'];
  if (isCaseInsensitive) rgFlags.push('-i');
  if (isWord) rgFlags.push('-w');
  if (!isRegex) rgFlags.push('-F');
  payload.code = `rg ${rgFlags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(convertToWslPath(searchPath), false)}`;
}

function healListDirEval(payload: EvalPayload, trimmedCode: string): boolean {
  const listDirMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?list_dir(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (listDirMatch === null) return false;
  const rest = (listDirMatch[1] ?? '').trim().replace(/^['"`]|['"`]$/g, '');
  const targetPath = rest.length > 0 ? rest : '.';
  console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `ls ${escapeUnixArg(convertToWslPath(targetPath), false)}`;
  return true;
}

function healViewFileEval(payload: EvalPayload, trimmedCode: string): boolean {
  const viewFileMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?(?:view_file|read_file)(?:\.ts|\.js)?\b\s*(.*)$/i);
  if (viewFileMatch === null || (viewFileMatch[1] ?? '').trim().length === 0) return false;
  const targetPath = (viewFileMatch[1] ?? '').trim().replace(/^['"`]|['"`]$/g, '');
  console.error(`\n   💡 AGENT HINT: 'view_file/read_file' executed directly in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating to cat... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `cat ${escapeUnixArg(convertToWslPath(targetPath), false)}`;
  return true;
}

function healPackageRunnerSearch(payload: EvalPayload, trimmedCode: string): void {
  const pkgRunnerMatch = trimmedCode.match(/^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:rg|ripgrep|fd|fdfind)\b\s*(.*)$/i);
  if (pkgRunnerMatch === null) return;
  const isFd = /^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:fd|fdfind)\b/i.test(trimmedCode);
  const toolName = isFd ? 'fd' : 'rg';
  const rest = pkgRunnerMatch[1] ?? '';
  console.error(`\n   💡 AGENT HINT: '${toolName}' executed via package runner in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating package runner ${toolName} to native ${toolName}... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
  payload.interpreter = 'bash';
  payload.code = `${toolName} ${rest}`.trim();
}

function healGitInspectEval(payload: EvalPayload, trimmedCode: string): void {
  const gitInspectMatch = trimmedCode.match(/^git\s+(status|log|shortlog|diff)\b(.*)$/i);
  if (gitInspectMatch === null || gitInspectMatch[1] === undefined) return;
  const gitSubCmd = gitInspectMatch[1].toLowerCase();
  const cwd = payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : process.cwd();
  const scriptCandidate = findEcosystemScript(cwd, 'get-git-history-json.ts');
  const fallbackScript = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '../../get-git-history-json.ts');
  const script = scriptCandidate ?? fallbackScript;
  if (!fs.existsSync(script)) return;
  console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' inside eval payload detected.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'git ${gitSubCmd}' in eval to get-git-history-json.ts... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'windows';
  payload.interpreter = 'bun';
  payload.code = gitHistorySpawn(script.replace(/\\/g, '/'), cwd.replace(/\\/g, '/'), gitSubCmd);
}

function gitHistorySpawn(scriptPathEscaped: string, cwdEscaped: string, gitSubCmd: string): string {
  const extraArgs = gitSubCmd === 'status'
    ? `, '--uncommitted', '--stats'`
    : gitSubCmd === 'diff'
      ? `, '--stats', '--include-patch'`
      : '';
  return `import { spawnSync } from 'node:child_process'; const res = spawnSync(process.execPath, [${JSON.stringify(scriptPathEscaped)}${extraArgs}], { stdio: 'inherit', cwd: ${JSON.stringify(cwdEscaped)} }); process.exit(res.status ?? 0);`;
}

function healFindMissingName(payload: EvalPayload, trimmedCode: string): void {
  const findGlobMatch = trimmedCode.match(/^find\s+([^\s]+)\s+([*?][^\s]*|[^\s]*[*?][^\s]*)(.*)$/i);
  if (findGlobMatch === null || findGlobMatch[1] === undefined || findGlobMatch[2] === undefined) return;
  const searchPath = findGlobMatch[1];
  const pattern = findGlobMatch[2];
  const rest = findGlobMatch[3] ?? '';
  console.error(`\n   💡 AGENT HINT: 'find' without '-name' flag detected in eval code.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-name' flag for pattern '${pattern}'... (Frictionless Recovery)\x1b[0m`);
  payload.code = `find ${escapeUnixArg(searchPath)} -name ${quoteShellWord(pattern)} ${rest}`.trim();
}

function healBroadFindEval(payload: EvalPayload): void {
  if (!/^find\s+([./~a-zA-Z0-9_-]+)\s+/i.test(payload.code) || payload.code.includes('-prune')) return;
  const broadFindMatch = payload.code.match(/^find\s+([./~a-zA-Z0-9_-]+)\s+(.*)$/i);
  if (broadFindMatch === null || broadFindMatch[1] === undefined || broadFindMatch[2] === undefined) return;
  const rootPath = broadFindMatch[1].trim();
  const rest = broadFindMatch[2];
  const isBroad = rootPath === '.' || rootPath === './' || rootPath === '..' || rootPath === '../' || rootPath.startsWith('/mnt/') || /^[a-zA-Z]:/.test(rootPath);
  if (!isBroad || rest.includes('-maxdepth')) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Broad find in eval payload detected. Auto-injecting directory pruning for node_modules, .git, and dist to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
  payload.code = `find ${rootPath} \\( -name node_modules -o -name .git -o -name dist -o -name .cache -o -name coverage \\) -prune -o ${rest}`;
}

function unbundleQuotedSearchFlags(payload: EvalPayload): void {
  if (!bundledSearchFlagsRegex.test(payload.code)) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern inside quotes in eval code. Unbundling flags... (Frictionless Recovery)\x1b[0m`);
  payload.code = payload.code.replace(bundledSearchFlagsRegex, (full: string, quote: string, flags: string, pattern: string) => {
    const quoted = `${quote}${flags} ${pattern}${quote}`;
    const at = full.lastIndexOf(quoted);
    if (at < 0) return full;
    return `${full.slice(0, at)}${flags} ${quote}${pattern}${quote}`;
  });
}

function healUnquotedRgPattern(payload: EvalPayload): void {
  const rgUnquotedMatch = payload.code.match(/^rg\s+((?:-[^\s]+\s+)*)((?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*\s+){2,})(\/[^\s]+|[a-zA-Z]:[^\s]+|\.[^\s]+|[^\s]+\.[a-zA-Z0-9]+)$/);
  if (rgUnquotedMatch === null || rgUnquotedMatch[2] === undefined || rgUnquotedMatch[3] === undefined) return;
  const flags = rgUnquotedMatch[1] ?? '';
  const pattern = rgUnquotedMatch[2].trim();
  const targetPath = rgUnquotedMatch[3].trim();
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Unquoted search pattern in eval 'rg' detected. Recombining into single quoted pattern... (Frictionless Recovery)\x1b[0m`);
  payload.code = `rg ${flags}"${pattern}" ${targetPath}`;
}

function blockNativeEvalTools(trimmedCode: string): void {
  if ((AGENT_NATIVE_TOOLS as readonly string[]).includes(trimmedCode)) {
    console.error(`\n   💡 AGENT HINT: '${trimmedCode}' is an agent-native tool, NOT executable code or a shell script. Please invoke the '${trimmedCode}' tool directly.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
    process.exit(1);
  }
  const matchedMcpTool = (ECOSYSTEM_MCP_TOOLS as readonly string[]).find(tool => trimmedCode === tool || trimmedCode.startsWith(`${tool}(`) || trimmedCode.startsWith(`${tool} `));
  if (matchedMcpTool === undefined) return;
  console.error(`\n   💡 AGENT HINT: '${matchedMcpTool}' is an MCP tool, NOT executable code or a shell script. Please call the '${matchedMcpTool}' MCP tool via call_mcp_tool.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  process.exit(1);
}

function shellTokens(rest: string): string[] {
  return rest.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
}

function stripWrappingQuotes(token: string): string {
  const wrapped = (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
    || (token.startsWith('`') && token.endsWith('`'));
  if (!wrapped) return token;
  return token.slice(1, -1);
}
