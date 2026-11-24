// @ts-nocheck
import { match, P } from 'ts-pattern';
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { FLAGS_WITH_ARG_BY_TOOL, convertToWslPath, findPatternExprIndex, inspectCombinedShortFlag } from '../command-utils.js';
import { AGENT_EXEC_README_URL, getUnquoted, hasJournalctlFollowFlag, hasJqShortOrLongFlag, hasPreDoubleDashHelpOrVersion, hasSshKeygenNonInteractiveFlags, hasTailFollowFlag, hasXargsArgFile } from './utils.js';
import { handleRipgrepInterception, parseGrepSearchArgs } from './search-interceptor.js';

const EMBEDDED_WIN_SHELL_CMDS = new Set(['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe']);

function rewriteInlineShellToBashIfNeeded(
  ctx: ExecutionContext,
  originalCmd: string,
  inlineFlag: string,
  innerCmdStr: string,
): boolean {
  const isWinShell = EMBEDDED_WIN_SHELL_CMDS.has(originalCmd.toLowerCase());
  if (!isWinShell || ctx.payload.type !== 'command') return false;
  if (['-ec', '-encodedcommand', '-en'].includes(inlineFlag)) return false;
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
  return match(cmd)
    .with(P.union('jq', 'jq.exe', 'yq', 'yq.exe'), () => hasJqShortOrLongFlag(args, 'n', '--null-input') || flags.some(a => a === '--help' || a === '-h' || a === '--version' || a === '-V'))
    .with(P.union('sed', 'sed.exe'), () => flags.includes('-h') || flags.includes('--help') || flags.includes('--version') || flags.includes('-V'))
    .with(P.union('awk', 'gawk'), () => flags.includes('-V') || flags.includes('--version') || flags.includes('-W') || flags.includes('--help') || args.some(a => a.includes('BEGIN')))
    .otherwise(() => false);
}

const CLAUSE_WRAPPER_CMDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', 'time', 'command', 'builtin', 'nohup', 'exec', 'sudo', 'env']);

