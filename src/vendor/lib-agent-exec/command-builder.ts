// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'ts-pattern';
import { type ExecPayload, tokenizeCommandLine } from './schema.js';
import {
  type ExecutionContext,
  gitInterceptor,
  dockerInterceptor,
  packageManagerInterceptor,
  cloudCliInterceptor,
  replTuiInterceptor,
  systemInterceptor,
} from './interceptors/index.js';
import { BUILT_INS, replaceIntegrationContext, emitInterceptBanner, recordAgentIssue } from './utils.js';
import { DEFAULT_ENV_VARS, IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import {
  isCmd,
  isPwsh,
  buildPwshWrapper,
  applyTemplateOverride,
  convertToWindowsPath,
  formatForCmdExe,
  sanitizeWslRegex,
  resolveWindowsCommand,
  findPatternExprIndex,
  hasSearchFixedStringsFlag,
  hasSearchPcre2Flag,
  handleWindowsUnixCommandWrappers,
} from './command-utils.js';
import { buildEvalPayload, buildScriptPayload, rejectUnsafePosixPipes } from './command-payload-builders.js';
import { collectArgJsonValueIndices, findWslShellInlineScriptIndex, normalizeWslCommandArgs, wrapBuiltinOrShellCommand, wrapFinalWslCommand } from './wsl-command-wrapper.js';

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
    payload.webhookHeaders = Object.fromEntries(
      Object.entries(payload.webhookHeaders).map(([k, v]) => [k, replaceTemplates(v)]),
    );
  }
}

function splitEmbeddedCommandTokens(payload: ExecPayload, cwd: string): void {
  if (payload.type !== 'command') return;
  const c = payload.command.trim();
  if (c !== payload.command) payload.command = c;
  const doubleQuoteMatch = c.match(/^"([^"]+)"(?:\s+(.*))?$/);
  const singleQuoteMatch = c.match(/^'([^']+)'(?:\s+(.*))?$/);
  const quoted = doubleQuoteMatch ?? singleQuoteMatch;
  if (quoted !== null && quoted[1] !== undefined) {
    payload.command = quoted[1];
    if (quoted[2]) payload.args = [...tokenizeCommandLine(quoted[2]), ...(payload.args ?? [])];
    return;
  }
  const cmdProbe = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(c) ? convertToWindowsPath(c) : c;
  if (c.includes(' ') && !fs.existsSync(c) && !fs.existsSync(cmdProbe) && !fs.existsSync(path.resolve(cwd, c))) {
    const tokens = tokenizeCommandLine(c);
    if (tokens.length > 1 && tokens[0] !== undefined) {
      payload.command = tokens[0];
      payload.args = [...tokens.slice(1), ...(payload.args ?? [])];
    }
  }
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

const PWSH_QUOTE_EXEMPT_BOUNDARY_FLAGS: ReadonlySet<string> = new Set([
  '--', '-file', '-f', '-encodedcommand', '-ec', '-en',
]);

function findPwshInlineScriptStartIndex(cmd: string, args: readonly string[]): number {
  if (!isPwsh(path.basename(cmd))) return -1;
  for (let i = 0; i < args.length; i++) {
    const low = (args[i] ?? '').toLowerCase();
    const head = low.includes(':') ? low.slice(0, low.indexOf(':')) : low;
    if (PWSH_QUOTE_EXEMPT_BOUNDARY_FLAGS.has(head)) return -1;
    if (head === '-c' || head === '-command') return i + 1;
  }
  return -1;
}

