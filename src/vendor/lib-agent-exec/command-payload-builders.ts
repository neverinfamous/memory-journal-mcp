// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyTemplateOverride,
  convertToWindowsPath,
  convertToWslPath,
  isCmd,
  isPwsh,
} from './command-utils.js';
import {
  hasTopLevelReturn,
  healStrippedSqlTemplateLiterals,
  resolveEvalExecutionTarget,
  wrapCodeInAsyncIife,
} from './eval-healer.js';
import {
  configureCwdModuleResolution,
  healStrippedStringRawLiterals,
} from './inline-script-healer.js';
import { healEvalCodePathHallucinations } from './path-eval-healer.js';
import { buildNonCodeSpans, findSpanContaining, isIndexInSpans, replaceOutsideQuotes } from './quote-spans.js';
import type { ExecPayload } from './schema.js';
import { recordAgentIssue, resolveAgentScriptFallback } from './utils.js';

const PIPE_EXEMPT_TOOLS = new Set([
  'rg', 'rg.exe', 'grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe',
  'cat', 'cat.exe', 'ls', 'ls.exe', 'dir', 'dir.exe', 'rm', 'rm.exe', 'cp', 'cp.exe',
  'mv', 'mv.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'awk', 'awk.exe', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe',
]);
const PIPE_DATA_PREV_FLAGS = new Set([
  '-m', '--message', '--msg', '-e', '--eval', '--regexp', '-c', '-command', '/c', '-p', '--print',
  '--history', '--summary', '--reason', '--pattern', '-f', '-F', '--file', '-b', '--body', '-t', '--title', '-n', '--notes', '--query', '-q', '--filter',
]);

const PIPE_OPERATOR_ARGS: ReadonlySet<string> = new Set(['&&', '||', '|', '>']);

