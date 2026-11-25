// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match } from 'ts-pattern';
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
import { healEvalCodePathHallucinations } from './path-healer.js';
import { buildNonCodeSpans, isIndexInSpans, replaceOutsideQuotes } from './quote-spans.js';
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
    if (!['&&', '||', '|', '>'].includes(a.trim())) return false;
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
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Ignore best-effort exit cleanup failure
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

function inferScriptInterpreter(scriptFile: string): string {
  const ext = path.extname(scriptFile).toLowerCase();
  return match(ext)
    .with('.py', () => 'python')
    .with('.js', '.mjs', () => 'node')
    .with('.ts', () => 'bun')
    .with('.sh', () => 'bash')
    .with('.ps1', () => 'pwsh')
    .with('.bat', '.cmd', () => 'cmd.exe')
    .otherwise(() => 'bun');
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
  if (!isPosixInternalScript && !fs.existsSync(scriptFile)) {
    const fallbackScript = resolveAgentScriptFallback(rawScriptPath, cwd);
    if (fallbackScript !== null) {
      const origScriptPath = p.scriptPath;
      scriptFile = path.resolve(cwd, fallbackScript);
      p.scriptPath = scriptFile;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Resolved missing '${origScriptPath}' to '${fallbackScript}'... (Frictionless Recovery)`);
    }
  }
  if (!isPosixInternalScript && fs.statSync(scriptFile, { throwIfNoEntry: false })?.isFile() !== true) {
    exitWithError(`The script file '${scriptFile}' does not exist or is not a file.`);
  }

  let localCmd = p.interpreter ? resolveInterpreterAlias(p.interpreter) : inferScriptInterpreter(scriptFile);
  let localCmdBase = path.basename(localCmd).toLowerCase().replace(/\.exe$/i, '');
  if (p.target === 'wsl2' && ['pwsh', 'powershell', 'cmd'].includes(localCmdBase)) {
    localCmd = 'bash';
    localCmdBase = 'bash';
  }
  const WSL_LF_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash']);
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

function maskShHeredocBodies(code: string): string {
  const lines = code.split('\n');
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

function rewriteShCommentsOutsideHeredocsAndQuotes(code: string): string {
  const spans = buildNonCodeSpans(maskShHeredocBodies(code), {
    includeHashComments: true,
    includeSlashComments: false,
    includeRegexLiterals: false,
    allowMultilineQuotes: true,
    noSingleQuoteEscape: true,
  });
  const lines = code.split('\n');
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
    const trimmedMatch = line.match(/^(\s*)\/\/(.*)$/);
    if (!insideSpan && trimmedMatch !== null) {
      rewrittenLines.push(`${trimmedMatch[1]}#${trimmedMatch[2]}`);
      continue;
    }
    rewrittenLines.push(line);

    for (const hm of line.matchAll(/(<<-?)\s*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g)) {
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

function prepareEvalCodeContent(
  p: Extract<ExecPayload, { type: 'eval' }>,
  cwd: string,
  effectiveInterpreter: string,
  ext: string,
  callerBypassedInterceptors: boolean,
): string {
  let codeToExecute = p.code;
  if (p.templateOverride) {
    codeToExecute = p.templateOverride.includes('{{code}}')
      ? p.templateOverride.replace('{{code}}', () => p.code)
      : `${p.templateOverride}\n${p.code}`;
  }
  const skipValidFileRewrite = p.target !== 'wsl2' && ['node', 'nodejs', 'js', 'javascript', 'tsx', 'ts-node'].includes(effectiveInterpreter.toLowerCase());
  if (!callerBypassedInterceptors && Boolean(p.templateOverride)) {
    codeToExecute = healEvalCodePathHallucinations(codeToExecute, cwd, p.target, { skipValidFileRewrite, interpreter: effectiveInterpreter });
  }
  if (ext === '.ps1') {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
  }
  if (p.target === 'wsl2') {
    codeToExecute = codeToExecute.replace(/\r\n/g, '\n');
    const isShOrPy = ext === '.sh' || ext === '.py';
    const isJsOrTs = ext === '.js' || ext === '.ts';
    const spans = buildNonCodeSpans(codeToExecute, {
      includeHashComments: isShOrPy,
      includeSlashComments: !isShOrPy,
      includeRegexLiterals: isJsOrTs,
      noSingleQuoteEscape: ext === '.sh',
    });
    codeToExecute = codeToExecute.replace(/\b([a-zA-Z]):\\[^\s"'`;&|)]*/g, (m, _d: string, offset: number) => {
      const span = spans.find((s) => offset >= s.start && offset < s.end);
      if (span !== undefined && (codeToExecute[span.start] === '#' || codeToExecute[span.start] === '/')) return m;
      return convertToWslPath(m);
    });
    const slashSpans = buildNonCodeSpans(codeToExecute, {
      includeHashComments: isShOrPy,
      includeSlashComments: !isShOrPy,
      includeRegexLiterals: isJsOrTs,
      noSingleQuoteEscape: ext === '.sh',
    });
    codeToExecute = codeToExecute.replace(/(?<![${a-zA-Z0-9_:])\b([a-zA-Z]):\/+[^\s"'`;&|)]*/g, (m, _d: string, offset: number) => {
      const span = slashSpans.find((s) => offset >= s.start && offset < s.end);
      if (span !== undefined && (codeToExecute[span.start] === '#' || codeToExecute[span.start] === '/')) return m;
      return convertToWslPath(m);
    });
    codeToExecute = replaceOutsideQuotes(
      codeToExecute,
      /(^|[\s"'`=])(?:\.{1,2}|[a-zA-Z0-9_.-]+)\\[a-zA-Z0-9_.\-\\/]+/g,
      (m) => {
        const core = m.replace(/^[\s"'`=]+/, '');
        if (!fs.existsSync(path.resolve(cwd, core)) && /^[a-zA-Z0-9_-]+\\[.-][a-zA-Z0-9_.-]*$/.test(core)) return m;
        return m.replace(/\\/g, '/');
      },
      { includeHashComments: isShOrPy, includeSlashComments: !isShOrPy, includeRegexLiterals: isJsOrTs, noSingleQuoteEscape: ext === '.sh' },
    );
    if (ext === '.sh') {
      codeToExecute = rewriteShCommentsOutsideHeredocsAndQuotes(codeToExecute);
    }
  }
  if (ext === '.js' || ext === '.ts') {
    const deferredLogs: string[] = [];
    const healedLiterals = healStrippedStringRawLiterals(
      healStrippedSqlTemplateLiterals(codeToExecute, deferredLogs),
      deferredLogs,
    );
    if (healedLiterals !== codeToExecute) {
      codeToExecute = healedLiterals;
      p.code = codeToExecute;
      for (const line of deferredLogs) console.error(line);
    }
    if (hasTopLevelReturn(codeToExecute)) {
      codeToExecute = wrapCodeInAsyncIife(codeToExecute);
      p.code = codeToExecute;
      console.error(`\n   💡 AGENT HINT: Code Mode style top-level 'return' detected in eval payload.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping code in async IIFE to capture returned output... (Frictionless Recovery)\x1b[0m`);
    }
  }
  return codeToExecute;
}

export function buildEvalPayload(
  p: Extract<ExecPayload, { type: 'eval' }>,
  cwd: string,
  envOverrides: Record<string, string>,
  callerBypassedInterceptors: boolean,
  exitWithError: (message: string) => never,
): BuiltPayloadCommand {
  const uniqueId = crypto.randomUUID();
  const scratchDir = path.join(os.tmpdir(), 'agent-exec-scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  }
  const { effectiveInterpreter, ext } = resolveEvalExecutionTarget(p);
  let effectiveEvalCwd = cwd;
  if (p.target !== 'wsl2' && typeof p.cwd === 'string' && p.cwd.trim().length > 0) {
    const trimmedWinCwd = p.cwd.trim().replace(/^['"]|['"]$/g, '').trim();
    const rawWinCwd = process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(trimmedWinCwd)
      ? convertToWindowsPath(trimmedWinCwd)
      : trimmedWinCwd;
    const candidateWinCwd = path.resolve(cwd, rawWinCwd);
    if (candidateWinCwd !== cwd) {
      const st = fs.statSync(candidateWinCwd, { throwIfNoEntry: false });
      if (st === undefined || !st.isDirectory()) {
        exitWithError(`Resolved Windows cwd '${candidateWinCwd}' for eval target does not exist or is not a directory.`);
      }
      effectiveEvalCwd = candidateWinCwd;
    }
  }
  const scriptFilePath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
  try {
    const codeToExecute = prepareEvalCodeContent(p, effectiveEvalCwd, effectiveInterpreter, ext, callerBypassedInterceptors);
    fs.writeFileSync(scriptFilePath, codeToExecute, { encoding: 'utf-8', mode: 0o600 });
    trackTempPayloadScript(scriptFilePath);
  } catch (err) {
    exitWithError(`Failed to write eval code to temporary file ${scriptFilePath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const localCmd = resolveInterpreterAlias(effectiveInterpreter);
  const normalizedLocal = path.basename(localCmd).toLowerCase().replace(/\.exe$/i, '');
  const runtimeKey = normalizedLocal === 'nodejs' ? 'node' : normalizedLocal;
  if (['node', 'bun', 'tsx', 'ts-node'].includes(runtimeKey)) {
    configureCwdModuleResolution(envOverrides, effectiveEvalCwd, runtimeKey, p.target, p.env);
  }
  const normalizedTemp = scriptFilePath.replace(/\\/g, '/');
  let localArgs: string[];
  if (isPwsh(normalizedLocal) || isCmd(normalizedLocal)) {
    localArgs = formatScriptArgs(localCmd, scriptFilePath, p.args);
  } else if (process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(normalizedLocal)) {
    const prefix = p.target === 'wsl2' ? '/mnt/' : '/';
    const unixTemp = normalizedTemp.replace(/^([a-zA-Z]):\//, (_m, drive: string) => `${prefix}${drive.toLowerCase()}/`);
    localArgs = [unixTemp, ...(p.args ?? [])];
  } else {
    localArgs = [normalizedTemp, ...(p.args ?? [])];
  }
  return { cmd: localCmd, args: localArgs, tempScriptPath: scriptFilePath };
}
