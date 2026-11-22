// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'ts-pattern';
import { type ExecPayload, tokenizeCommandLine } from './schema.js';
import {
  ExecutionContext,
  gitInterceptor,
  dockerInterceptor,
  packageManagerInterceptor,
  cloudCliInterceptor,
  replTuiInterceptor,
  systemInterceptor,
} from './interceptors/index.js';
import { replaceIntegrationContext, BUILT_INS, emitInterceptBanner, recordAgentIssue } from './utils.js';
import { DEFAULT_ENV_VARS, IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import {
  isCmd,
  buildPwshWrapper,
  applyTemplateOverride,
  escapeUnixArg,
  formatForCmdExe,
  sanitizeWslRegex,
  resolveWindowsCommand,
  findPatternExprIndex,
  hasSearchFixedStringsFlag,
  hasSearchPcre2Flag,
  handleWindowsUnixCommandWrappers,
} from './command-utils.js';
import { buildEvalPayload, buildScriptPayload } from './command-payload-builders.js';
import { collectArgJsonValueIndices, collectWslPathExemptIndices, findWslShellInlineScriptIndex, normalizeWslCommandArgs, wrapFinalWslCommand } from './wsl-command-wrapper.js';

export const customInterceptors: Array<(ctx: ExecutionContext) => void> = [];

function createExitWithError(isJson: boolean): (message: string) => never {
  return (message: string) => {
    recordAgentIssue('FATAL_EXECUTION_ERROR', message);
    if (isJson) {
      console.log(JSON.stringify({ status: 'error', message }));
    } else {
      console.error(`❌ Error: ${message}`);
    }
    process.exit(1);
  };
}

function expandIntegrationTemplates(
  payload: ExecPayload,
  replaceTemplates: (str: string) => string,
  exitWithError: (message: string) => never,
): void {
  if (!('integrationContext' in payload) || payload.integrationContext === undefined) return;
  const contextStr = JSON.stringify(payload.integrationContext);
  const MAX_WINDOWS_ENV_SIZE = 32000;
  if (contextStr.length > MAX_WINDOWS_ENV_SIZE) {
    exitWithError(`integrationContext stringified size exceeds ${MAX_WINDOWS_ENV_SIZE} bytes limit on Windows.`);
  }
  if (payload.args !== undefined) {
    payload.args = payload.args.map(a => replaceTemplates(a));
  }
  if (payload.env !== undefined) {
    const newEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.env)) newEnv[k] = replaceTemplates(v);
    payload.env = newEnv;
  }
  match(payload)
    .with({ type: 'command' }, (p) => { p.command = replaceTemplates(p.command); })
    .with({ type: 'script' }, (p) => { p.scriptPath = replaceTemplates(p.scriptPath); })
    .with({ type: 'eval' }, (p) => { p.code = replaceTemplates(p.code); })
    .exhaustive();
  if (payload.templateOverride !== undefined && payload.templateOverride.length > 0) {
    payload.templateOverride = replaceTemplates(payload.templateOverride);
  }
  if (payload.webhookHeaders !== undefined) {
    const newHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.webhookHeaders)) newHeaders[k] = replaceTemplates(v);
    payload.webhookHeaders = newHeaders;
  }
}