export function rejectUnsafePosixPipes(payload: ExecPayload, isJson: boolean, exitWithError: (message: string) => never): void {
  if (process.platform !== 'win32' || payload.target === 'wsl2' || payload.bypassInterceptors === true) return;
  const cmdBase = payload.type === 'command' ? path.basename(payload.command).toLowerCase() : '';
  if (isCmd(cmdBase)) return;
  const hasPipeCommand = payload.type === 'command' && (
    payload.command.includes(' && ') || payload.command.includes(' || ') ||
    payload.command.includes(' | ') || payload.command.includes(' > ')
  );
  const args = payload.args ?? [];
  const hasPipeArg = !PIPE_EXEMPT_TOOLS.has(cmdBase) && args.some((a, idx) => {
    if (!PIPE_OPERATOR_ARGS.has(a.trim())) return false;
    const prev = idx > 0 ? args[idx - 1]?.toLowerCase() : undefined;
    return prev === undefined || !PIPE_DATA_PREV_FLAGS.has(prev);
  });
  if (!hasPipeCommand && !hasPipeArg) return;
  recordAgentIssue('POSIX_PIPES_IN_POWERSHELL', 'Native PowerShell does NOT support && or ||', { payload });
  if (isJson) {
    exitWithError(`Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.`);
  }
  console.error(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.\x1b[0m`);
  process.exit(1);
}

export interface BuiltPayloadCommand {
  cmd: string;
  args: string[];
  tempScriptPath: string | null;
}

const SCRIPT_INTERPRETER_ALIASES: Readonly<Record<string, string>> = {
  ts: 'bun',
  typescript: 'bun',
  js: 'node',
  javascript: 'node',
  nodejs: 'node',
  py: 'python',
  ps1: 'pwsh',
  bat: 'cmd.exe',
  sh: 'bash',
};

const tempPayloadScripts = new Set<string>();
let tempCleanupRegistered = false;

function trackTempPayloadScript(filePath: string): void {
  tempPayloadScripts.add(filePath);
  if (tempCleanupRegistered) return;
  tempCleanupRegistered = true;
  process.once('exit', () => {
    for (const p of tempPayloadScripts) {
      try {
        fs.unlinkSync(p);
      } catch (err: unknown) {
        const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code !== 'ENOENT') {
          console.error(`⚠️ Temp payload script cleanup error (${p}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    tempPayloadScripts.clear();
  });
}

function resolveInterpreterAlias(rawInterpreter: string): string {
  const key = rawInterpreter.toLowerCase();
  return Object.hasOwn(SCRIPT_INTERPRETER_ALIASES, key)
    ? (SCRIPT_INTERPRETER_ALIASES[key] ?? rawInterpreter)
    : rawInterpreter;
}

const SCRIPT_EXT_INTERPRETERS: Readonly<Record<string, string>> = {
  '.py': 'python',
  '.js': 'node',
  '.mjs': 'node',
  '.ts': 'bun',
  '.sh': 'bash',
  '.ps1': 'pwsh',
  '.bat': 'cmd.exe',
  '.cmd': 'cmd.exe',
};

function inferScriptInterpreter(scriptFile: string): string {
  const ext = path.extname(scriptFile).toLowerCase();
  return Object.hasOwn(SCRIPT_EXT_INTERPRETERS, ext)
    ? (SCRIPT_EXT_INTERPRETERS[ext] ?? 'bun')
    : 'bun';
}

function formatScriptArgs(localCmd: string, scriptPath: string, rawArgs: readonly string[] | undefined): string[] {
  const normalizedScript = scriptPath.replace(/\\/g, '/');
  const cmdBase = path.basename(localCmd);
  const tail = rawArgs ?? [];
  if (isPwsh(cmdBase)) {
    return ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', normalizedScript, ...tail];
  }
  if (isCmd(cmdBase)) {
    return ['/c', normalizedScript, ...tail];
  }
  return [normalizedScript, ...tail];
}

const WSL_LF_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash']);
const WSL_SHELL_ALIAS_SET = new Set(['pwsh', 'powershell', 'cmd']);
const WIN_JS_TS_INTERPRETERS = new Set(['node', 'nodejs', 'js', 'javascript', 'tsx', 'ts-node']);

export function buildScriptPayload(
  p: Extract<ExecPayload, { type: 'script' }>,
  cwd: string,
  replaceTemplates: (str: string) => string,
  exitWithError: (message: string) => never,
): BuiltPayloadCommand {
  let tempScriptPath: string | null = null;
  const trimmedCwd = typeof p.cwd === 'string' ? p.cwd.trim().replace(/^['"]|['"]$/g, '').trim() : undefined;
  const isPosixInternalCwd = process.platform === 'win32' && p.target === 'wsl2' && trimmedCwd !== undefined
    && ((trimmedCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(trimmedCwd)) || trimmedCwd.startsWith('~'));
  const isPosixRelScript = isPosixInternalCwd && !/^[a-zA-Z]:[/\\]/.test(p.scriptPath) && !/^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(p.scriptPath);
  const isPosixInternalScript = (process.platform === 'win32' && p.target === 'wsl2'
    && (/^\/(?!mnt\/[a-zA-Z](?:\/|$))/i.test(p.scriptPath) || p.scriptPath.startsWith('~/')))
    || isPosixRelScript;
  const rawScriptPath = process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(p.scriptPath)
    ? convertToWindowsPath(p.scriptPath)
    : p.scriptPath;
  let scriptFile = isPosixInternalScript ? p.scriptPath : path.resolve(cwd, rawScriptPath);
  if (!isPosixInternalScript) {
    let st = fs.statSync(scriptFile, { throwIfNoEntry: false });
    if (st === undefined) {
      const fallbackScript = resolveAgentScriptFallback(rawScriptPath, cwd);
      if (fallbackScript !== null) {
        const origScriptPath = p.scriptPath;
        scriptFile = path.resolve(cwd, fallbackScript);
        p.scriptPath = scriptFile;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Resolved missing '${origScriptPath}' to '${fallbackScript}'... (Frictionless Recovery)`);
        st = fs.statSync(scriptFile, { throwIfNoEntry: false });
      }
    }
    if (st?.isFile() !== true) {
      exitWithError(`The script file '${scriptFile}' does not exist or is not a file.`);
    }
  }

  let localCmd = p.interpreter ? resolveInterpreterAlias(p.interpreter) : inferScriptInterpreter(scriptFile);
  let localCmdBase = path.basename(localCmd).toLowerCase().replace(/\.exe$/i, '');
  if (p.target === 'wsl2' && WSL_SHELL_ALIAS_SET.has(localCmdBase)) {
    localCmd = 'bash';
    localCmdBase = 'bash';
  }
  if (!isPosixInternalScript && p.target === 'wsl2' && WSL_LF_SHELLS.has(localCmdBase)) {
    const content = fs.readFileSync(scriptFile, 'utf-8');
    if (content.includes('\r\n')) {
      tempScriptPath = path.join(os.tmpdir(), `agent-exec-wsl-${crypto.randomUUID()}.sh`);
      fs.writeFileSync(tempScriptPath, content.replace(/\r\n/g, '\n'), { encoding: 'utf-8', mode: 0o600 });
      trackTempPayloadScript(tempScriptPath);
      scriptFile = tempScriptPath;
    }
  }

  let localArgs = formatScriptArgs(localCmd, scriptFile, p.args);
  if (p.templateOverride) {
    const updated = applyTemplateOverride(p.templateOverride, localCmd, localArgs, replaceTemplates);
    localCmd = updated.cmd;
    localArgs = updated.args;
  }
  return { cmd: localCmd, args: localArgs, tempScriptPath };
}

function scanMaskShellHeredocState(
  line: string,
  state: { quote: '"' | "'" | '`' | null },
): { heredocEnd: string | null; stripTabs: boolean } {
  let heredocEnd: string | null = null;
  let stripTabs = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && state.quote !== "'") { escaped = true; continue; }
    if (state.quote !== null) {
      if (ch === state.quote) state.quote = null;
      continue;
    }
    if (ch === '#' && (i === 0 || /[\s;(]/.test(line[i - 1] ?? ''))) break;
    if (ch === '"' || ch === "'" || ch === '`') { state.quote = ch; continue; }
    if (ch === '<' && line[i - 1] !== '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      const m = /^(<<-?)\s*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line.slice(i));
      if (m?.[3] !== undefined) {
        stripTabs = m[1] === '<<-';
        heredocEnd = m[3];
      }
    }
  }
  return { heredocEnd, stripTabs };
}

function maskShHeredocBodies(lines: readonly string[]): string {
  const masked: string[] = [];
  let activeHeredocEnd: string | null = null;
  let activeStripTabs = false;
  const quoteState: { quote: '"' | "'" | '`' | null } = { quote: null };
  for (const line of lines) {
    if (activeHeredocEnd !== null) {
      masked.push(' '.repeat(line.length));
      const normalizedLine = activeStripTabs ? line.replace(/^\t+/, '') : line;
      if (normalizedLine === activeHeredocEnd) {
        activeHeredocEnd = null;
        activeStripTabs = false;
      }
      continue;
    }
    if (quoteState.quote === null && /^\s*\/\//.test(line)) {
      masked.push(' '.repeat(line.length));
      continue;
    }
    masked.push(line);
    const detected = scanMaskShellHeredocState(line, quoteState);
    if (detected.heredocEnd !== null) {
      activeHeredocEnd = detected.heredocEnd;
      activeStripTabs = detected.stripTabs;
    }
  }
  return masked.join('\n');
}

const SLASH_COMMENT_LINE_RE = /^(\s*)\/\/(.*)$/;
const HEREDOC_HEADER_GLOBAL_RE = /(<<-?)\s*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
const WSL_WIN_BACKSLASH_PATH_RE = /\b([a-zA-Z]):\\[^\s"'`;&|)]*/g;
const WSL_WIN_FORWARD_PATH_RE = /(?<![${a-zA-Z0-9_:])\b([a-zA-Z]):\/+[^\s"'`;&|)]*/g;
const WSL_REL_BACKSLASH_RE = /(^|[\s"'`=])(?:\.{1,2}|[a-zA-Z0-9_.-]+)\\[a-zA-Z0-9_.\-\\/]+/g;
const ESCAPED_DOT_DASH_SEG_RE = /^[a-zA-Z0-9_-]+\\[.-][a-zA-Z0-9_.-]*$/;

function rewriteShCommentsOutsideHeredocsAndQuotes(code: string): string {
  const lines = code.split('\n');
  const spans = buildNonCodeSpans(maskShHeredocBodies(lines), {
    includeHashComments: true,
    includeSlashComments: false,
    includeRegexLiterals: false,
    allowMultilineQuotes: true,
    noSingleQuoteEscape: true,
  });
  let offset = 0;
  let activeHeredocEnd: string | null = null;
  let activeStripTabs = false;
  const rewrittenLines: string[] = [];

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    if (activeHeredocEnd !== null) {
      rewrittenLines.push(line);
      const normalizedLine = activeStripTabs ? line.replace(/^\t+/, '') : line;
      if (normalizedLine === activeHeredocEnd) {
        activeHeredocEnd = null;
        activeStripTabs = false;
      }
      continue;
    }

    const insideSpan = isIndexInSpans(spans, lineStart);
    const trimmedMatch = line.match(SLASH_COMMENT_LINE_RE);
    if (!insideSpan && trimmedMatch !== null) {
      rewrittenLines.push(`${trimmedMatch[1]}#${trimmedMatch[2]}`);
      continue;
    }
    rewrittenLines.push(line);

    HEREDOC_HEADER_GLOBAL_RE.lastIndex = 0;
    for (const hm of line.matchAll(HEREDOC_HEADER_GLOBAL_RE)) {
      const hmOffset = hm.index;
      if (hmOffset === undefined || hm[1] === undefined || hm[3] === undefined) continue;
      if (line[hmOffset - 1] === '<' || line[hmOffset + hm[1].length] === '<') continue;
      if (!isIndexInSpans(spans, lineStart + hmOffset)) {
        activeStripTabs = hm[1] === '<<-';
        activeHeredocEnd = hm[3];
        break;
      }
    }
  }
  return rewrittenLines.join('\n');
}

function rewriteWslEvalPathsAndComments(codeToExecute: string, ext: string, cwd: string): string {
  let code = codeToExecute.replace(/\r\n/g, '\n');
  const isShOrPy = ext === '.sh' || ext === '.py';
  const spanOpts = {
    includeHashComments: isShOrPy,
    includeSlashComments: !isShOrPy,
    includeRegexLiterals: ext === '.js' || ext === '.ts',
    noSingleQuoteEscape: ext === '.sh',
  };
  let cachedSpans: ReturnType<typeof buildNonCodeSpans> | null = null;
  const getSpans = (): ReturnType<typeof buildNonCodeSpans> => {
    if (cachedSpans === null) cachedSpans = buildNonCodeSpans(code, spanOpts);
    return cachedSpans;
  };
  if (code.includes(':\\')) {
    const spans = getSpans();
    const replaced = code.replace(WSL_WIN_BACKSLASH_PATH_RE, (m, _d: string, offset: number) => {
      const span = findSpanContaining(spans, offset);
      if (span !== undefined && (code[span.start] === '#' || code[span.start] === '/')) return m;
      return convertToWslPath(m);
    });
    if (replaced !== code) { code = replaced; cachedSpans = null; }
  }
  if (code.includes(':/')) {
    const slashSpans = getSpans();
    const replaced = code.replace(WSL_WIN_FORWARD_PATH_RE, (m, _d: string, offset: number) => {
      const span = findSpanContaining(slashSpans, offset);
      if (span !== undefined && (code[span.start] === '#' || code[span.start] === '/')) return m;
      return convertToWslPath(m);
    });
    if (replaced !== code) { code = replaced; cachedSpans = null; }
  }
  if (code.includes('\\')) {
    code = replaceOutsideQuotes(
      code,
      WSL_REL_BACKSLASH_RE,
      (m) => {
        const core = m.replace(/^[\s"'`=]+/, '');
        if (ESCAPED_DOT_DASH_SEG_RE.test(core) && !fs.existsSync(path.resolve(cwd, core))) return m;
        return m.replace(/\\/g, '/');
      },
      spanOpts,
      cachedSpans,
    );
  }
  return ext === '.sh' ? rewriteShCommentsOutsideHeredocsAndQuotes(code) : code;
}

function prepareEvalCodeContent(
  p: Extract<ExecPayload, { type: 'eval' }>,
  cwd: string,
  effectiveInterpreter: string,
  ext: string, callerBypassedInterceptors: boolean,
): string {
  let codeToExecute = p.code;
  if (p.templateOverride) {
    codeToExecute = p.templateOverride.includes('{{code}}') ? p.templateOverride.replace('{{code}}', () => p.code) : `${p.templateOverride}\n${p.code}`;
  }
  const skipValidFileRewrite = p.target !== 'wsl2' && WIN_JS_TS_INTERPRETERS.has(effectiveInterpreter.toLowerCase());
  if (!callerBypassedInterceptors && Boolean(p.templateOverride)) {
    codeToExecute = healEvalCodePathHallucinations(codeToExecute, cwd, p.target, { skipValidFileRewrite, interpreter: effectiveInterpreter });
  }
  if (ext === '.ps1') {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
  }
  if (p.target === 'wsl2') codeToExecute = rewriteWslEvalPathsAndComments(codeToExecute, ext, cwd);
  if (ext === '.js' || ext === '.ts') {
    const deferredLogs: string[] = [];
    const healedLiterals = healStrippedStringRawLiterals(healStrippedSqlTemplateLiterals(codeToExecute, deferredLogs), deferredLogs);
    if (healedLiterals !== codeToExecute) { codeToExecute = healedLiterals; p.code = codeToExecute; for (const line of deferredLogs) console.error(line); }
    if (hasTopLevelReturn(codeToExecute)) {
      codeToExecute = wrapCodeInAsyncIife(codeToExecute);
      p.code = codeToExecute;
      console.error(`\n   💡 AGENT HINT: Code Mode style top-level 'return' detected in eval payload.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping code in async IIFE to capture returned output... (Frictionless Recovery)\x1b[0m`);
    }
  }
  return codeToExecute;
}

export function buildEvalPayload(
  p: Extract<ExecPayload, { type: 'eval' }>, cwd: string, envOverrides: Record<string, string>,
  callerBypassedInterceptors: boolean, exitWithError: (message: string) => never,
): BuiltPayloadCommand {
  const uniqueId = crypto.randomUUID();
  const scratchDir = path.join(os.tmpdir(), 'agent-exec-scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  const { effectiveInterpreter, ext } = resolveEvalExecutionTarget(p);
  let effectiveEvalCwd = cwd;
  if (p.target !== 'wsl2' && typeof p.cwd === 'string' && p.cwd.trim().length > 0) {
    const trimmedWinCwd = p.cwd.trim().replace(/^['"]|['"]$/g, '').trim();
    const rawWinCwd = process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(trimmedWinCwd) ? convertToWindowsPath(trimmedWinCwd) : trimmedWinCwd;
    const candidateWinCwd = path.resolve(cwd, rawWinCwd);
    if (candidateWinCwd !== cwd) {
      const st = fs.statSync(candidateWinCwd, { throwIfNoEntry: false });
      if (st === undefined || !st.isDirectory()) exitWithError(`Resolved Windows cwd '${candidateWinCwd}' for eval target does not exist or is not a directory.`);
      effectiveEvalCwd = candidateWinCwd;
    }
  }
  const scriptFilePath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
  try {
    fs.writeFileSync(scriptFilePath, prepareEvalCodeContent(p, effectiveEvalCwd, effectiveInterpreter, ext, callerBypassedInterceptors), { encoding: 'utf-8', mode: 0o600 });
    trackTempPayloadScript(scriptFilePath);
  } catch (err) {
    exitWithError(`Failed to write eval code to temporary file ${scriptFilePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const localCmd = resolveInterpreterAlias(effectiveInterpreter);
  const normalizedLocal = path.basename(localCmd).toLowerCase().replace(/\.exe$/i, '');
  const runtimeKey = normalizedLocal === 'nodejs' ? 'node' : normalizedLocal;
  if (['node', 'bun', 'tsx', 'ts-node'].includes(runtimeKey)) configureCwdModuleResolution(envOverrides, effectiveEvalCwd, runtimeKey, p.target, p.env);
  const normalizedTemp = scriptFilePath.replace(/\\/g, '/');
  let localArgs: string[];
  if (isPwsh(normalizedLocal) || isCmd(normalizedLocal)) localArgs = formatScriptArgs(localCmd, scriptFilePath, p.args);
  else if (process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(normalizedLocal)) {
    const prefix = p.target === 'wsl2' ? '/mnt/' : '/';
    localArgs = [normalizedTemp.replace(/^([a-zA-Z]):\//, (_m, drive: string) => `${prefix}${drive.toLowerCase()}/`), ...(p.args ?? [])];
  } else {
    localArgs = [normalizedTemp, ...(p.args ?? [])];
  }
  return { cmd: localCmd, args: localArgs, tempScriptPath: scriptFilePath };
}
