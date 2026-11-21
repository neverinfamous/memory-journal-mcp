// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match } from 'ts-pattern';
import {
  applyTemplateOverride,
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
import { buildNonCodeSpans, isIndexInSpans, replaceOutsideLineComments, replaceOutsideQuotes } from './quote-spans.js';
import type { ExecPayload } from './schema.js';
import { resolveAgentScriptFallback } from './utils.js';

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
  py: 'python',
  ps1: 'pwsh',
  sh: 'bash',
};

function resolveInterpreterAlias(rawInterpreter: string): string {
  return SCRIPT_INTERPRETER_ALIASES[rawInterpreter.toLowerCase()] ?? rawInterpreter;
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
  const tail = rawArgs ?? [];
  if (isPwsh(localCmd)) {
    return ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', normalizedScript, ...tail];
  }
  if (isCmd(localCmd)) {
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
  let scriptFile = path.resolve(cwd, p.scriptPath);
  if (!fs.existsSync(scriptFile)) {
    const fallbackScript = resolveAgentScriptFallback(p.scriptPath, cwd);
    if (fallbackScript !== null) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Resolved missing '${p.scriptPath}' to '${fallbackScript}'... (Frictionless Recovery)`);
      scriptFile = path.resolve(cwd, fallbackScript);
    }
  }
  if (!fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
    exitWithError(`The script file '${scriptFile}' does not exist or is not a file.`);
  }

  let localCmd = p.interpreter ? resolveInterpreterAlias(p.interpreter) : inferScriptInterpreter(scriptFile);
  if (p.target === 'wsl2' && ['bash', 'sh'].includes(localCmd.toLowerCase())) {
    const content = fs.readFileSync(scriptFile, 'utf-8');
    if (content.includes('\r\n')) {
      tempScriptPath = path.join(os.tmpdir(), `agent-exec-wsl-${crypto.randomUUID()}.sh`);
      fs.writeFileSync(tempScriptPath, content.replace(/\r\n/g, '\n'), { encoding: 'utf-8', mode: 0o600 });
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

function rewriteShCommentsOutsideHeredocsAndQuotes(code: string): string {
  const spans = buildNonCodeSpans(code, { includeHashComments: true, includeSlashComments: false, includeRegexLiterals: false });
  const lines = code.split('\n');
  let offset = 0;
  let activeHeredocEnd: string | null = null;
  const rewrittenLines: string[] = [];

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    if (activeHeredocEnd !== null) {
      rewrittenLines.push(line);
      if (line.trim() === activeHeredocEnd) activeHeredocEnd = null;
      continue;
    }

    const insideSpan = isIndexInSpans(spans, lineStart);
    const trimmedMatch = line.match(/^(\s*)\/\/(.*)$/);
    if (!insideSpan && trimmedMatch !== null) {
      rewrittenLines.push(`${trimmedMatch[1]}#${trimmedMatch[2]}`);
    } else {
      rewrittenLines.push(line);
    }

    if (!insideSpan) {
      const heredocMatch = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (heredocMatch?.[2] !== undefined) {
        activeHeredocEnd = heredocMatch[2];
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
  const skipValidFileRewrite = p.target !== 'wsl2' && ['node', 'tsx', 'ts-node'].includes(effectiveInterpreter.toLowerCase());
  if (callerBypassedInterceptors || Boolean(p.templateOverride)) {
    codeToExecute = healEvalCodePathHallucinations(codeToExecute, cwd, p.target, { skipValidFileRewrite });
  }
  if (ext === '.ps1') {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
  }
  if (p.target === 'wsl2') {
    codeToExecute = codeToExecute.replace(/\r\n/g, '\n');
    codeToExecute = replaceOutsideLineComments(codeToExecute, /\b([a-zA-Z]):[/\\]+[^\s"'`;&|)]*/g, m => convertToWslPath(m));
    codeToExecute = replaceOutsideQuotes(codeToExecute, /(^|[\s"'`=])(?:\.{1,2}|[a-zA-Z0-9_.-]+)\\[a-zA-Z0-9_.\-\\/]+/g, m => m.replace(/\\/g, '/'));
    if (ext === '.sh') {
      codeToExecute = rewriteShCommentsOutsideHeredocsAndQuotes(codeToExecute);
    }
  }
  if (ext === '.js' || ext === '.ts') {
    codeToExecute = healStrippedStringRawLiterals(healStrippedSqlTemplateLiterals(codeToExecute));
    if (hasTopLevelReturn(codeToExecute)) {
      console.error(`\n   💡 AGENT HINT: Code Mode style top-level 'return' detected in eval payload.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping code in async IIFE to capture returned output... (Frictionless Recovery)\x1b[0m`);
      codeToExecute = wrapCodeInAsyncIife(codeToExecute);
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
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const { effectiveInterpreter, ext } = resolveEvalExecutionTarget(p);
  const scriptFilePath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
  try {
    const codeToExecute = prepareEvalCodeContent(p, cwd, effectiveInterpreter, ext, callerBypassedInterceptors);
    fs.writeFileSync(scriptFilePath, codeToExecute, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    exitWithError(`Failed to write eval code to temporary file ${scriptFilePath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const localCmd = resolveInterpreterAlias(effectiveInterpreter);
  if (['node', 'bun', 'tsx', 'ts-node'].includes(localCmd.toLowerCase())) {
    configureCwdModuleResolution(envOverrides, cwd, localCmd.toLowerCase(), p.target, p.env);
  }
  const normalizedTemp = scriptFilePath.replace(/\\/g, '/');
  let localArgs: string[];
  if (isPwsh(localCmd) || isCmd(localCmd)) {
    localArgs = formatScriptArgs(localCmd, scriptFilePath, p.args);
  } else if (process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(localCmd.toLowerCase())) {
    const wslTemp = normalizedTemp.replace(/^([a-zA-Z]):\//, (_m, drive: string) => `/mnt/${drive.toLowerCase()}/`);
    localArgs = [wslTemp, ...(p.args ?? [])];
  } else {
    localArgs = [normalizedTemp, ...(p.args ?? [])];
  }
  return { cmd: localCmd, args: localArgs, tempScriptPath: scriptFilePath };
}
