// @ts-nocheck
import { AGENT_NATIVE_TOOL_SET, ECOSYSTEM_MCP_TOOL_SET, type ExecutionContext } from './types.js';
import { FLAGS_WITH_ARG_BY_TOOL, convertToWslPath, findPatternExprIndex, inspectCombinedShortFlag } from '../command-utils.js';
import { AGENT_EXEC_README_URL, getUnquoted, hasJournalctlFollowFlag, hasJqShortOrLongFlag, hasPreDoubleDashHelpOrVersion, hasSshKeygenNonInteractiveFlags, hasTailFollowFlag, hasXargsArgFile } from './utils.js';
import { isGrepMissingInputTarget } from './grep-arg-parser.js';
import { handleRipgrepInterception, parseGrepSearchArgs } from './search-interceptor.js';
import { isPwshEncodedCommandFlag, isPwshFileFlag, isPwshInlineStopFlag } from './system-command-context.js';

const EMBEDDED_WIN_SHELL_CMDS = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']);

function rewriteInlineShellToBashIfNeeded(ctx: ExecutionContext, originalCmd: string, inlineFlag: string, innerCmdStr: string): boolean {
  const isWinShell = EMBEDDED_WIN_SHELL_CMDS.has(originalCmd.toLowerCase());
  if (!isWinShell || ctx.payload.type !== 'command') return false;
  if (isPwshEncodedCommandFlag(inlineFlag)) return false;
  ctx.cmdBasename = 'bash';
  ctx.args = ['-c', innerCmdStr];
  ctx.payload.command = 'bash';
  ctx.payload.args = ctx.args;
  return true;
}

