// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { isJavaScriptOrTypeScriptCode, isPythonCode } from '../eval-healer.js';
import { buildNonCodeSpans } from '../quote-spans.js';
import { DOCKER_VALUE_FLAGS } from './docker-tty-repl-guard.js';
import {
  BUN_REPL_REGEX,
  CMD_PAUSE_REGEX,
  DOCKER_LOGS_REGEX,
  IMPLICIT_PWSH_REGEX,
  INLINE_SHELL_REGEX,
  INTERACTIVE_FLAG_REGEX,
  JOURNALCTL_FOLLOW_REGEX,
  NODE_INSPECT_SUBCMD_REGEX,
  NODE_WATCH_REGEX,
  PM2_INTERACTIVE_REGEX,
  PWSH_NO_EXIT_REGEX,
  PWSH_UI_REGEX,
  REPL_REGEX,
  TAIL_F_REGEX,
  TSX_WATCH_REGEX,
  TUI_REGEX,
  WATCH_REGEX,
  WATCH_TOOL_REGEX,
} from './repl-tui-constants.js';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';

const DOCKER_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);
const JS_TS_INTERPRETERS = new Set(['node', 'bun', 'tsx', 'ts-node', 'js', 'ts', 'javascript', 'typescript']);
const CODE_INTERPRETERS = new Set([...JS_TS_INTERPRETERS, 'python', 'python3', 'py']);
const CODE_FILE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py']);

function isJsTsPayload(payload: ExecutionContext['payload']): boolean {
  if (!('interpreter' in payload) || payload.interpreter === undefined) return false;
  const baseInterp = path.basename(payload.interpreter.toLowerCase()).replace(/\.(?:exe|cmd|bat)$/i, '');
  return JS_TS_INTERPRETERS.has(baseInterp);
}

function stripCommentAndQuoteSpansForShellScan(body: string, includeRegexLiterals: boolean = false): string {
  const spans = buildNonCodeSpans(body, { includeHashComments: true, includeRegexLiterals });
  if (spans.length === 0) return body;
  let result = '';
  let last = 0;
  for (const span of spans) {
    result += body.slice(last, span.start);
    result += ' '.repeat(span.end - span.start);
    last = span.end;
  }
  result += body.slice(last);
  return result;
}

function isNonShellCodeBody(payload: ExecutionContext['payload'], rawBody: string): boolean {
  if (payload.type === 'eval') {
    return isJavaScriptOrTypeScriptCode(rawBody) || isPythonCode(rawBody);
  }
  if (payload.type === 'script') {
    const interp = (payload.interpreter ?? '').toLowerCase();
    const baseInterp = path.basename(interp).replace(/\.(?:exe|cmd|bat)$/i, '');
    if (CODE_INTERPRETERS.has(baseInterp)) return true;
    const ext = path.extname(payload.scriptPath).toLowerCase();
    if (CODE_FILE_EXTS.has(ext)) return true;
    return isJavaScriptOrTypeScriptCode(rawBody) || isPythonCode(rawBody);
  }
  return false;
}

