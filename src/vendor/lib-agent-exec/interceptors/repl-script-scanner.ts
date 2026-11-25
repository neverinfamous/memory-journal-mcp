// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { isJavaScriptOrTypeScriptCode, isPythonCode, isShellCommandScript } from '../eval-healer.js';
import { buildNonCodeSpans } from '../quote-spans.js';
import { absorbsNextDockerShortValue, DOCKER_VALUE_FLAGS } from './docker-tty-repl-guard.js';
import {
  BUN_REPL_REGEX, CMD_PAUSE_REGEX, DOCKER_LOGS_REGEX, IMPLICIT_PWSH_REGEX, INLINE_SHELL_REGEX, JOURNALCTL_FOLLOW_REGEX,
  NODE_INSPECT_SUBCMD_REGEX, NODE_WATCH_REGEX, PM2_INTERACTIVE_REGEX, PWSH_NO_EXIT_REGEX, PWSH_UI_REGEX, REPL_REGEX,
  SHELL_BODY_WRAPPER_VALUE_FLAGS, TAIL_F_REGEX, TSX_WATCH_REGEX, TUI_REGEX, WATCH_REGEX, WATCH_TOOL_REGEX,
  appendSegmentChunk, expandAttachedWrapperTokens, findInteractiveDbOrSshInBody, findPwshCommandIndex,
  findUnwrappedBodyCmdIndex, hasPreDashSuCommand, isAsciiWs, isSuOrEnvCommandPrefix, isSudoConsumingShortCluster,
  isSudoInteractiveFlag, matchInteractiveFlagInBody, parseEnvSplitShortFlag, parseSuCommandShortFlag,
} from './repl-tui-constants.js';
import { findPosixShellCAndBody, isPwshCommandFlag } from './system-command-context.js';
import type { ExecutionContext } from './types.js';
import { AGENT_EXEC_README_URL } from './utils.js';