function tryRewriteWslPwshToBash(
  ctx: ExecutionContext,
  originalCmd: string,
  hasInlineCmd: boolean,
  inlineFlag: string,
  innerCmdStr: string,
): boolean {
  if (ctx.payload.target !== 'wsl2' || !hasInlineCmd) return false;
  if (!rewriteInlineShellToBashIfNeeded(ctx, originalCmd, inlineFlag, innerCmdStr)) return false;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Rewriting WSL2-targeted '${originalCmd}' inline command to 'bash -c'... (Frictionless Recovery)\x1b[0m`);
  return true;
}

const PWSH_HELP_VERSION_FLAGS: ReadonlySet<string> = new Set(['-help', '-h', '-v', '--help', '--version', '-?', '/?']);
const NETWORK_HEADS_BASE: ReadonlySet<string> = new Set(['curl', 'wget']);
const NETWORK_HEADS_WIN: ReadonlySet<string> = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr']);
const SEARCH_HEADS_BASE: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']);
const SEARCH_HEADS_WIN: ReadonlySet<string> = new Set([
  'grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe',
]);
const VIEW_CLAUSE_HEADS: ReadonlySet<string> = new Set(['cat', 'cat.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'wc', 'wc.exe', 'more']);
const FILE_OP_HEADS: ReadonlySet<string> = new Set(['rm', 'rm.exe', 'cp', 'cp.exe', 'mv', 'mv.exe', 'mkdir', 'touch', 'chmod', 'diff']);
const DIR_HEADS_BASE: ReadonlySet<string> = new Set(['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com']);
const DIR_HEADS_WIN: ReadonlySet<string> = new Set([
  'ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com',
]);
const WRAPPED_SHELL_BASES: ReadonlySet<string> = new Set(['bash', 'sh', 'pwsh', 'powershell']);

function isAwkSedJqSafeWithoutMorePositionals(cmd: string, args: readonly string[], positionalArgs: readonly string[]): boolean {
  const base = cmd.toLowerCase().replace(/\.exe$/, '');
  const ddIdx = args.indexOf('--');
  const flags = ddIdx === -1 ? args : args.slice(0, ddIdx);
  const isSedOrAwk = base === 'sed' || base === 'awk' || base === 'gawk';
  const toolFlags = Object.hasOwn(FLAGS_WITH_ARG_BY_TOOL, base) ? FLAGS_WITH_ARG_BY_TOOL[base] : undefined;
  const hasExprOrFileFlag = flags.some((a) => {
    const short = inspectCombinedShortFlag(base, a, toolFlags).shortPrefix;
    if (short.length > 1 && (short.includes('f') || (isSedOrAwk && short.includes('e')))) return true;
    return (isSedOrAwk && (a === '-e' || (a.startsWith('-e') && !a.startsWith('--')) || a === '--expression' || a.startsWith('--expression='))) ||
      a === '-f' || (a.startsWith('-f') && !a.startsWith('--')) ||
      a === '--file' || a.startsWith('--file=') ||
      a === '--from-file' || a.startsWith('--from-file=') ||
      a === '--source' || a.startsWith('--source=');
  });
  if (hasExprOrFileFlag && positionalArgs.length >= 1) return true;
  if (base === 'jq' || base === 'yq') {
    return hasJqShortOrLongFlag(args, 'n', '--null-input') || flags.some(a => a === '--help' || a === '-h' || a === '--version' || a === '-V');
  }
  if (base === 'sed') {
    return flags.includes('-h') || flags.includes('--help') || flags.includes('--version') || flags.includes('-V');
  }
  if (base === 'awk' || base === 'gawk') {
    return flags.includes('-V') || flags.includes('--version') || flags.includes('-W') || flags.includes('--help') || args.some(a => a.includes('BEGIN'));
  }
  return false;
}

const CLAUSE_WRAPPER_CMDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time', 'command', 'builtin', 'nohup', 'exec', 'sudo', 'env']);

const CLAUSE_SPLIT_RE = /[;\n|&]+/;
const CLAUSE_LEAD_STRIP_RE = /^[\s({!]+/;
const CLAUSE_WS_RE = /\s+/;
const CLAUSE_ENV_ASSIGN_RE = /^[a-z_][a-z0-9_]*=/;
const CLAUSE_PATH_DIR_RE = /^.*[/\\]/;
const CLAUSE_REDIR_RE = /[><]/;
const PWSH_VERSION_TOKEN_RE = /^\d+(?:\.\d+)*$/;

function parseClauseHeads(stripped: string): Array<{ head: string; argCount: number }> {
  const results: Array<{ head: string; argCount: number }> = [];
  for (const rawClause of stripped.split(CLAUSE_SPLIT_RE)) {
    const cleaned = rawClause.replace(CLAUSE_LEAD_STRIP_RE, '').trim();
    if (cleaned.length === 0) continue;
    const parts = cleaned.split(CLAUSE_WS_RE).filter(Boolean);
    let idx = 0;
    while (idx < parts.length) {
      const tok = parts[idx] ?? '';
      if (!(CLAUSE_ENV_ASSIGN_RE.test(tok) || CLAUSE_WRAPPER_CMDS.has(tok) || (idx > 0 && tok.startsWith('-')))) break;
      idx++;
    }
    const rawHead = parts[idx];
    if (rawHead === undefined || rawHead.length === 0) continue;
    const head = rawHead.replace(CLAUSE_PATH_DIR_RE, '');
    results.push({ head, argCount: parts.slice(idx + 1).filter(t => !t.startsWith('-') && !CLAUSE_REDIR_RE.test(t)).length });
  }
  return results;
}

const WSL_PREFIX_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const WSL_UNWRAP_BLOCKERS = WSL_PREFIX_VALUE_FLAGS;

function inspectWslExecPrefix(args: readonly string[]): { execIdx: number; cdDir: string | undefined; hasPrefixOverride: boolean } {
  let cdDir: string | undefined;
  let hasPrefixOverride = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const low = a.toLowerCase();
    if (low === '--') break;
    if (low === '-e' || low === '--exec') return { execIdx: i, cdDir, hasPrefixOverride };
    if (WSL_PREFIX_VALUE_FLAGS.has(low)) {
      if (low === '--cd') cdDir = args[i + 1];
      else if (WSL_UNWRAP_BLOCKERS.has(low)) hasPrefixOverride = true;
      i++;
      continue;
    }
    if (low.startsWith('--distribution=') || low.startsWith('--user=') || low.startsWith('--shell-type=')) hasPrefixOverride = true;
    else if (low.startsWith('--cd=')) cdDir = a.slice(5);
  }
  return { execIdx: -1, cdDir, hasPrefixOverride };
}

function unwrapWslExecToInnerCommand(ctx: ExecutionContext, args: readonly string[]): boolean {
  if (ctx.payload.type !== 'command') return false;
  const { execIdx, cdDir, hasPrefixOverride } = inspectWslExecPrefix(args);
  if (hasPrefixOverride || execIdx === -1 || execIdx + 1 >= args.length) return false;
  const innerCmd = args[execIdx + 1];
  if (innerCmd === undefined || innerCmd.length === 0) return false;
  if (cdDir !== undefined && cdDir.length > 0) ctx.payload.cwd = cdDir;
  const normalized = innerCmd.replace(/^.*[/\\]/, '');
  ctx.cmdBasename = normalized;
  ctx.args = args.slice(execIdx + 2);
  ctx.payload.command = normalized;
  ctx.payload.args = ctx.args;
  return true;
}

function switchEmbeddedShellToWsl(
  ctx: ExecutionContext, originalCmd: string, inlineFlag: string, innerCmdStr: string, reason: string, args: readonly string[],
): void {
  const lowerOrig = originalCmd.toLowerCase();
  if ((lowerOrig === 'wsl' || lowerOrig === 'wsl.exe') && (inlineFlag === '-e' || inlineFlag === '--exec')) {
    if (!unwrapWslExecToInnerCommand(ctx, args)) return;
    ctx.payload.target = 'wsl2';
  } else {
    ctx.payload.target = 'wsl2';
    rewriteInlineShellToBashIfNeeded(ctx, originalCmd, inlineFlag, innerCmdStr);
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: ${reason} Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
}

function rewriteEmbeddedShellTargetToWsl(
  ctx: ExecutionContext,
  originalCmd: string,
  args: readonly string[],
  innerCmdStr: string,
  inlineFlag: string,
  cmdBasename: string,
): void {
  const payload = ctx.payload;
  if (payload.target === 'wsl2') return;
  const stripped = getUnquoted(innerCmdStr).toLowerCase();
  const clauses = parseClauseHeads(stripped);
  const heads = clauses.map(c => c.head);
  const isPwshOrigin = STRUCTURAL_PWSH_SET.has(originalCmd.toLowerCase());

  const networkHeads = isPwshOrigin ? NETWORK_HEADS_BASE : NETWORK_HEADS_WIN;
  if (heads.some(t => networkHeads.has(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Network request command in shell string detected.', args);
    return;
  }
  const searchHeads = isPwshOrigin ? SEARCH_HEADS_BASE : SEARCH_HEADS_WIN;
  if (heads.some(t => searchHeads.has(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Search command in shell string detected.', args);
    return;
  }
  const viewClause = clauses.find(c => VIEW_CLAUSE_HEADS.has(c.head));
  const isMultiFilePwshCat = viewClause !== undefined &&
    (viewClause.head === 'cat' || viewClause.head === 'cat.exe') &&
    isPwshOrigin &&
    viewClause.argCount > 1;
  if (viewClause !== undefined && !isMultiFilePwshCat) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'File view command in shell string detected.', args);
    return;
  }
  if (heads.some(t => FILE_OP_HEADS.has(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'File operation command in shell string detected.', args);
    return;
  }
  const dirHeads = isPwshOrigin ? DIR_HEADS_BASE : DIR_HEADS_WIN;
  if (heads.some(t => dirHeads.has(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Directory list command in shell string detected.', args);
    return;
  }

  const wrappedShell = (cmdBasename === 'wsl.exe' || cmdBasename === 'wsl')
    ? (args.find((a: string) => WRAPPED_SHELL_BASES.has(a.toLowerCase())) || cmdBasename)
    : cmdBasename;
  console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command (${wrappedShell} ${inlineFlag}). This is an agent hallucination.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
  console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
  console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
  process.exit(1);
}

function translateNativeToolInvocation(ctx: ExecutionContext, originalCmd: string, cmdBasename: string, args: string[]): void {
  const isWin32 = process.platform === 'win32';
  const toolName = originalCmd.toLowerCase().replace(/\.exe$/, '');
  if (toolName === 'grep_search') {
    const { pattern, searchPath, isCaseInsensitive, isWord, isRegex } = parseGrepSearchArgs(args, ctx.payload.cwd ?? ctx.cwd);
    if (pattern.length > 0) {
      ctx.cmdBasename = 'rg';
      const rgFlags = ['-n'];
      if (isCaseInsensitive) rgFlags.push('-i');
      if (isWord) rgFlags.push('-w');
      if (!isRegex) rgFlags.push('-F');
      if (pattern.startsWith('-')) rgFlags.push('-e');
      ctx.args = [...rgFlags, pattern, searchPath];
      if ('command' in ctx.payload) { ctx.payload.command = 'rg'; ctx.payload.args = ctx.args; }
      console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly as CLI command.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
      handleRipgrepInterception(ctx, false);
      return;
    }
    if (searchPath.length > 0) {
      ctx.cmdBasename = 'rg';
      ctx.args = ['--files', searchPath];
      if ('command' in ctx.payload) { ctx.payload.command = 'rg'; ctx.payload.args = ctx.args; }
      console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly as CLI command without search pattern.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg) --files... (Frictionless Recovery)\x1b[0m`);
      handleRipgrepInterception(ctx, false);
      return;
    }
  }
  if (toolName === 'list_dir') {
    const pathArg = args.find(a => !a.startsWith('-')) ?? '.';
    ctx.cmdBasename = 'ls';
    ctx.args = [isWin32 ? convertToWslPath(pathArg) : pathArg];
    if (isWin32) ctx.payload.target = 'wsl2';
    if ('command' in ctx.payload) { ctx.payload.command = 'ls'; ctx.payload.args = ctx.args; }
    console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly as CLI command.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
    return;
  }
  if (toolName === 'view_file' || toolName === 'read_file') {
    const fileArg = args.find(a => !a.startsWith('-'));
    if (fileArg) {
      ctx.cmdBasename = 'cat';
      ctx.args = [isWin32 ? convertToWslPath(fileArg) : fileArg];
      if (isWin32) ctx.payload.target = 'wsl2';
      if ('command' in ctx.payload) { ctx.payload.command = 'cat'; ctx.payload.args = ctx.args; }
      console.error(`\n   💡 AGENT HINT: '${toolName}' executed directly as CLI command.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${toolName}' to cat... (Frictionless Recovery)\x1b[0m`);
      return;
    }
  }
  console.error(`\n   💡 AGENT HINT: '${cmdBasename}' is an agent-native tool, NOT a terminal CLI binary. Please invoke the '${cmdBasename}' tool directly instead of executing it via the terminal.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  process.exit(1);
}

interface StructuralDerived {
  cmd: string;
  cmdBasename: string;
  originalCmd: string;
  args: string[];
  isCommand: boolean;
  hasInlineCmd: boolean;
  inlineFlag: string;
  innerCmdStr: string;
  positionalArgs: string[];
  hasStdin: boolean;
}

const PWSH_OPT_VALUE_FLAGS = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-configurationfile', '-settingsfile', '-custompipename', '-windowstyle', '-w',
]);

function hasPwshNonImplicitFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const lower = arg.toLowerCase();
    const colonIdx = lower.indexOf(':');
    const head = colonIdx !== -1 ? lower.slice(0, colonIdx) : lower;
    if (head === '--' || isPwshInlineStopFlag(head)) return false;
    if (!lower.startsWith('-') && lower !== '/?') return false;
    if (head === '-version') {
      const next = colonIdx !== -1 ? lower.slice(colonIdx + 1) : args[i + 1];
      if (next !== undefined && PWSH_VERSION_TOKEN_RE.test(next)) { if (colonIdx === -1) i++; continue; }
      return true;
    }
    if (colonIdx === -1 && PWSH_OPT_VALUE_FLAGS.has(head)) { i++; continue; }
    if ((head !== '-f' && isPwshFileFlag(head)) || PWSH_HELP_VERSION_FLAGS.has(head)) return true;
    if (head === '-f' && (colonIdx !== -1 || i + 1 < args.length)) return true;
  }
  return false;
}

function exitBlockedStructural(hint: string, ...details: string[]): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  for (const line of details) console.error(`   ${line}`);
  process.exit(1);
}

function routeWslWithMap(
  ctx: ExecutionContext,
  msg: string,
  mapArg: (arg: string, idx: number) => string = convertToWslPath,
): void {
  ctx.payload.target = 'wsl2';
  ctx.args = ctx.args.map(mapArg);
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(msg);
}

const STRUCTURAL_PWSH_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe']);
const STRUCTURAL_SHELL_SET: ReadonlySet<string> = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe']);
const STRUCTURAL_PROMPT_AUTH_SET: ReadonlySet<string> = new Set(['su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe', 'runas', 'runas.exe', 'watch', 'watch.exe']);
const STRUCTURAL_STDIN_TOOLS_SET: ReadonlySet<string> = new Set(['cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe']);
const STRUCTURAL_AWK_SED_JQ_SET: ReadonlySet<string> = new Set(['awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe']);
const STRUCTURAL_CURL_SET: ReadonlySet<string> = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr']);
const STRUCTURAL_GREP_SET: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']);
const STRUCTURAL_GREP_EX_SET: ReadonlySet<string> = new Set(['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe']);
const STRUCTURAL_LIST_SET: ReadonlySet<string> = new Set(['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com']);
const STRUCTURAL_RM_SET: ReadonlySet<string> = new Set(['rm', 'rm.exe', 'rmdir', 'rmdir.exe']);
const GPG_NON_STDIN_FLAGS = new Set([
  '-k', '-K', '--list-keys', '--list-public-keys', '--list-secret-keys', '--list-sigs',
  '--check-sigs', '--fingerprint', '--export', '--export-secret-keys', '--export-secret-subkeys',
  '--list-config', '--dump-options', '--card-status',
]);

function guardShellAndInteractiveTools(ctx: ExecutionContext, derived: StructuralDerived): boolean {
  const { cmd, cmdBasename, originalCmd, args, isCommand, hasInlineCmd, inlineFlag, innerCmdStr } = derived;
  if (isCommand && STRUCTURAL_PWSH_SET.has(originalCmd)) {
    if (hasInlineCmd && isPwshEncodedCommandFlag(inlineFlag)) {
      exitBlockedStructural(`Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.`);
    }
    if (!hasInlineCmd && args.length > 0 && !hasPwshNonImplicitFlag(args)) {
      exitBlockedStructural(
        `You attempted to run an inline shell command implicitly via powershell.`,
        `This bypasses the agent-exec robustness interceptors and risks hanging the process.`,
        `Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`,
        `If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`,
      );
    }
    if (hasInlineCmd) {
      const stripped = getUnquoted(innerCmdStr);
      if (stripped.includes('&&') || stripped.includes('||') || stripped.includes('|') || stripped.includes('>')) {
        exitBlockedStructural(`In PowerShell, avoid using '&&', '||', '|', and '>'. You MUST use semicolons (;) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.`);
      }
    }
  }
  if (isCommand && hasInlineCmd && STRUCTURAL_SHELL_SET.has(originalCmd)) {
    rewriteEmbeddedShellTargetToWsl(ctx, originalCmd, args, innerCmdStr, inlineFlag, cmdBasename);
    return true;
  }
  if (STRUCTURAL_PROMPT_AUTH_SET.has(cmd)) {
    exitBlockedStructural(cmd.startsWith('watch')
      ? `'watch' command runs indefinitely. Blocking execution to prevent agent hanging.`
      : `'${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.`);
  }
  if (cmd === 'ssh-keygen' || cmd === 'ssh-keygen.exe') {
    if (!hasSshKeygenNonInteractiveFlags(args)) {
      exitBlockedStructural(`'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.`, `Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
    }
    return true;
  }
  if ((cmd === 'sudo' || cmd === 'sudo.exe') && process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
    exitBlockedStructural(`'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.`);
  }
  if (cmd === 'tail' || cmd === 'tail.exe') {
    if (hasTailFollowFlag(args)) exitBlockedStructural(`'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.`);
    return true;
  }
  if (cmd === 'journalctl' || cmd === 'journalctl.exe') {
    if (hasJournalctlFollowFlag(args)) exitBlockedStructural(`'journalctl -f' runs indefinitely. Blocking execution.`);
    return true;
  }
  return false;
}

function routeWin32AliasToWsl(ctx: ExecutionContext, originalCmd: string, isWin32: boolean): boolean {
  if (!isWin32 || ctx.payload.target === 'wsl2') return false;
  if (STRUCTURAL_CURL_SET.has(originalCmd)) {
    routeWslWithMap(ctx, `\n   🛠️ AUTONOMOUS HEALING: Network request command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    return true;
  }
  if (STRUCTURAL_GREP_EX_SET.has(originalCmd)) {
    if (hasPreDoubleDashHelpOrVersion(ctx.args)) return true;
    const patternIdx = findPatternExprIndex(originalCmd, ctx.args);
    routeWslWithMap(ctx, `\n   🛠️ AUTONOMOUS HEALING: Search command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`, (a, idx) => idx === patternIdx ? a : convertToWslPath(a));
    return true;
  }
  if (STRUCTURAL_LIST_SET.has(originalCmd)) {
    routeWslWithMap(ctx, `\n   🛠️ AUTONOMOUS HEALING: Directory listing command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`, a => a.toLowerCase() === '-recurse' ? '-R' : convertToWslPath(a));
    return true;
  }
  if (STRUCTURAL_RM_SET.has(originalCmd)) {
    routeWslWithMap(ctx, `\n   🛠️ AUTONOMOUS HEALING: File removal command '${originalCmd}' detected on Windows. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    return true;
  }
  return false;
}

function guardStdinAndRoutingTools(ctx: ExecutionContext, derived: StructuralDerived): void {
  const { cmd, cmdBasename, originalCmd, args, isCommand, positionalArgs, hasStdin } = derived;
  const origBaseLower = originalCmd.toLowerCase().replace(/\.exe$/, '');
  if (isCommand && !hasStdin && STRUCTURAL_STDIN_TOOLS_SET.has(cmd) && positionalArgs.length === 0) {
    if (hasPreDoubleDashHelpOrVersion(args, cmd)) return;
    const ddIdx = (cmd === 'gpg' || cmd === 'gpg.exe') ? args.indexOf('--') : -1;
    if ((cmd === 'gpg' || cmd === 'gpg.exe') && (ddIdx === -1 ? args : args.slice(0, ddIdx)).some(a => GPG_NON_STDIN_FLAGS.has(a))) return;
    exitBlockedStructural(`'${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.`);
  }
  if (isCommand && !hasStdin && (cmd === 'xargs' || cmd === 'xargs.exe')) {
    if (!hasPreDoubleDashHelpOrVersion(args, cmd) && !hasXargsArgFile(args)) exitBlockedStructural(`'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.`);
    return;
  }
  if (isCommand && !hasStdin && STRUCTURAL_AWK_SED_JQ_SET.has(cmd) && positionalArgs.length <= 1) {
    if (!isAwkSedJqSafeWithoutMorePositionals(cmd, args, positionalArgs)) exitBlockedStructural(`'${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.`);
    return;
  }
  if (isCommand && !hasStdin && STRUCTURAL_GREP_SET.has(cmd) && !hasPreDoubleDashHelpOrVersion(ctx.args) && isGrepMissingInputTarget(ctx.args, positionalArgs)) {
    console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
    process.exit(1);
  }
  if (isCommand && routeWin32AliasToWsl(ctx, originalCmd, process.platform === 'win32')) return;
  if (AGENT_NATIVE_TOOL_SET.has(origBaseLower)) {
    translateNativeToolInvocation(ctx, originalCmd, cmdBasename, args);
  } else if (ECOSYSTEM_MCP_TOOL_SET.has(origBaseLower)) {
    console.error(`\n   💡 AGENT HINT: '${cmdBasename}' is an MCP tool, NOT a terminal CLI binary. Please call the '${cmdBasename}' MCP tool via call_mcp_tool instead of executing it via the terminal.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
    process.exit(1);
  }
}

export function runStructuralInterceptors(ctx: ExecutionContext, derived: StructuralDerived): void {
  if (!tryRewriteWslPwshToBash(ctx, derived.originalCmd, derived.hasInlineCmd, derived.inlineFlag, derived.innerCmdStr) && !guardShellAndInteractiveTools(ctx, derived)) {
    guardStdinAndRoutingTools(ctx, derived);
  }
}
