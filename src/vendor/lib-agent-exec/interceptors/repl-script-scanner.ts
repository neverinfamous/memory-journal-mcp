// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
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
  findInteractiveDbOrSshInBody,
} from './repl-tui-constants.js';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';

const DOCKER_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);
const CODE_INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'tsx', 'ts-node', 'js', 'ts', 'javascript', 'typescript', 'python', 'python3', 'py']);
const CODE_FILE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const GLOBAL_REPL_REGEX = new RegExp(REPL_REGEX.source, `${REPL_REGEX.flags.replace(/g/g, '')}g`);

const WRAPPER_ASSIGN_OR_CMD = `(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+|(?:sudo|env|su|doas|time|timeout|stdbuf|nohup|exec)(?:\\s+(?:-[^\\s;|&]+|\\d+(?:\\.\\d+)?[smhd]?))*\\s+)*`;
const SHELL_HEAD_WRAPPER_RE = new RegExp(`(?:^|[;\\n&|{\`]|\\$\\()\\s*${WRAPPER_ASSIGN_OR_CMD}$`);
const NESTED_POSIX_SHELL_C_RE = new RegExp(
  `(?:^|[;\\n&|{\`]|\\$\\()\\s*${WRAPPER_ASSIGN_OR_CMD}['"]?(?:[^\\s;|&\`'"]*[\\\\/])?(?:bash|sh|zsh)(?:\\.exe)?['"]?(?:\\s+(?:--(?:rcfile|init-file)(?:=\\S+|\\s+\\S+)|--[a-zA-Z0-9-]+(?:=\\S+)?|[-+][a-zA-Z]*[oO]\\s+\\S+|[-+][a-zA-Z]+))*\\s+(?:-[a-zA-Z]*(?:[oO][a-zA-Z]*c|c[a-zA-Z]*[oO])\\s+\\S+|(?:-[a-zA-Z]*c|-c|--command)(?:\\s+[-+][oO]\\s+\\S+)?)\\s*$`,
  'i',
);