const DOCKER_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);
const CODE_INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'tsx', 'ts-node', 'js', 'ts', 'javascript', 'typescript', 'python', 'python3', 'py']);
const CODE_FILE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const GLOBAL_REPL_REGEX = new RegExp(REPL_REGEX.source, `${REPL_REGEX.flags.replace(/g/g, '')}g`);
const PWSH_LAST_TOK_RE = /^(?:pwsh|powershell)(?:\.exe)?$/i;
const SHELL_ARG_META_RE = /[\s"'`|&;<>()$]/;
const DQ_ESCAPE_META_RE = /([\\"$`])/g;
const QUOTE_SINGLE_ESC_RE = /'/g;

function isShellHeadWrapperPrefixTokens(tokens: readonly string[], endsWithWs: boolean): boolean {
  if (tokens.length > 0 && !endsWithWs) return false;
  return tokens.length === 0 || findUnwrappedBodyCmdIndex([...tokens, '__CMD__']) === tokens.length;
}

function isNestedPosixShellCPrefixTokens(tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const cmdIdx = findUnwrappedBodyCmdIndex(tokens);
  const rawCmd = tokens[cmdIdx];
  if (rawCmd === undefined) return isSuOrEnvCommandPrefix(tokens, tokens[tokens.length - 1]);
  const cleanCmd = rawCmd.replace(/^['"]|['"]$/g, '');
  const base = path.posix.basename(cleanCmd.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
  if (base === 'docker' || base === 'docker-compose') return extractDockerContainerBody([...tokens.slice(cmdIdx + 1), '__BODY__']) === '__BODY__';
  if (base !== 'bash' && base !== 'sh' && base !== 'zsh' && base !== 'ash' && base !== 'dash') return false;
  const remaining = tokens.slice(cmdIdx + 1);
  const { flagIdx, bodyIdx } = findPosixShellCAndBody([...remaining, '__BODY__']);
  return flagIdx !== -1 && bodyIdx === remaining.length;
}

function unescapeDoubleQuotedInner(raw: string): string {
  return raw.replace(/\\(["\\$`])/g, '$1');
}

function scanLastPlainSegmentDelim(plainChunk: string): number {
  for (let i = plainChunk.length - 1; i >= 0; i--) {
    const ch = plainChunk[i];
    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '{' || ch === '`' || ch === '(') return i;
  }
  return -1;
}

function inspectShellQuoteSpans(body: string): { sanitized: string; dbSanitized: string; nestedBodies: string[] } {
  const spans = buildNonCodeSpans(body, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
  if (spans.length === 0) return { sanitized: body, dbSanitized: body, nestedBodies: [] };
  const sanitizedParts: string[] = [];
  const dbParts: string[] = [];
  const segTokens: string[] = [];
  let segEndsWithWs = true;
  let segActive = true;
  let last = 0;
  const nestedBodies: string[] = [];
  for (const span of spans) {
    const plainChunk = body.slice(last, span.start);
    sanitizedParts.push(plainChunk); dbParts.push(plainChunk);
    const delimIdx = scanLastPlainSegmentDelim(plainChunk);
    if (delimIdx !== -1) { segTokens.length = 0; segEndsWithWs = true; segActive = true; }
    const segState = appendSegmentChunk(delimIdx !== -1 ? plainChunk.slice(delimIdx + 1) : plainChunk, segTokens, segEndsWithWs, segActive);
    segEndsWithWs = segState.endsWithWs; segActive = segState.active;
    const quote = body[span.start];
    const hasClosed = span.end - span.start >= 2 && body[span.end - 1] === quote;
    const inner = hasClosed ? body.slice(span.start + 1, span.end - 1) : body.slice(span.start + 1);
    const blank = ' '.repeat(span.end - span.start);
    const glue = span.start > 0 && body[span.start - 1] !== undefined && !isAsciiWs(body.charCodeAt(span.start - 1)) ? '__arg__' : ' __arg__ ';
    if ((quote === '"' || quote === "'") && segActive && isNestedPosixShellCPrefixTokens(segTokens)) {
      nestedBodies.push(quote === '"' ? unescapeDoubleQuotedInner(inner) : inner);
      sanitizedParts.push(blank); dbParts.push(blank); segEndsWithWs = true;
    } else if (quote === '`') {
      if (inner.trim().length > 0) nestedBodies.push(inner);
      sanitizedParts.push(blank); dbParts.push(glue);
      const next = appendSegmentChunk(glue, segTokens, segEndsWithWs, segActive);
      segEndsWithWs = next.endsWithWs; segActive = next.active;
    } else if ((quote === '"' || quote === "'") && segActive && isShellHeadWrapperPrefixTokens(segTokens, segEndsWithWs) && !inner.includes('\n')) {
      const unwrapped = ` ${inner} `;
      sanitizedParts.push(unwrapped); dbParts.push(unwrapped);
      const next = appendSegmentChunk(unwrapped, segTokens, segEndsWithWs, segActive);
      segEndsWithWs = next.endsWithWs; segActive = next.active;
    } else {
      sanitizedParts.push(blank);
      const isPwshPrefix = segEndsWithWs && PWSH_LAST_TOK_RE.test(segTokens[segTokens.length - 1] ?? '');
      const rep = (quote === '"' || quote === "'") && !isPwshPrefix ? glue : blank;
      dbParts.push(rep);
      const next = appendSegmentChunk(rep, segTokens, segEndsWithWs, segActive);
      segEndsWithWs = next.endsWithWs; segActive = next.active;
    }
    last = span.end;
  }
  const rest = body.slice(last);
  sanitizedParts.push(rest); dbParts.push(rest);
  return { sanitized: sanitizedParts.join(''), dbSanitized: dbParts.join(''), nestedBodies };
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
    return !isShellCommandScript(rawBody) && (isJavaScriptOrTypeScriptCode(rawBody) || isPythonCode(rawBody));
  }
  if (payload.type === 'script') {
    const interp = (payload.interpreter ?? '').toLowerCase();
    const baseInterp = path.basename(interp).replace(/\.(?:exe|cmd|bat)$/i, '');
    if (CODE_INTERPRETERS.has(baseInterp)) return true;
    const ext = path.extname(payload.scriptPath).toLowerCase();
    if (CODE_FILE_EXTS.has(ext)) return true;
    return !isShellCommandScript(rawBody) && (isJavaScriptOrTypeScriptCode(rawBody) || isPythonCode(rawBody));
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
      } else if (DOCKER_VALUE_FLAG_SET.has(arg) || absorbsNextDockerShortValue(arg) || (arg.startsWith('--') && arg.includes('='))) {
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
  if (['sh', 'bash', 'zsh', 'ash', 'dash'].includes(baseCmd)) {
    const { bodyIdx } = findPosixShellCAndBody(containerCmdArgs);
    return bodyIdx !== -1 ? (containerCmdArgs[bodyIdx] ?? null) : null;
  }
  if (['pwsh', 'powershell', 'cmd'].includes(baseCmd)) {
    const cIdx = containerCmdArgs.findIndex(a => (baseCmd === 'cmd' ? /^\/c(?:$|[=:])/i.test(a) : isPwshCommandFlag((a.toLowerCase().split(':')[0] ?? a.toLowerCase()))));
    if (cIdx !== -1) {
      const first = containerCmdArgs[cIdx] ?? '';
      const tail = baseCmd !== 'cmd' && first.includes(':') ? [first.slice(first.indexOf(':') + 1), ...containerCmdArgs.slice(cIdx + 1)] : containerCmdArgs.slice(cIdx + 1);
      if (tail.length > 0) return unwrapBalancedOuterQuotes(tail.join(' ').trim());
    }
  }
  return [containerCmd, ...containerCmdArgs].join(' ');
}

const PM_WRAPPER_VALUE_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '-p', '--package', '-c', '--call', '--userconfig', '-w', '--workspace']);

const SCRIPT_MNT_PREFIX_RE = /^\/?mnt\/[a-zA-Z](?:\/|$)/i;
const POSIX_SHELL_EXT_RE = /\.(?:exe|cmd|bat)$/;
const CMD_SLASH_C_RE = /^\/c(?:$|[=:])/i;
const UNWRAP_SEG_RE = /(^|[;\n&|{}()`])([^;\n&|{}()`]+)/g;
const LEADING_WS_RE = /^[ \t]*/;

function extractScriptFileBody(payload: Extract<ExecutionContext['payload'], { type: 'script' }>, fallbackCwd?: string): string | null {
  try {
    const rawCwd = payload.cwd !== undefined && payload.cwd.length > 0
      ? (process.platform === 'win32' && SCRIPT_MNT_PREFIX_RE.test(payload.cwd) ? convertToWindowsPath(payload.cwd) : payload.cwd)
      : undefined;
    if (process.platform === 'win32' && rawCwd !== undefined && (rawCwd.startsWith('/') || rawCwd.startsWith('~'))) return null;
    const baseCwd = rawCwd !== undefined ? path.resolve(rawCwd) : (fallbackCwd !== undefined && fallbackCwd.length > 0 ? path.resolve(fallbackCwd) : process.cwd());
    const rawScript = process.platform === 'win32' && SCRIPT_MNT_PREFIX_RE.test(payload.scriptPath) ? convertToWindowsPath(payload.scriptPath) : payload.scriptPath;
    if (process.platform === 'win32' && (rawScript.startsWith('/') || rawScript.startsWith('~'))) return null;
    const resolved = path.resolve(baseCwd, rawScript);
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    return stat !== undefined && stat.isFile() && stat.size <= 512 * 1024 ? fs.readFileSync(resolved, 'utf8') : null;
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES' && code !== 'ENAMETOOLONG' && code !== 'EINVAL') {
      console.error(`⚠️ Script body inspect warning: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

function quoteArgvToken(token: string): string {
  if (token.length === 0) return "''";
  return SHELL_ARG_META_RE.test(token) ? `'${token.replace(QUOTE_SINGLE_ESC_RE, "'\\''")}'` : token;
}

const WSL_WRAPPER_VALUE_FLAGS: ReadonlySet<string> = new Set(['-d', '--distribution', '-u', '--user', '--cd', '--shell-type']);
const POSIX_SHELL_BASE_SET: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'ash', 'dash']);
const PM_WRAPPER_BASE_SET: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx', 'yarn', 'pnpm', 'npm', 'bun']);
const PM_DELEGATE_SUBS: ReadonlySet<string> = new Set(['exec', 'x', 'dlx', 'run']);
const DOCKER_CONTAINER_CMDS: ReadonlySet<string> = new Set(['docker', 'docker-compose']);

function joinArgvPreservingQuotes(rawTokens: readonly string[]): string {
  const tokens = expandAttachedWrapperTokens(rawTokens);
  const out: string[] = [];
  const shellStartIdx = findUnwrappedBodyCmdIndex(tokens);
  let posixBodyIdx = shellStartIdx > 0 && isSuOrEnvCommandPrefix(tokens.slice(0, shellStartIdx), tokens[shellStartIdx - 1]) ? shellStartIdx : -1;
  let winBodyStartIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? '';
    if (i === posixBodyIdx) {
      out.push(tok.includes("'") ? `"${tok.replace(DQ_ESCAPE_META_RE, '\\$1')}"` : `'${tok}'`);
      posixBodyIdx = -1;
      continue;
    }
    if (winBodyStartIdx !== -1 && i >= winBodyStartIdx) { out.push(tok); continue; }
    if (i === shellStartIdx && posixBodyIdx === -1 && winBodyStartIdx === -1) {
      const base = path.basename(tok).toLowerCase().replace(POSIX_SHELL_EXT_RE, '');
      if (POSIX_SHELL_BASE_SET.has(base)) {
        const { bodyIdx } = findPosixShellCAndBody(tokens.slice(i + 1));
        if (bodyIdx !== -1) posixBodyIdx = i + 1 + bodyIdx;
      } else if (base === 'pwsh' || base === 'powershell') {
        const { cmdIdx } = findPwshCommandIndex(tokens.slice(i + 1));
        if (cmdIdx !== -1) {
          const cmdTok = tokens[i + 1 + cmdIdx] ?? '';
          winBodyStartIdx = cmdTok.includes(':') ? i + 1 + cmdIdx : i + 1 + cmdIdx + 1;
        }
      } else if (base === 'cmd') {
        const cOff = tokens.slice(i + 1).findIndex(a => CMD_SLASH_C_RE.test(a));
        if (cOff !== -1 && tokens.slice(i + 1, i + 1 + cOff).every(a => a.startsWith('/'))) {
          winBodyStartIdx = (tokens[i + 1 + cOff] ?? '').length > 2 ? i + 1 + cOff : i + 1 + cOff + 1;
        }
      }
    }
    out.push(quoteArgvToken(tok));
  }
  return out.join(' ');
}

function extractWrapperScriptBody(baseNoExt: string, args: readonly string[]): string | null {
  if (baseNoExt === 'vitest' || baseNoExt === 'jest') return `${baseNoExt} ${joinArgvPreservingQuotes(args)}`.trim();
  if (baseNoExt === 'wsl') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      const low = a.toLowerCase();
      if (low === '--' || low === '-e' || low === '--exec') return i + 1 < args.length ? joinArgvPreservingQuotes(args.slice(i + 1)) : null;
      if (WSL_WRAPPER_VALUE_FLAGS.has(low)) { i++; continue; }
      if (!a.startsWith('-')) return joinArgvPreservingQuotes(args.slice(i));
    }
    return null;
  }
  if (PM_WRAPPER_BASE_SET.has(baseNoExt)) {
    let sawDelegateSub = !(baseNoExt === 'pnpm' || baseNoExt === 'npm' || baseNoExt === 'bun');
    let skippedYarnSub = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === '--') return i + 1 < args.length ? joinArgvPreservingQuotes(args.slice(i + 1)) : null;
      if (PM_WRAPPER_VALUE_FLAGS.has(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      const low = a.toLowerCase();
      if (!sawDelegateSub) {
        if (low === 'test') return `${baseNoExt} ${joinArgvPreservingQuotes(args.slice(i))}`;
        if (PM_DELEGATE_SUBS.has(low)) { sawDelegateSub = true; continue; }
        return null;
      }
      if (baseNoExt === 'yarn' && !skippedYarnSub && PM_DELEGATE_SUBS.has(low)) { skippedYarnSub = true; continue; }
      return low === 'test' ? `${baseNoExt} ${joinArgvPreservingQuotes(args.slice(i))}` : joinArgvPreservingQuotes(args.slice(i));
    }
    return null;
  }
  if (!Object.hasOwn(SHELL_BODY_WRAPPER_VALUE_FLAGS, baseNoExt)) return null;
  const valueFlags = SHELL_BODY_WRAPPER_VALUE_FLAGS[baseNoExt];
  let skippedWrapperPositional = false;
  let sawSuHelp = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--') return baseNoExt === 'su' ? (sawSuHelp ? null : 'bash') : ((baseNoExt === 'timeout' && !skippedWrapperPositional ? i + 2 : i + 1) < args.length ? joinArgvPreservingQuotes(args.slice(i + (baseNoExt === 'timeout' && !skippedWrapperPositional ? 2 : 1))) : null);
    if (baseNoExt === 'su') {
      if (a === '--help' || a === '--version' || a === '-h' || a === '-V') sawSuHelp = true;
      if (a === '--command' && i + 1 < args.length) return args[i + 1] ?? null;
      if (a.startsWith('--command=')) return a.slice('--command='.length);
      const suFlag = parseSuCommandShortFlag(a);
      if (suFlag !== null) return suFlag.attached.length > 0 ? suFlag.attached : (i + 1 < args.length ? args[i + 1] ?? null : null);
    }
    if (baseNoExt === 'env') {
      const envFlag = parseEnvSplitShortFlag(a);
      const takesNext = a === '--split-string' || (envFlag !== null && envFlag.attached.length === 0);
      const splitVal = takesNext ? (args[i + 1] ?? null) : (a.startsWith('--split-string=') ? a.slice(15) : (envFlag !== null ? envFlag.attached : null));
      if (splitVal !== null) return [splitVal, ...(i + (takesNext ? 2 : 1) < args.length ? [joinArgvPreservingQuotes(args.slice(i + (takesNext ? 2 : 1)))] : [])].join(' ');
    }
    if (baseNoExt === 'sudo' && isSudoInteractiveFlag(a)) return 'bash';
    if ((valueFlags !== undefined && valueFlags.has(a)) || (baseNoExt === 'sudo' && isSudoConsumingShortCluster(a))) { i++; continue; }
    if (a.startsWith('-') || a.includes('=')) continue;
    if (!skippedWrapperPositional && (baseNoExt === 'timeout' || (baseNoExt === 'su' && hasPreDashSuCommand(args.slice(i + 1))))) { skippedWrapperPositional = true; continue; }
    return baseNoExt === 'su' ? (sawSuHelp ? null : 'bash') : joinArgvPreservingQuotes(args.slice(i));
  }
  return baseNoExt === 'su' && !sawSuHelp ? 'bash' : null;
}

export function extractRawScriptBody(ctx: ExecutionContext): string | null {
  const { payload, cmdBasename, args } = ctx;
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script') return extractScriptFileBody(payload, ctx.cwd);
  const baseNoExt = cmdBasename.toLowerCase().replace(POSIX_SHELL_EXT_RE, '');
  if (baseNoExt === 'pwsh' || baseNoExt === 'powershell') {
    const { cmdIdx: idx } = findPwshCommandIndex(args);
    if (idx === -1) return null;
    const tok = args[idx] ?? '';
    const colonBody = tok.includes(':') ? tok.slice(tok.indexOf(':') + 1) : '';
    const parts = colonBody.length > 0 ? [colonBody, ...args.slice(idx + 1)] : args.slice(idx + 1);
    return parts.length > 0 ? unwrapBalancedOuterQuotes(parts.join(' ').trim()) : null;
  }
  if (POSIX_SHELL_BASE_SET.has(baseNoExt)) {
    const { bodyIdx } = findPosixShellCAndBody(args);
    return bodyIdx !== -1 ? (args[bodyIdx] ?? null) : null;
  }
  if (baseNoExt === 'cmd') {
    const idx = args.findIndex(a => CMD_SLASH_C_RE.test(a));
    if (idx === -1) return null;
    const tok = args[idx] ?? '';
    const parts = tok.length > 2 ? [tok.slice(3), ...args.slice(idx + 1)] : args.slice(idx + 1);
    return parts.filter(p => p.length > 0).length > 0 ? parts.join(' ').trim() : null;
  }
  return DOCKER_CONTAINER_CMDS.has(baseNoExt) ? extractDockerContainerBody(args) : extractWrapperScriptBody(baseNoExt, args);
}

function findLastNonWsCharBefore(body: string, endIdx: number): { ch: string; idx: number } {
  for (let i = endIdx - 1; i >= 0; i--) {
    const ch = body[i];
    if (ch !== undefined && ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') return { ch, idx: i };
  }
  return { ch: '', idx: -1 };
}

function findBlockedReplMatch(body: string): RegExpExecArray | null {
  const interactive = matchInteractiveFlagInBody(body) ?? NODE_INSPECT_SUBCMD_REGEX.exec(body);
  if (interactive !== null) return interactive;
  GLOBAL_REPL_REGEX.lastIndex = 0;
  for (const m of body.matchAll(GLOBAL_REPL_REGEX)) {
    const delimiter = (m[1] ?? '').trim();
    const matchIdx = m.index ?? 0;
    const isLogicalOr = delimiter === '|' && (body[matchIdx - 1] === '|' || body[matchIdx + 1] === '|');
    if (isLogicalOr) return m;
    if ((delimiter.startsWith('|') && !delimiter.startsWith('||')) || delimiter.startsWith('<')) continue;
    const prev = findLastNonWsCharBefore(body, matchIdx);
    if (!(prev.ch === '|' && (prev.idx === 0 || body[prev.idx - 1] !== '|')) && prev.ch !== '<') return m;
  }
  return null;
}

function blockScriptPattern(hint: string, detail?: string): never {
  console.error(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or invoke the appropriate native tool (logged for CMS-03). Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
  if (detail !== undefined) console.error(`   ${detail}`);
  console.error(`   Please use standard terminal commands instead.`);
  process.exit(1);
}

function unwrapSegmentPrefixes(text: string): string {
  return text.replace(UNWRAP_SEG_RE, (full, sep: string, seg: string) => {
    const lead = LEADING_WS_RE.exec(seg)?.[0] ?? '';
    const tokens = expandAttachedWrapperTokens(seg.trim().split(/\s+/).filter(Boolean));
    const cmdIdx = findUnwrappedBodyCmdIndex(tokens);
    return cmdIdx === 0 || cmdIdx >= tokens.length ? full : `${sep}${lead}${tokens.slice(cmdIdx).join(' ')}`;
  });
}

function scanShellBody(ctx: ExecutionContext, rawBody: string, label: string, depth = 0): void {
  const { sanitized, dbSanitized, nestedBodies } = inspectShellQuoteSpans(rawBody);
  const body = unwrapSegmentPrefixes(sanitized);
  const unwrappedDb = dbSanitized === sanitized ? body : unwrapSegmentPrefixes(dbSanitized);
  const tuiMatch = TUI_REGEX.exec(body);
  if (tuiMatch !== null) blockScriptPattern(`You passed '${tuiMatch[3]?.toLowerCase() ?? 'tui-app'}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  const replMatch = findBlockedReplMatch(unwrappedDb);
  if (replMatch !== null) blockScriptPattern(`You passed '${(replMatch[3] ?? replMatch[4] ?? 'repl-app').toLowerCase()}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  const dbOrSshCmd = findInteractiveDbOrSshInBody(dbSanitized);
  if (dbOrSshCmd !== null) blockScriptPattern(`You passed '${dbOrSshCmd}' inside ${label}.`, `Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications will hang indefinitely.`);
  if (WATCH_REGEX.test(body)) blockScriptPattern(`You passed 'watch' inside ${label}.`, `Continuous watch commands will hang indefinitely.`);
  if (TAIL_F_REGEX.test(body)) blockScriptPattern(`You passed 'tail -f' inside ${label}.`);
  if (JOURNALCTL_FOLLOW_REGEX.test(body)) blockScriptPattern(`'journalctl -f' runs indefinitely. Blocking execution.`);
  if (DOCKER_LOGS_REGEX.test(body)) blockScriptPattern(`'docker logs -f' runs indefinitely. Blocking execution.`);
  if (NODE_WATCH_REGEX.test(body) || WATCH_TOOL_REGEX.test(body) || TSX_WATCH_REGEX.test(body)) blockScriptPattern(`Node watch mode runs indefinitely. Blocking execution.`);
  if (PM2_INTERACTIVE_REGEX.test(body)) blockScriptPattern(`'pm2' is interactive/runs indefinitely. Blocking execution.`);
  if (BUN_REPL_REGEX.test(body)) blockScriptPattern(`'bun repl' is interactive and will hang indefinitely. Blocking execution.`);
  if (CMD_PAUSE_REGEX.test(body)) blockScriptPattern(`'pause' in cmd waits for a keypress and will hang indefinitely. Blocking execution.`);
  if (ctx.payload.target !== 'wsl2') {
    if (PWSH_NO_EXIT_REGEX.test(body) || PWSH_UI_REGEX.test(body)) blockScriptPattern(`PowerShell -NoExit or UI cmdlets will hang headlessly. Blocking execution.`);
    if (INLINE_SHELL_REGEX.test(body)) blockScriptPattern(`You attempted to run an inline shell command inside an eval/script payload. This is an agent hallucination.`, `Please use the proper execution payloads (type: "command" or type: "eval" with target: "wsl2") instead of nesting shell wrappers.`);
    if (IMPLICIT_PWSH_REGEX.test(unwrappedDb)) blockScriptPattern(`You attempted to run an inline shell command implicitly via powershell.`, `This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
  }
  if (depth < 3) for (const nested of nestedBodies) scanShellBody(ctx, nested, label, depth + 1);
}

export function scanExtractedScriptBody(ctx: ExecutionContext): void {
  const rawBody = extractRawScriptBody(ctx);
  if (rawBody === null || isNonShellCodeBody(ctx.payload, rawBody, ctx.evalInterpreterDefaulted)) return;
  scanShellBody(ctx, rawBody, ctx.payload.type === 'eval' ? 'an eval payload' : 'an inline script');
}