function rejectUnsafePosixPipes(payload: ExecPayload, isJson: boolean, exitWithError: (message: string) => never): void {
  if (process.platform !== 'win32' || payload.target === 'wsl2') return;
  const hasPipeCommand = payload.type === 'command' && (
    payload.command.includes(' && ') || payload.command.includes(' || ') ||
    payload.command.includes(' | ') || payload.command.includes(' > ')
  );
  const hasPipeArg = payload.args?.some(a => ['&&', '||', '|', '>'].includes(a.trim())) === true;
  if (!hasPipeCommand && !hasPipeArg) return;
  recordAgentIssue('POSIX_PIPES_IN_POWERSHELL', 'Native PowerShell does NOT support && or ||', { payload });
  if (isJson) {
    exitWithError(`Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.`);
  }
  console.error(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.\x1b[0m`);
  process.exit(1);
}

function splitEmbeddedCommandTokens(payload: ExecPayload, cwd: string): void {
  if (payload.type !== 'command') return;
  const c = payload.command.trim();
  const doubleQuoteMatch = c.match(/^"([^"]+)"(?:\s+(.*))?$/);
  const singleQuoteMatch = c.match(/^'([^']+)'(?:\s+(.*))?$/);
  const quoted = doubleQuoteMatch ?? singleQuoteMatch;
  if (quoted !== null && quoted[1] !== undefined) {
    payload.command = quoted[1];
    if (quoted[2]) payload.args = [...tokenizeCommandLine(quoted[2]), ...(payload.args ?? [])];
    return;
  }
  if (c.includes(' ') && !fs.existsSync(c) && !fs.existsSync(path.resolve(cwd, c))) {
    const tokens = tokenizeCommandLine(c);
    if (tokens.length > 1 && tokens[0] !== undefined) {
      payload.command = tokens[0];
      payload.args = [...tokens.slice(1), ...(payload.args ?? [])];
    }
  }
}

const SHELL_OPERATORS = ['&&', '||', '|', '|&', '>', '>>', '<', '<<', '<<<', ';', '2>', '1>', '2>&1', '&'];
const SHELL_OPERATORS_SET = new Set(SHELL_OPERATORS);
const SHELL_OP_VALUE_FLAGS = new Set(['-d', '--delimiter', '-e', '-f', '-F', '-t', '--field-separator']);

function matchAttachedRedirection(trimmed: string): RegExpMatchArray | null {
  const m = trimmed.match(/^([0-9]?>>?|[0-9]?<)(.+)$/);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  const target = m[2];
  if (target.startsWith('=') || target.startsWith('<') || target.startsWith('>') || target.includes('>')) {
    return null;
  }
  if ((m[1] === '>' || m[1] === '<') && /^\d+\.\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?$/.test(target)) {
    return null;
  }
  return m;
}

function isShellWrapExemptArg(
  idx: number,
  trimmed: string,
  localBase: string,
  localArgs: readonly string[],
  exemptIndices: ReadonlySet<number>,
): boolean {
  if (exemptIndices.has(idx)) return true;
  const prev = idx > 0 ? localArgs[idx - 1] : undefined;
  if (prev !== undefined && SHELL_OP_VALUE_FLAGS.has(prev)) return true;
  return localBase === 'find'
    && trimmed === ';'
    && localArgs.slice(0, idx).some(x => x === '-exec' || x === '-execdir' || x === '-ok' || x === '-okdir');
}

function wrapBuiltinOrShellCommand(
  localCmd: string,
  localArgs: string[],
  target: ExecPayload['target'],
): { cmd: string; args: string[] } {
  const localBase = path.basename(localCmd).toLowerCase().replace(/\.exe$/, '');
  if (findWslShellInlineScriptIndex(localCmd, localArgs) !== -1) {
    return { cmd: localCmd, args: localArgs };
  }
  const exemptIndices = collectWslPathExemptIndices(localCmd, localArgs);
  const hasCmdMeta = /[|&;<>$`{}()]/.test(localCmd) || localCmd.includes(' ');
  const hasArgMeta = localArgs.some((a, idx) => {
    const trimmed = a.trim();
    if (isShellWrapExemptArg(idx, trimmed, localBase, localArgs, exemptIndices)) return false;
    return SHELL_OPERATORS_SET.has(trimmed) || matchAttachedRedirection(trimmed) !== null;
  });
  const hasShellMeta = hasCmdMeta || hasArgMeta;
  if (!BUILT_INS.includes(localCmd.toLowerCase()) && !(target === 'wsl2' && hasShellMeta)) {
    return { cmd: localCmd, args: localArgs };
  }
  console.error(`\n   💡 AGENT HINT: '${localCmd}' is a shell built-in or contains shell metacharacters.`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell to prevent execution failure...`);
  if (process.platform === 'win32' && target !== 'wsl2') {
    return buildPwshWrapper(localCmd, localArgs);
  }
  const isCompoundCmd = /\s+(?:&&|\|\||\|)\s+/.test(localCmd);
  const originalCmd = [
    isCompoundCmd ? localCmd : escapeUnixArg(localCmd, false),
    ...localArgs.map((a, idx) => {
      const trimmed = a.trim();
      const skipOp = isShellWrapExemptArg(idx, trimmed, localBase, localArgs, exemptIndices);
      if (!skipOp && SHELL_OPERATORS_SET.has(trimmed)) return trimmed;
      const redir = !skipOp ? matchAttachedRedirection(trimmed) : null;
      if (redir?.[1] !== undefined && redir[2] !== undefined) {
        return /^&(?:\d+|-)$/.test(redir[2]) ? trimmed : `${redir[1]}${escapeUnixArg(redir[2], false)}`;
      }
      return escapeUnixArg(a, false);
    }),
  ].join(' ');
  return { cmd: 'sh', args: ['-c', originalCmd] };
}

function buildDirectCommandPayload(
  p: Extract<ExecPayload, { type: 'command' }>,
  replaceTemplates: (str: string) => string,
): { cmd: string; args: string[] } {
  let localCmd = p.command;
  let localArgs = [...(p.args ?? [])];
  if (p.target === 'wsl2') {
    const normalized = normalizeWslCommandArgs(localCmd, localArgs);
    localCmd = normalized.cmd;
    localArgs = normalized.args;
  } else if (['rg', 'rg.exe'].includes(path.basename(localCmd).toLowerCase())) {
    const patternIdx = findPatternExprIndex(localCmd, localArgs);
    if (patternIdx !== -1 && !hasSearchFixedStringsFlag(localCmd, localArgs)) {
      localArgs[patternIdx] = sanitizeWslRegex(localArgs[patternIdx] ?? '', { pcre2: hasSearchPcre2Flag(localCmd, localArgs) });
    }
  }
  if (p.templateOverride) {
    const wrapped = wrapBuiltinOrShellCommand(localCmd, localArgs, p.target);
    return applyTemplateOverride(p.templateOverride, wrapped.cmd, wrapped.args, replaceTemplates);
  }
  return { cmd: localCmd, args: localArgs };
}

function applyDefaultEnvOverrides(envOverrides: Record<string, string>, payloadEnv: ExecPayload['env']): void {
  const explicitKeys = new Set(
    Object.entries(payloadEnv ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k]) => (process.platform === 'win32' ? k.toUpperCase() : k))
  );
  for (const [k, v] of Object.entries(DEFAULT_ENV_VARS)) {
    const normalized = process.platform === 'win32' ? k.toUpperCase() : k;
    const overriddenByPayload = explicitKeys.has(normalized) && !IMMUTABLE_ENV_OVERRIDES.has(k.toUpperCase());
    if (k === 'NODE_OPTIONS' && envOverrides[k] !== undefined && envOverrides[k].length > 0) {
      if (!envOverrides[k].includes(v)) envOverrides[k] = `${v} ${envOverrides[k]}`;
    } else if (!overriddenByPayload && !(k in envOverrides)) {
      envOverrides[k] = v;
    }
  }
}

function runCommandInterceptors(
  ctx: ExecutionContext,
  callerBypassed: boolean,
  isNestedAgentExec: boolean,
  initialInterceptedBase: string,
): void {
  if (callerBypassed || isNestedAgentExec) return;
  const currentBase = ctx.cmdBasename.replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
  const unwrappedNewCommand = ctx.payload.type === 'command' &&
    currentBase !== initialInterceptedBase &&
    !['pwsh', 'powershell', 'sh', 'bash', 'cmd', 'wsl'].includes(currentBase);
  if (unwrappedNewCommand) systemInterceptor(ctx);
  gitInterceptor(ctx);
  dockerInterceptor(ctx);
  packageManagerInterceptor(ctx);
  cloudCliInterceptor(ctx);
  replTuiInterceptor(ctx);
  for (const interceptor of customInterceptors) interceptor(ctx);
}

function stripRedundantArgQuotes(cmd: string, args: string[]): string[] {
  const exemptArgJson = collectArgJsonValueIndices(cmd, args);
  const inlineScriptIdx = findWslShellInlineScriptIndex(cmd, args);
  let stripped = false;
  const cleaned = args.map((arg, idx) => {
    if (exemptArgJson.has(idx) || idx === inlineScriptIdx) return arg;
    if (arg.length >= 2 && ((arg.startsWith('"') && arg.endsWith('"') && !arg.slice(1, -1).includes('"')) ||
        (arg.startsWith("'") && arg.endsWith("'") && !arg.slice(1, -1).includes("'")))) {
      stripped = true;
      return arg.slice(1, -1);
    }
    return arg;
  });
  if (stripped) {
    recordAgentIssue('UNNECESSARY_QUOTES', 'Arguments wrapped in quotes were detected', { args });
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }
  return cleaned;
}

function reconcilePostInterceptorWslTarget(
  cmd: string,
  args: string[],
  wasWsl: boolean,
  resolvedWinCmd: string | null,
  origCmdBeforeWinResolve: string,
  payload: ExecPayload,
): { cmd: string; args: string[] } {
  if (wasWsl || payload.target !== 'wsl2' || payload.type !== 'command') {
    return { cmd, args };
  }
  let nextCmd = cmd;
  if (resolvedWinCmd !== null && nextCmd === resolvedWinCmd) {
    nextCmd = path.basename(origCmdBeforeWinResolve).replace(/\.(?:exe|cmd|bat)$/i, '');
  } else if (/^[a-zA-Z]:[/\\]/.test(nextCmd)) {
    nextCmd = path.basename(nextCmd).replace(/\.(?:exe|cmd|bat)$/i, '');
  }
  return normalizeWslCommandArgs(nextCmd, args);
}

interface FinalizedCommandParams {
  cmd: string;
  args: string[];
  tempScriptPath: string | null;
  payload: ExecPayload;
  cwd: string;
  envOverrides: Record<string, string>;
  callerBypassedInterceptors: boolean;
  initialInterceptedBase: string;
}

function finalizeBuiltCommand(params: FinalizedCommandParams): {
  cmd: string;
  args: string[];
  tempScriptPath: string | null;
  envOverrides: Record<string, string>;
  resolvedCwd: string;
} {
  let { cmd, args } = params;
  const { tempScriptPath, payload, cwd, envOverrides, callerBypassedInterceptors, initialInterceptedBase } = params;

  const wasWsl = payload.target === 'wsl2';
  const origCmdBeforeWinResolve = cmd;
  let resolvedWinCmd: string | null = null;
  if (!wasWsl) {
    if (['bunx', 'bunx.cmd', 'bunx.exe'].includes(cmd.toLowerCase())) {
      cmd = 'bun';
      args = ['x', ...args];
    }
    if (!BUILT_INS.includes(cmd.toLowerCase())) {
      const candidate = resolveWindowsCommand(cmd, cwd, payload.env);
      if (candidate !== cmd) {
        resolvedWinCmd = candidate;
        cmd = candidate;
      }
    }
  }
  applyDefaultEnvOverrides(envOverrides, payload.env);

  const wrapped = handleWindowsUnixCommandWrappers(cmd, args, payload, cwd);
  cmd = wrapped.cmd;
  args = wrapped.args;

  const cmdBasename = path.basename(cmd).toLowerCase();
  const cmdRunners = new Set([
    'bun', 'bun.exe', 'node', 'node.exe', 'tsx', 'tsx.cmd', 'ts-node', 'ts-node.cmd',
    'pnpm', 'pnpm.cmd', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'yarn', 'yarn.cmd',
    'bunx', 'bunx.cmd', 'bunx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe',
  ]);
  const ctx: ExecutionContext = { cmdBasename, args, envOverrides, payload, cwd };
  const isNestedAgentExec = payload.type === 'command' &&
    cmdRunners.has(cmdBasename) &&
    args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts');
  runCommandInterceptors(ctx, callerBypassedInterceptors, isNestedAgentExec, initialInterceptedBase);

  if (ctx.cmdBasename && ctx.cmdBasename !== path.basename(cmd).toLowerCase()) cmd = ctx.cmdBasename;
  const reconciled = reconcilePostInterceptorWslTarget(cmd, ctx.args, wasWsl, resolvedWinCmd, origCmdBeforeWinResolve, payload);
  cmd = reconciled.cmd;
  args = reconciled.args;
  if (payload.type === 'command' && !payload.templateOverride) {
    const shellWrapped = wrapBuiltinOrShellCommand(cmd, args, payload.target);
    cmd = shellWrapped.cmd;
    args = shellWrapped.args;
  }
  if (!callerBypassedInterceptors) {
    args = stripRedundantArgQuotes(cmd, args);
  }

  if (isCmd(path.basename(cmd)) && args[0]?.toLowerCase() === '/c') args = formatForCmdExe(args);
  if (payload.type === 'command' && payload.target !== 'wsl2') {
    const isWinBatch = cmd.toLowerCase().endsWith('.bat') || cmd.toLowerCase().endsWith('.cmd') ||
      (process.platform === 'win32' && ['pnpm', 'npm', 'yarn', 'npx'].includes(cmd.toLowerCase()));
    if (isWinBatch) {
      emitInterceptBanner(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.`);
      const pwshWrapped = buildPwshWrapper(cmd, args);
      cmd = pwshWrapped.cmd;
      args = pwshWrapped.args;
    }
  }
  if (payload.target === 'wsl2') {
    const wslWrapped = wrapFinalWslCommand(cmd, args, payload, cwd, envOverrides, tempScriptPath);
    cmd = wslWrapped.cmd;
    args = wslWrapped.args;
  }

  const isPosixInternalCwd = payload.target === 'wsl2' && payload.cwd !== undefined && typeof payload.cwd === 'string' &&
    (payload.cwd.startsWith('/') || payload.cwd.startsWith('~'));
  const resolvedCwd = isPosixInternalCwd ? cwd : (payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : cwd);
  return { cmd, args, tempScriptPath, envOverrides, resolvedCwd };
}