function parseClauseHeads(stripped: string): Array<{ head: string; argCount: number }> {
  const results: Array<{ head: string; argCount: number }> = [];
  for (const rawClause of stripped.split(/[;\n|&]+/)) {
    const cleaned = rawClause.replace(/^[\s({!]+/, '').trim();
    if (cleaned.length === 0) continue;
    const parts = cleaned.split(/\s+/).filter(Boolean);
    let idx = 0;
    while (idx < parts.length) {
      const tok = parts[idx] ?? '';
      if (/^[a-z_][a-z0-9_]*=/.test(tok) || CLAUSE_WRAPPER_CMDS.has(tok) || (idx > 0 && tok.startsWith('-'))) {
        idx++;
        continue;
      }
      break;
    }
    const rawHead = parts[idx];
    if (rawHead === undefined || rawHead.length === 0) continue;
    const head = rawHead.replace(/^.*[/\\]/, '');
    const restArgs = parts.slice(idx + 1).filter(t => !t.startsWith('-') && !/[><]/.test(t));
    results.push({ head, argCount: restArgs.length });
  }
  return results;
}

const WSL_PREFIX_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const WSL_UNWRAP_BLOCKERS = new Set(['-d', '--distribution', '-u', '--user', '--shell-type']);

function inspectWslExecPrefix(args: readonly string[]): {
  execIdx: number;
  cdDir: string | undefined;
  hasPrefixOverride: boolean;
} {
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
    if (low.startsWith('--distribution=') || low.startsWith('--user=') || low.startsWith('--shell-type=')) {
      hasPrefixOverride = true;
    } else if (low.startsWith('--cd=')) {
      cdDir = a.slice(5);
    }
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
  ctx: ExecutionContext,
  originalCmd: string,
  inlineFlag: string,
  innerCmdStr: string,
  reason: string,
  args: readonly string[],
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
  const isPwshOrigin = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(originalCmd.toLowerCase());

  const networkHeads = isPwshOrigin ? ['curl', 'wget'] : ['curl', 'wget', 'invoke-webrequest', 'iwr'];
  if (heads.some(t => networkHeads.includes(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Network request command in shell string detected.', args);
    return;
  }
  const searchHeads = isPwshOrigin
    ? ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe']
    : ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe'];
  if (heads.some(t => searchHeads.includes(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Search command in shell string detected.', args);
    return;
  }
  const viewClause = clauses.find(c => ['cat', 'cat.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'wc', 'wc.exe', 'more'].includes(c.head));
  const isMultiFilePwshCat = viewClause !== undefined &&
    (viewClause.head === 'cat' || viewClause.head === 'cat.exe') &&
    isPwshOrigin &&
    viewClause.argCount > 1;
  if (viewClause !== undefined && !isMultiFilePwshCat) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'File view command in shell string detected.', args);
    return;
  }
  if (heads.some(t => ['rm', 'rm.exe', 'cp', 'cp.exe', 'mv', 'mv.exe', 'mkdir', 'touch', 'chmod', 'diff'].includes(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'File operation command in shell string detected.', args);
    return;
  }
  const dirHeads = isPwshOrigin
    ? ['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com']
    : ['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'];
  if (heads.some(t => dirHeads.includes(t))) {
    switchEmbeddedShellToWsl(ctx, originalCmd, inlineFlag, innerCmdStr, 'Directory list command in shell string detected.', args);
    return;
  }

  const wrappedShell = (cmdBasename === 'wsl.exe' || cmdBasename === 'wsl')
    ? (args.find((a: string) => ['bash', 'sh', 'pwsh', 'powershell'].includes(a.toLowerCase())) || cmdBasename)
    : cmdBasename;
  console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command (${wrappedShell} ${inlineFlag}). This is an agent hallucination.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
  console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
  console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
  process.exit(1);
}

function translateNativeToolInvocation(ctx: ExecutionContext, originalCmd: string, cmdBasename: string, args: string[]): void {
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
    ctx.args = [convertToWslPath(pathArg)];
    ctx.payload.target = 'wsl2';
    if ('command' in ctx.payload) { ctx.payload.command = 'ls'; ctx.payload.args = ctx.args; }
    console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly as CLI command.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
    return;
  }
  if (toolName === 'view_file' || toolName === 'read_file') {
    const fileArg = args.find(a => !a.startsWith('-'));
    if (fileArg) {
      ctx.cmdBasename = 'cat';
      ctx.args = [convertToWslPath(fileArg)];
      ctx.payload.target = 'wsl2';
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

const PWSH_STOP_INLINE_FLAGS = new Set(['-c', '-command', '-ec', '-encodedcommand', '-en']);
const PWSH_OPT_VALUE_FLAGS = new Set([
  '-executionpolicy', '-ep', '-workingdirectory', '-wd', '-inputformat', '-if',
  '-outputformat', '-of', '-configurationname', '-settingsfile', '-custompipename',
]);

function hasPwshNonImplicitFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const lower = arg.toLowerCase();
    const colonIdx = lower.indexOf(':');
    const head = colonIdx !== -1 ? lower.slice(0, colonIdx) : lower;
    if (head === '--' || PWSH_STOP_INLINE_FLAGS.has(head)) return false;
    if (head === '-version') {
      const next = colonIdx !== -1 ? lower.slice(colonIdx + 1) : args[i + 1];
      if (next !== undefined && /^\d+(?:\.\d+)*$/.test(next)) { if (colonIdx === -1) i++; continue; }
      return true;
    }
    if (colonIdx === -1 && PWSH_OPT_VALUE_FLAGS.has(head)) { i++; continue; }
    if (['-file', '-help', '-h', '-v', '--help', '--version', '-?', '/?'].includes(head) || lower.startsWith('-file:') || lower.startsWith('-f:')) return true;
    if (head === '-f' && (colonIdx !== -1 || i + 1 < args.length)) return true;
  }
  return false;
}

function guardShellAndInteractiveTools(ctx: ExecutionContext, derived: StructuralDerived): boolean {
  const { cmd, cmdBasename, originalCmd, args, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, hasStdin } = derived;
  const payload = ctx.payload;
  return match({ cmd, originalCmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32', payload })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'), hasInlineCmd: true, inlineFlag: P.union('-ec', '-encodedcommand', '-en') }, () => {
      console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: false, args: P.when((a: string[]) => a.length > 0 && !hasPwshNonImplicitFlag(a)) }, () => {
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command implicitly via powershell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
      const stripped = getUnquoted(s);
      return stripped.includes('&&') || stripped.includes('||') || stripped.includes('|') || stripped.includes('>');
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: In PowerShell, avoid using '&&', '||', '|', and '>'. You MUST use semicolons (;) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'), hasInlineCmd: true }, () => {
      rewriteEmbeddedShellTargetToWsl(ctx, originalCmd, args, innerCmdStr, inlineFlag, cmdBasename);
      return true;
    })
    .with({ cmd: P.union('su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe', 'runas', 'runas.exe', 'watch', 'watch.exe') }, () => {
      const reason = cmd.startsWith('watch')
        ? `'watch' command runs indefinitely. Blocking execution to prevent agent hanging.`
        : `'${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.`;
      console.error(`\n   💡 AGENT HINT: ${reason}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('ssh-keygen', 'ssh-keygen.exe') }, () => {
      if (!hasSshKeygenNonInteractiveFlags(args)) {
        console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
        process.exit(1);
      }
      return true;
    })
    .with({ cmd: P.union('sudo', 'sudo.exe'), isWin32: true, payload: P.when(p => p.target !== 'wsl2') }, () => {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('tail', 'tail.exe') }, () => {
      if (hasTailFollowFlag(args)) {
        console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        process.exit(1);
      }
      return true;
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, () => {
      if (hasJournalctlFollowFlag(args)) {
        console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        process.exit(1);
      }
      return true;
    })
    .otherwise(() => false);
}

function guardStdinAndRoutingTools(ctx: ExecutionContext, derived: StructuralDerived): void {
  const { cmd, cmdBasename, originalCmd, args, isCommand, positionalArgs, hasStdin } = derived;
  match({ cmd, originalCmd, isCommand, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32', payload: ctx.payload })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'), positionalArgs: P.when(pa => pa.length === 0) }, () => {
      if (hasPreDoubleDashHelpOrVersion(args, cmd)) return;
      console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('xargs', 'xargs.exe') }, () => {
      if (hasPreDoubleDashHelpOrVersion(args, cmd)) return;
      if (hasXargsArgFile(args)) return;
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      if (!isAwkSedJqSafeWithoutMorePositionals(cmd, args, positionalArgs)) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ isCommand: true, isWin32: true, originalCmd: P.union('curl', 'wget', 'invoke-webrequest', 'iwr'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('grep', 'grep.exe', 'egrep', 'fgrep') }, () => {
      if (hasPreDoubleDashHelpOrVersion(ctx.args)) return;
      const hasPattern = ctx.args.some(
        a => a === '-e' || (a.startsWith('-e') && !a.startsWith('--')) ||
          a === '--regexp' || a.startsWith('--regexp=') ||
          a === '-f' || (a.startsWith('-f') && !a.startsWith('--')) ||
          a === '--file' || a.startsWith('--file='),
      );
      if (positionalArgs.length === 0 && !hasPattern) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
        process.exit(1);
      }
      if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
        ctx.payload.target = 'wsl2';
        const patternIdx = findPatternExprIndex(originalCmd, ctx.args);
        ctx.args = ctx.args.map((a, idx) => idx === patternIdx ? a : convertToWslPath(a));
        if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Search command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      }
    })
    .with({ isCommand: true, isWin32: true, originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      if (args.includes('--help')) return;
      ctx.payload.target = 'wsl2';
      const patternIdx = findPatternExprIndex(originalCmd, ctx.args);
      ctx.args = ctx.args.map((a, idx) => idx === patternIdx ? a : convertToWslPath(a));
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Search command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    })
    .with({ isCommand: true, isWin32: true, originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'), payload: P.when((p: unknown) => typeof p !== 'object' ? false : p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => a.toLowerCase() === '-recurse' ? '-R' : convertToWslPath(a));
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Directory listing command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    })
    .with({ isCommand: true, originalCmd: P.union('rm', 'rm.exe', 'rmdir', 'rmdir.exe'), isWin32: true, payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
      if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: File removal command '${originalCmd}' detected on Windows. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
    })
    .with({ originalCmd: P.when((c: string) => (AGENT_NATIVE_TOOLS as readonly string[]).includes(c.toLowerCase().replace(/\.exe$/, ''))) }, () => {
      translateNativeToolInvocation(ctx, originalCmd, cmdBasename, args);
    })
    .with({ originalCmd: P.when((c: string) => (ECOSYSTEM_MCP_TOOLS as readonly string[]).includes(c.toLowerCase().replace(/\.exe$/, ''))) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' is an MCP tool, NOT a terminal CLI binary. Please call the '${cmdBasename}' MCP tool via call_mcp_tool instead of executing it via the terminal.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
      process.exit(1);
    })
    .otherwise(() => {});
}

export function runStructuralInterceptors(ctx: ExecutionContext, derived: StructuralDerived): void {
  if (tryRewriteWslPwshToBash(ctx, derived.originalCmd, derived.hasInlineCmd, derived.inlineFlag, derived.innerCmdStr)) return;
  if (guardShellAndInteractiveTools(ctx, derived)) return;
  guardStdinAndRoutingTools(ctx, derived);
}