function extractDockerContainerBody(cmdArgs: readonly string[]): string | null {
  const runExecIdx = cmdArgs.findIndex(a => a === 'run' || a === 'exec');
  if (runExecIdx === -1) return null;
  let skipNextValue = false;
  let containerName: string | null = null;
  let containerCmd: string | null = null;
  const containerCmdArgs: string[] = [];

  for (let i = runExecIdx + 1; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === undefined) continue;
    if (skipNextValue) { skipNextValue = false; continue; }
    if (arg === '-T' || arg === '--no-TTY') continue;
    if (containerName === null && arg.startsWith('-')) {
      if (DOCKER_VALUE_FLAG_SET.has(arg) || (arg.startsWith('--') && arg.includes('='))) {
        if (!arg.includes('=')) skipNextValue = true;
      }
      continue;
    }
    if (containerName === null) { containerName = arg; continue; }
    if (containerCmd === null) { containerCmd = arg; continue; }
    containerCmdArgs.push(arg);
  }

  if (containerCmd === null) return null;
  const baseCmd = path.posix.basename(containerCmd.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd'].includes(baseCmd)) {
    const cIdx = containerCmdArgs.findIndex(a => ['-c', '-command', '/c'].includes(a.toLowerCase()));
    if (cIdx !== -1 && cIdx + 1 < containerCmdArgs.length) {
      return containerCmdArgs.slice(cIdx + 1).join(' ').replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return [containerCmd, ...containerCmdArgs].join(' ');
}

export function extractRawScriptBody(ctx: ExecutionContext): string | null {
  const { payload, cmdBasename, args } = ctx;
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script') {
    try {
      const baseCwd = payload.cwd !== undefined && payload.cwd.length > 0
        ? path.resolve(payload.cwd)
        : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());
      return fs.readFileSync(path.resolve(baseCwd, payload.scriptPath), 'utf8');
    } catch {
      return null;
    }
  }
  const lowerCmd = cmdBasename.toLowerCase();
  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(lowerCmd)) {
    const idx = args.findIndex(a => a.toLowerCase() === '-c' || a.toLowerCase() === '-command');
    return idx !== -1 && idx + 1 < args.length ? args.slice(idx + 1).join(' ').replace(/^['"]|['"]$/g, '').trim() : null;
  }
  if (['sh', 'sh.exe', 'bash', 'bash.exe', 'zsh', 'zsh.exe'].includes(lowerCmd)) {
    const idx = args.findIndex(a => a === '-c');
    return idx !== -1 && idx + 1 < args.length ? (args[idx + 1] ?? null) : null;
  }
  if (['cmd', 'cmd.exe'].includes(lowerCmd)) {
    const idx = args.findIndex(a => a.toLowerCase() === '/c');
    return idx !== -1 && idx + 1 < args.length ? args.slice(idx + 1).join(' ') : null;
  }
  if (['wsl', 'wsl.exe'].includes(lowerCmd)) {
    const eIdx = args.findIndex(a => a === '-e' || a === '--exec');
    return eIdx !== -1 && eIdx + 1 < args.length ? args.slice(eIdx + 1).join(' ') : args.filter(a => !a.startsWith('-')).join(' ');
  }
  if (['npx', 'npx.exe', 'npx.cmd', 'pnpx', 'pnpx.exe', 'pnpx.cmd', 'bunx', 'bunx.exe', 'bunx.cmd', 'yarn', 'yarn.exe', 'yarn.cmd'].includes(lowerCmd)) {
    const idx = args.findIndex(a => !a.startsWith('-'));
    return idx !== -1 ? args.slice(idx).join(' ') : null;
  }
  if (['env', 'env.exe', 'sudo', 'sudo.exe', 'su', 'su.exe', 'doas', 'doas.exe', 'time', 'time.exe', 'timeout', 'timeout.exe', 'stdbuf', 'stdbuf.exe'].includes(lowerCmd)) {
    const idx = args.findIndex(a => !a.startsWith('-') && !a.includes('='));
    return idx !== -1 ? args.slice(idx).join(' ') : null;
  }
  if (['docker', 'docker.exe', 'docker.bat', 'docker-compose', 'docker-compose.exe', 'docker-compose.bat'].includes(lowerCmd)) {
    return extractDockerContainerBody(args);
  }
  return null;
}

function isBlockedReplInBody(body: string): boolean {
  if (INTERACTIVE_FLAG_REGEX.test(body) || NODE_INSPECT_SUBCMD_REGEX.test(body)) return true;
  const m = REPL_REGEX.exec(body);
  if (m === null) return false;
  const delimiter = (m[1] ?? '').trim();
  if (delimiter.startsWith('|') || delimiter.startsWith('<')) return false;
  const before = body.slice(0, m.index);
  return !before.trim().endsWith('|') && !before.trim().endsWith('<');
}

function blockScriptPattern(hint: string, detail?: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  if (detail !== undefined) console.error(`   ${detail}`);
  console.error(`   Please use standard terminal commands instead.`);
  process.exit(1);
}

export function scanExtractedScriptBody(ctx: ExecutionContext): void {
  const rawBody = extractRawScriptBody(ctx);
  if (rawBody === null || isNonShellCodeBody(ctx.payload, rawBody)) return;

  const body = stripCommentAndQuoteSpansForShellScan(rawBody, isJsTsPayload(ctx.payload));
  const label = ctx.payload.type === 'eval' ? 'an eval payload' : 'an inline script';

  if (TUI_REGEX.test(body)) {
    const m = TUI_REGEX.exec(body);
    blockScriptPattern(`You passed '${m?.[3]?.toLowerCase() ?? 'tui-app'}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  }
  if (isBlockedReplInBody(body)) {
    const m = REPL_REGEX.exec(body) ?? INTERACTIVE_FLAG_REGEX.exec(body) ?? NODE_INSPECT_SUBCMD_REGEX.exec(body);
    blockScriptPattern(`You passed '${m?.[3]?.toLowerCase() ?? 'repl-app'}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  }
  if (WATCH_REGEX.test(body)) blockScriptPattern(`You passed 'watch' inside ${label}.`, `Continuous watch commands will hang indefinitely.`);
  if (TAIL_F_REGEX.test(body)) blockScriptPattern(`You passed 'tail -f' inside ${label}.`);
  if (JOURNALCTL_FOLLOW_REGEX.test(body)) blockScriptPattern(`'journalctl -f' runs indefinitely. Blocking execution.`);
  if (DOCKER_LOGS_REGEX.test(body)) blockScriptPattern(`'docker logs -f' runs indefinitely. Blocking execution.`);
  if (NODE_WATCH_REGEX.test(body) || WATCH_TOOL_REGEX.test(body) || TSX_WATCH_REGEX.test(body)) {
    blockScriptPattern(`Node watch mode runs indefinitely. Blocking execution.`);
  }
  if (PM2_INTERACTIVE_REGEX.test(body)) blockScriptPattern(`'pm2' is interactive/runs indefinitely. Blocking execution.`);
  if (BUN_REPL_REGEX.test(body)) blockScriptPattern(`'bun repl' is interactive and will hang indefinitely. Blocking execution.`);
  if (CMD_PAUSE_REGEX.test(body)) blockScriptPattern(`'pause' in cmd waits for a keypress and will hang indefinitely. Blocking execution.`);

  if (ctx.payload.target !== 'wsl2') {
    if (PWSH_NO_EXIT_REGEX.test(body) || PWSH_UI_REGEX.test(body)) {
      blockScriptPattern(`PowerShell -NoExit or UI cmdlets will hang headlessly. Blocking execution.`);
    }
    if (INLINE_SHELL_REGEX.test(body)) {
      blockScriptPattern(
        `You attempted to run an inline shell command inside an eval/script payload. This is an agent hallucination.`,
        `Please use the proper execution payloads (type: "command" or type: "eval" with target: "wsl2") instead of nesting shell wrappers.`,
      );
    }
    if (IMPLICIT_PWSH_REGEX.test(body)) {
      blockScriptPattern(`You attempted to run an inline shell command implicitly via powershell.`, `This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
    }
  }
}