function unescapeDoubleQuotedInner(raw: string): string {
  return raw.replace(/\\(["\\$`])/g, '$1');
}

function findSegmentStartBefore(body: string, pos: number): number {
  const dollarParenIdx = body.lastIndexOf('$(', pos - 1);
  return Math.max(
    body.lastIndexOf('\n', pos - 1),
    body.lastIndexOf(';', pos - 1),
    body.lastIndexOf('&', pos - 1),
    body.lastIndexOf('|', pos - 1),
    body.lastIndexOf('{', pos - 1),
    body.lastIndexOf('`', pos - 1),
    dollarParenIdx === -1 ? -1 : dollarParenIdx + 1,
  ) + 1;
}

function inspectShellQuoteSpans(body: string): { sanitized: string; dbSanitized: string; nestedBodies: string[] } {
  const spans = buildNonCodeSpans(body, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
  if (spans.length === 0) return { sanitized: body, dbSanitized: body, nestedBodies: [] };
  let sanitized = '';
  let dbSanitized = '';
  let last = 0;
  const nestedBodies: string[] = [];
  for (const span of spans) {
    const segStart = findSegmentStartBefore(body, span.start);
    const prefix = body.slice(segStart, span.start);
    const quote = body[span.start];
    const hasClosed = span.end - span.start >= 2 && body[span.end - 1] === quote;
    const inner = hasClosed ? body.slice(span.start + 1, span.end - 1) : body.slice(span.start + 1);
    const plainChunk = body.slice(last, span.start);
    sanitized += plainChunk;
    dbSanitized += plainChunk;
    const blank = ' '.repeat(span.end - span.start);
    if ((quote === '"' || quote === "'") && NESTED_POSIX_SHELL_C_RE.test(prefix)) {
      nestedBodies.push(quote === '"' ? unescapeDoubleQuotedInner(inner) : inner);
      sanitized += blank;
      dbSanitized += blank;
    } else if ((quote === '"' || quote === "'") && SHELL_HEAD_WRAPPER_RE.test(prefix) && !inner.includes('\n')) {
      sanitized += ` ${inner} `;
      dbSanitized += ` ${inner} `;
    } else {
      sanitized += blank;
      dbSanitized += (quote === '"' || quote === "'") && span.end - span.start >= 3 ? ' __arg__ ' : blank;
    }
    last = span.end;
  }
  const rest = body.slice(last);
  sanitized += rest;
  dbSanitized += rest;
  return { sanitized, dbSanitized, nestedBodies };
}

export function stripCommentAndQuoteSpansForShellScan(body: string): string {
  return inspectShellQuoteSpans(body).sanitized;
}

function isNonShellCodeBody(
  payload: ExecutionContext['payload'],
  rawBody: string,
  evalInterpreterDefaulted = false,
): boolean {
  if (payload.type === 'eval') {
    if (!evalInterpreterDefaulted) {
      const interp = (payload.interpreter ?? '').toLowerCase();
      const baseInterp = path.basename(interp).replace(/\.(?:exe|cmd|bat)$/i, '');
      if (baseInterp.length > 0 && CODE_INTERPRETERS.has(baseInterp)) return true;
    }
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

function unwrapBalancedOuterQuotes(text: string): string {
  const q = text[0];
  if (text.length < 2 || (q !== '"' && q !== "'") || text[text.length - 1] !== q) return text;
  let escape = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (q === '"' && ch === '\\') { escape = true; continue; }
    if (ch === q) return i === text.length - 1 ? text.slice(1, -1).trim() : text;
  }
  return text;
}

function extractDockerContainerBody(cmdArgs: readonly string[]): string | null {
  const runExecIdx = cmdArgs.findIndex(a => a === 'run' || a === 'exec');
  if (runExecIdx === -1) return null;
  let skipNextValue = false;
  let capturedEntrypoint: string | null = null;
  let expectingEntrypointVal = false;
  let containerName: string | null = null;
  let containerCmd: string | null = null;
  const containerCmdArgs: string[] = [];

  for (let i = runExecIdx + 1; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === undefined) continue;
    if (expectingEntrypointVal) {
      expectingEntrypointVal = false;
      if (arg.trim().length > 0) capturedEntrypoint = arg;
      continue;
    }
    if (skipNextValue) { skipNextValue = false; continue; }
    if (arg === '-T' || arg === '--no-TTY') continue;
    if (containerName === null && arg.startsWith('-')) {
      if (arg === '--entrypoint') {
        expectingEntrypointVal = true;
      } else if (arg.startsWith('--entrypoint=')) {
        const val = arg.slice('--entrypoint='.length);
        if (val.trim().length > 0) capturedEntrypoint = val;
      } else if (DOCKER_VALUE_FLAG_SET.has(arg) || (arg.startsWith('--') && arg.includes('='))) {
        if (!arg.includes('=')) skipNextValue = true;
      }
      continue;
    }
    if (containerName === null) {
      containerName = arg;
      if (capturedEntrypoint !== null) containerCmd = capturedEntrypoint;
      continue;
    }
    if (containerCmd === null) { containerCmd = arg; continue; }
    containerCmdArgs.push(arg);
  }

  if (containerCmd === null) return null;
  const baseCmd = path.posix.basename(containerCmd.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh'].includes(baseCmd)) {
    const cIdx = findPosixShellCIndex(containerCmdArgs);
    return cIdx !== -1 && cIdx + 1 < containerCmdArgs.length ? (containerCmdArgs[cIdx + 1] ?? null) : null;
  }
  if (['pwsh', 'powershell', 'cmd'].includes(baseCmd)) {
    const cIdx = containerCmdArgs.findIndex(a => ['-c', '-command', '/c'].includes(a.toLowerCase()));
    if (cIdx !== -1 && cIdx + 1 < containerCmdArgs.length) {
      return unwrapBalancedOuterQuotes(containerCmdArgs.slice(cIdx + 1).join(' ').trim());
    }
  }
  return [containerCmd, ...containerCmdArgs].join(' ');
}

const WRAPPER_VALUE_FLAGS_BY_CMD: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-C', '--close-from', '-D', '--chdir', '-T', '--command-timeout', '-U', '--other-user']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string', '--argv0']),
  su: new Set(['-c', '--command', '-s', '--shell', '-g', '--group', '-G', '--supp-group', '-w', '--whitelist-environment']),
  doas: new Set(['-u', '-C']),
  time: new Set(['-o', '--output', '-f', '--format']),
  timeout: new Set(['-k', '--kill-after', '-s', '--signal']),
  stdbuf: new Set(['-i', '--input', '-o', '--output', '-e', '--error']),
};
const PM_WRAPPER_VALUE_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '-p', '--package', '-c', '--call', '--userconfig', '-w', '--workspace']);