export function buildCommand(
  payload: ExecPayload,
  cwd: string,
  isJson: boolean = false,
): { cmd: string; args: string[]; tempScriptPath: string | null; envOverrides: Record<string, string>; resolvedCwd?: string } {
  const exitWithError = createExitWithError(isJson);
  const envOverrides: Record<string, string> = {};
  // [INVARIANT]: Preserve caller's explicit bypass flag separately from runtime stall-bypass mutations (`payload.bypassInterceptors = true`) set inside interceptors.
  const callerBypassedInterceptors = Boolean(payload.bypassInterceptors);
  const replaceTemplates = (str: string) => replaceIntegrationContext(str, payload);

  expandIntegrationTemplates(payload, replaceTemplates, exitWithError);
  splitEmbeddedCommandTokens(payload, cwd);
  rejectUnsafePosixPipes(payload, isJson, exitWithError);

  let initialInterceptedBase = '';
  if (!callerBypassedInterceptors) {
    const initialCmdBasename = payload.type === 'command' ? path.basename(payload.command).toLowerCase() : '';
    const initialCtx: ExecutionContext = { cmdBasename: initialCmdBasename, args: payload.args !== undefined ? [...payload.args] : [], envOverrides, payload, cwd };
    systemInterceptor(initialCtx);
    initialInterceptedBase = initialCtx.cmdBasename.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
    if (payload.type === 'command') {
      payload.args = initialCtx.args;
      if (initialCtx.cmdBasename.length > 0 && initialCtx.cmdBasename !== initialCmdBasename) {
        payload.command = initialCtx.cmdBasename;
      }
    }
  }

  const built = match(payload)
    .with({ type: 'command' }, (p) => ({ ...buildDirectCommandPayload(p, replaceTemplates), tempScriptPath: null }))
    .with({ type: 'script' }, (p) => buildScriptPayload(p, cwd, replaceTemplates, exitWithError))
    .with({ type: 'eval' }, (p) => buildEvalPayload(p, cwd, envOverrides, callerBypassedInterceptors, exitWithError))
    .exhaustive();

  return finalizeBuiltCommand({
    cmd: built.cmd,
    args: built.args,
    tempScriptPath: built.tempScriptPath,
    payload,
    cwd,
    envOverrides,
    callerBypassedInterceptors,
    initialInterceptedBase,
  });
}