export function stripRedundantArgQuotes(cmd: string, args: string[], payload?: ExecPayload): string[] {
  const exemptArgJson = collectArgJsonValueIndices(cmd, args);
  const inlineScriptIdx = findWslShellInlineScriptIndex(cmd, args);
  const pwshInlineStart = findPwshInlineScriptStartIndex(cmd, args);
  let stripped = false;
  const cleaned = args.map((arg, idx) => {
    if (exemptArgJson.has(idx) || idx === inlineScriptIdx || (pwshInlineStart !== -1 && idx >= pwshInlineStart)) {
      return arg;
    }
    if (arg.length >= 2 && ((arg.startsWith('"') && arg.endsWith('"') && !arg.slice(1, -1).includes('"')) ||
        (arg.startsWith("'") && arg.endsWith("'") && !arg.slice(1, -1).includes("'")))) {
      stripped = true;
      return arg.slice(1, -1);
    }
    return arg;
  });
  if (stripped) {
    recordAgentIssue('UNNECESSARY_QUOTES', 'Arguments wrapped in quotes were detected', payload ?? { args });
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
  evalInterpreterDefaulted: boolean;
}

function applyPlatformAndBatchWraps(
  cmdIn: string,
  argsIn: string[],
  payload: ExecPayload,
  cwd: string,
  envOverrides: Record<string, string>,
  tempScriptPath: string | null,
  callerBypassedInterceptors: boolean,
): { cmd: string; args: string[] } {
  let cmd = cmdIn;
  let args = argsIn;
  if (payload.type === 'command' && !payload.templateOverride) {
    const shellWrapped = wrapBuiltinOrShellCommand(cmd, args, payload.target);
    cmd = shellWrapped.cmd;
    args = shellWrapped.args;
  }
  if (!callerBypassedInterceptors && !payload.templateOverride) {
    args = stripRedundantArgQuotes(cmd, args, payload);
  }
  if (payload.target !== 'wsl2' && isCmd(path.basename(cmd)) && args[0]?.toLowerCase() === '/c') args = formatForCmdExe(args);
  if (payload.target !== 'wsl2') {
    const lowerCmd = cmd.toLowerCase();
    const isWinBatch = lowerCmd.endsWith('.bat') || lowerCmd.endsWith('.cmd') || lowerCmd.endsWith('.ps1') ||
      (process.platform === 'win32' && ['pnpm', 'npm', 'yarn', 'npx', 'pnpx'].includes(lowerCmd));
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
  return { cmd, args };
}

const NESTED_RUNNER_VALUE_FLAGS = new Set([
  '--cwd', '--dir', '-C', '--prefix', '--filter', '-F', '--tsconfig', '--tsconfig-override',
  '--preload', '-r', '--require', '--import', '--env-file', '--conditions', '-p', '--package', '--config',
]);
const NESTED_JS_PRINT_RUNNERS = new Set(['bun', 'bun.exe', 'node', 'node.exe', 'tsx', 'tsx.cmd', 'ts-node', 'ts-node.cmd']);
const NESTED_CONFIG_C_RUNNERS = new Set(['bun', 'bun.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe']);

function isNestedAgentExecArgs(cmdBasename: string, args: readonly string[]): boolean {
  let sawSubcmd = false;
  let sawInnerRunner = false;
  const isJsRuntime = NESTED_JS_PRINT_RUNNERS.has(cmdBasename);
  const hasShortConfigC = NESTED_CONFIG_C_RUNNERS.has(cmdBasename);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') return false;
    const low = a.toLowerCase();
    if (low === '-e' || low === '--eval' || low === '--print' || low.startsWith('--eval=') || low.startsWith('--print=') || ((isJsRuntime || sawInnerRunner) && low === '-p')) {
      return false;
    }
    if (NESTED_RUNNER_VALUE_FLAGS.has(a) || (hasShortConfigC && a === '-c')) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (!sawSubcmd && (low === 'run' || low === 'exec' || low === 'dlx' || low === 'x')) {
      sawSubcmd = true;
      continue;
    }
    const base = path.basename(a).toLowerCase();
    if (!sawInnerRunner && NESTED_JS_PRINT_RUNNERS.has(base)) {
      sawInnerRunner = true;
      continue;
    }
    return base === 'agent-exec.ts' || base === 'agent-exec.js';
  }
  return false;
}

function finalizeBuiltCommand(params: FinalizedCommandParams): {
  cmd: string;
  args: string[];
  tempScriptPath: string | null;
  envOverrides: Record<string, string>;
  resolvedCwd: string;
} {
  let { cmd, args } = params;
  const { tempScriptPath, payload, cwd, envOverrides, callerBypassedInterceptors, initialInterceptedBase, evalInterpreterDefaulted } = params;

  const wasWsl = payload.target === 'wsl2';
  const origCmdBeforeWinResolve = cmd;
  let resolvedWinCmd: string | null = null;
  if (!wasWsl) {
    if (['bunx', 'bunx.cmd', 'bunx.exe'].includes(path.basename(cmd).toLowerCase())) {
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

  const wrapped = callerBypassedInterceptors ? { cmd, args } : handleWindowsUnixCommandWrappers(cmd, args, payload, cwd);
  cmd = wrapped.cmd;
  args = wrapped.args;

  const cmdBasename = path.basename(cmd).toLowerCase();
  const cmdRunners = new Set([
    'bun', 'bun.exe', 'node', 'node.exe', 'tsx', 'tsx.cmd', 'ts-node', 'ts-node.cmd',
    'pnpm', 'pnpm.cmd', 'pnpm.exe', 'npm', 'npm.cmd', 'npm.exe', 'npx', 'npx.cmd', 'npx.exe', 'yarn', 'yarn.cmd', 'yarn.exe',
    'bunx', 'bunx.cmd', 'bunx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe',
  ]);
  const preInterceptorCmd = cmd;
  const preInterceptorTarget = payload.target;
  const ctx: ExecutionContext = { cmdBasename, args, envOverrides, payload, cwd, evalInterpreterDefaulted };
  const isNestedAgentExec = payload.type === 'command' &&
    cmdRunners.has(cmdBasename) &&
    isNestedAgentExecArgs(cmdBasename, args);
  runCommandInterceptors(ctx, callerBypassedInterceptors, isNestedAgentExec, initialInterceptedBase);

  if (ctx.cmdBasename && ctx.cmdBasename !== path.basename(cmd).toLowerCase()) cmd = ctx.cmdBasename;
  if (cmd !== preInterceptorCmd || payload.target !== preInterceptorTarget) {
    if (payload.target !== 'wsl2' && !BUILT_INS.includes(cmd.toLowerCase()) && (cmd !== preInterceptorCmd || preInterceptorTarget === 'wsl2')) {
      if (['bunx', 'bunx.cmd', 'bunx.exe'].includes(path.basename(cmd).toLowerCase())) {
        cmd = 'bun';
        ctx.args = ['x', ...ctx.args];
        if (payload.type === 'command') {
          payload.command = cmd;
          payload.args = ctx.args;
        }
      }
      const candidate = resolveWindowsCommand(cmd, cwd, payload.env);
      if (candidate !== cmd) {
        resolvedWinCmd = candidate;
        cmd = candidate;
      }
    }
    const postWrapped = callerBypassedInterceptors ? { cmd, args: ctx.args } : handleWindowsUnixCommandWrappers(cmd, ctx.args, payload, cwd);
    cmd = postWrapped.cmd;
    ctx.args = postWrapped.args;
  }
  const reconciled = reconcilePostInterceptorWslTarget(cmd, ctx.args, wasWsl, resolvedWinCmd, origCmdBeforeWinResolve, payload);
  const platformWrapped = applyPlatformAndBatchWraps(
    reconciled.cmd, reconciled.args, payload, cwd, envOverrides, tempScriptPath, callerBypassedInterceptors,
  );
  const rawPayloadCwd = typeof payload.cwd === 'string' ? payload.cwd.trim().replace(/^['"]|['"]$/g, '').trim() : undefined;
  const isMntPath = rawPayloadCwd !== undefined && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd);
  const isPosixInternalCwd = payload.target === 'wsl2' && rawPayloadCwd !== undefined && !isMntPath &&
    (rawPayloadCwd.startsWith('/') || rawPayloadCwd.startsWith('~'));
  const hostCwd = isMntPath && process.platform === 'win32' ? convertToWindowsPath(rawPayloadCwd) : rawPayloadCwd;
  const resolvedCwd = isPosixInternalCwd ? cwd : (hostCwd !== undefined && hostCwd.length > 0 ? path.resolve(cwd, hostCwd) : cwd);
  return { cmd: platformWrapped.cmd, args: platformWrapped.args, tempScriptPath, envOverrides, resolvedCwd };
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
  const replaceTemplates = (str: string): string => replaceIntegrationContext(str, payload);

  expandIntegrationTemplates(payload, replaceTemplates, exitWithError);
  splitEmbeddedCommandTokens(payload, cwd);
  rejectUnsafePosixPipes(payload, isJson, exitWithError);

  const evalInterpreterDefaulted = payload.type === 'eval'
    && (payload.interpreter === undefined || payload.interpreter.trim().length === 0);

  let initialInterceptedBase = '';
  if (!callerBypassedInterceptors) {
    const initialCmdBasename = payload.type === 'command' ? path.basename(payload.command).toLowerCase() : '';
    const initialCtx: ExecutionContext = { cmdBasename: initialCmdBasename, args: payload.args !== undefined ? [...payload.args] : [], envOverrides, payload, cwd };
    systemInterceptor(initialCtx);
    initialInterceptedBase = initialCmdBasename.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
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
    evalInterpreterDefaulted,
  });
}