const PWSH_SCAN_BOUNDARY_FLAGS = new Set(['--', '-file', '-f', '-encodedcommand', '-ec', '-en']);

function findPwshCommandFlagIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    if (PWSH_SCAN_BOUNDARY_FLAGS.has(head)) return -1;
    if (head === '-c' || head === '-command') return i;
  }
  return -1;
}

function findPosixShellCIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') return -1;
    if (a === '--rcfile' || a === '--init-file') {
      i++;
      continue;
    }
    if (!a.startsWith('--') && /^[-+][a-zA-Z]*[oO][a-zA-Z]*$/.test(a)) {
      if (a.startsWith('-') && a.slice(1).includes('c')) return i + 1;
      i++;
      continue;
    }
    if (a === '-c' || a === '--command' || (/^-[a-zA-Z]+$/.test(a) && a.includes('c'))) return i;
    if (!a.startsWith('-') && !a.startsWith('+')) return -1;
  }
  return -1;
}

function extractScriptFileBody(payload: Extract<ExecutionContext['payload'], { type: 'script' }>, fallbackCwd?: string): string | null {
  try {
    const rawCwd = payload.cwd !== undefined && payload.cwd.length > 0
      ? (process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(payload.cwd) ? convertToWindowsPath(payload.cwd) : payload.cwd)
      : undefined;
    if (process.platform === 'win32' && rawCwd !== undefined && (rawCwd.startsWith('/') || rawCwd.startsWith('~'))) return null;
    const baseCwd = rawCwd !== undefined
      ? path.resolve(rawCwd)
      : (fallbackCwd !== undefined && fallbackCwd.length > 0 ? path.resolve(fallbackCwd) : process.cwd());
    const rawScript = process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(payload.scriptPath)
      ? convertToWindowsPath(payload.scriptPath)
      : payload.scriptPath;
    if (process.platform === 'win32' && (rawScript.startsWith('/') || rawScript.startsWith('~'))) return null;
    const resolved = path.resolve(baseCwd, rawScript);
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    return stat !== undefined && stat.isFile() && stat.size <= 512 * 1024 ? fs.readFileSync(resolved, 'utf8') : null;
  } catch {
    return null;
  }
}

function extractWrapperScriptBody(baseNoExt: string, args: readonly string[]): string | null {
  if (baseNoExt === 'vitest' || baseNoExt === 'jest') {
    return `${baseNoExt} ${args.join(' ')}`.trim();
  }
  if (baseNoExt === 'wsl') {
    const WSL_VALUE_FLAGS = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === '--' || a === '-e' || a === '--exec') {
        return i + 1 < args.length ? args.slice(i + 1).join(' ') : null;
      }
      if (WSL_VALUE_FLAGS.has(a)) { i++; continue; }
      if (!a.startsWith('-')) return args.slice(i).join(' ');
    }
    return null;
  }
  if (['npx', 'pnpx', 'bunx', 'yarn', 'pnpm', 'npm', 'bun'].includes(baseNoExt)) {
    const isSubcmdRunner = baseNoExt === 'pnpm' || baseNoExt === 'npm' || baseNoExt === 'bun';
    let sawDelegateSub = !isSubcmdRunner;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === '--') return i + 1 < args.length ? args.slice(i + 1).join(' ') : null;
      if (PM_WRAPPER_VALUE_FLAGS.has(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      const low = a.toLowerCase();
      if (!sawDelegateSub) {
        if (low === 'test') return `${baseNoExt} ${args.slice(i).join(' ')}`;
        if (['exec', 'x', 'dlx', 'run'].includes(low)) { sawDelegateSub = true; continue; }
        return null;
      }
      if (low === 'test') return `${baseNoExt} ${args.slice(i).join(' ')}`;
      return args.slice(i).join(' ');
    }
    return null;
  }
  if (Object.hasOwn(WRAPPER_VALUE_FLAGS_BY_CMD, baseNoExt)) {
    const valueFlags = WRAPPER_VALUE_FLAGS_BY_CMD[baseNoExt];
    const isTimeout = baseNoExt === 'timeout';
    let skippedTimeoutDuration = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === '--') return i + 1 < args.length ? args.slice(i + 1).join(' ') : null;
      if (valueFlags !== undefined && valueFlags.has(a)) { i++; continue; }
      if (baseNoExt === 'sudo' && (a === '-i' || a === '-s' || a === '--login' || a === '--shell')) return 'bash';
      if (a.startsWith('-') || a.includes('=')) continue;
      if (isTimeout && !skippedTimeoutDuration) { skippedTimeoutDuration = true; continue; }
      return args.slice(i).join(' ');
    }
  }
  return null;
}

export function extractRawScriptBody(ctx: ExecutionContext): string | null {
  const { payload, cmdBasename, args } = ctx;
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script') return extractScriptFileBody(payload, ctx.cwd);
  const baseNoExt = cmdBasename.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
  if (baseNoExt === 'pwsh' || baseNoExt === 'powershell') {
    const idx = findPwshCommandFlagIndex(args);
    if (idx === -1) return null;
    const tok = args[idx] ?? '';
    const colonBody = tok.includes(':') ? tok.slice(tok.indexOf(':') + 1) : '';
    const parts = colonBody.length > 0 ? [colonBody, ...args.slice(idx + 1)] : args.slice(idx + 1);
    return parts.length > 0 ? unwrapBalancedOuterQuotes(parts.join(' ').trim()) : null;
  }
  if (baseNoExt === 'sh' || baseNoExt === 'bash' || baseNoExt === 'zsh') {
    const idx = findPosixShellCIndex(args);
    return idx !== -1 && idx + 1 < args.length ? (args[idx + 1] ?? null) : null;
  }
  if (baseNoExt === 'cmd') {
    const idx = args.findIndex(a => a.toLowerCase() === '/c');
    return idx !== -1 && idx + 1 < args.length ? args.slice(idx + 1).join(' ') : null;
  }
  if (['docker', 'docker-compose'].includes(baseNoExt)) return extractDockerContainerBody(args);
  return extractWrapperScriptBody(baseNoExt, args);
}

function findBlockedReplMatch(body: string): RegExpExecArray | null {
  const interactive = INTERACTIVE_FLAG_REGEX.exec(body) ?? NODE_INSPECT_SUBCMD_REGEX.exec(body);
  if (interactive !== null) return interactive;
  GLOBAL_REPL_REGEX.lastIndex = 0;
  for (const m of body.matchAll(GLOBAL_REPL_REGEX)) {
    const delimiter = (m[1] ?? '').trim();
    if (delimiter.startsWith('|') || delimiter.startsWith('<')) continue;
    const before = body.slice(0, m.index ?? 0).trim();
    if (!before.endsWith('|') && !before.endsWith('<')) return m;
  }
  return null;
}

function blockScriptPattern(hint: string, detail?: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  if (detail !== undefined) console.error(`   ${detail}`);
  console.error(`   Please use standard terminal commands instead.`);
  process.exit(1);
}

function scanShellBody(ctx: ExecutionContext, rawBody: string, label: string, depth = 0): void {
  const { sanitized: body, dbSanitized, nestedBodies } = inspectShellQuoteSpans(rawBody);
  if (TUI_REGEX.test(body)) {
    const m = TUI_REGEX.exec(body);
    blockScriptPattern(`You passed '${m?.[3]?.toLowerCase() ?? 'tui-app'}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  }
  const replMatch = findBlockedReplMatch(body);
  if (replMatch !== null) {
    const matchedCmd = (replMatch[3] ?? replMatch[4] ?? 'repl-app').toLowerCase();
    blockScriptPattern(`You passed '${matchedCmd}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  }
  const dbOrSshCmd = findInteractiveDbOrSshInBody(dbSanitized);
  if (dbOrSshCmd !== null) {
    blockScriptPattern(`You passed '${dbOrSshCmd}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
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
  if (depth < 3) {
    for (const nested of nestedBodies) scanShellBody(ctx, nested, label, depth + 1);
  }
}

export function scanExtractedScriptBody(ctx: ExecutionContext): void {
  const rawBody = extractRawScriptBody(ctx);
  if (rawBody === null || isNonShellCodeBody(ctx.payload, rawBody, ctx.evalInterpreterDefaulted)) return;
  const label = ctx.payload.type === 'eval' ? 'an eval payload' : 'an inline script';
  scanShellBody(ctx, rawBody, label);
}
