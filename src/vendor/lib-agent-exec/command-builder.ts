// @ts-nocheck
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { match } from 'ts-pattern';
import { ExecPayload } from './schema.js';
import { 
  ExecutionContext, 
  gitInterceptor, 
  dockerInterceptor, 
  packageManagerInterceptor, 
  cloudCliInterceptor, 
  replTuiInterceptor, 
  systemInterceptor 
} from './interceptors/index.js';
import { replaceIntegrationContext, BUILT_INS, recordAgentIssue } from './utils.js';
import { DEFAULT_ENV_VARS } from './environment.js';
import { resolveEvalExecutionTarget, hasTopLevelReturn, wrapCodeInAsyncIife } from './eval-healer.js';
import { healEvalCodePathHallucinations } from './path-healer.js';
import {
  isPwsh,
  isCmd,
  formatForCmdExe,
  convertToWslPath,
  buildPwshWrapper,
  applyTemplateOverride,
  escapeUnixArg,
  sanitizeWslRegex,
  tokenizeArgs,
  resolveWindowsCommand,
  findPatternExprIndex,
  buildWslEnvArgs,
  handleWindowsUnixCommandWrappers
} from './command-utils.js';

export const customInterceptors: Array<(ctx: ExecutionContext) => void> = [];

export function buildCommand(payload: ExecPayload, cwd: string, isJson: boolean = false): { cmd: string; args: string[]; tempScriptPath: string | null; envOverrides: Record<string, string>; resolvedCwd?: string } {
  const exitWithError = (message: string) => {
    recordAgentIssue('FATAL_EXECUTION_ERROR', message);
    if (isJson) {
      console.log(JSON.stringify({ status: "error", message }));
      process.exit(1);
    } else {
      console.error(`❌ Error: ${message}`);
      process.exit(1);
    }
  };

  let cmd: string;
  let args: string[];
  let tempScriptPath: string | null = null;
  const envOverrides: Record<string, string> = {};

  if (!payload.bypassInterceptors) {
    const initialCmdBasename = payload.type === 'command' ? path.basename(payload.command).toLowerCase() : '';
    const initialCtx: ExecutionContext = { cmdBasename: initialCmdBasename, args: payload.args ? [...payload.args] : [], envOverrides, payload };
    systemInterceptor(initialCtx);
    if (payload.type === 'command') {
      payload.args = initialCtx.args;
    }
  }

  // [INVARIANT]: Native PowerShell execution must NEVER allow && or || operators. All POSIX pipelines MUST be routed to target: 'wsl2'.
  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    const hasPipeCommand = payload.type === 'command' && (payload.command.includes(' && ') || payload.command.includes(' || ') || payload.command.includes(' | ') || payload.command.includes(' > '));
    const hasPipeArg = payload.args?.some(a => a.trim() === '&&' || a.trim() === '||' || a.trim() === '|' || a.trim() === '>');
    if (hasPipeCommand || hasPipeArg) {
      recordAgentIssue('POSIX_PIPES_IN_POWERSHELL', 'Native PowerShell does NOT support && or ||', { payload });
      if (isJson) {
        exitWithError(`Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.`);
      } else {
        console.error(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: Native PowerShell does NOT support '&&', '||', or POSIX pipelines. You MUST use "target": "wsl2" in your JSON payload to execute POSIX shell pipelines.\x1b[0m`);
        process.exit(1);
      }
    }
  }

  const replaceTemplates = (str: string) => replaceIntegrationContext(str, payload);

  if ('integrationContext' in payload && payload.integrationContext) {
    const contextStr = JSON.stringify(payload.integrationContext);
    const MAX_WINDOWS_ENV_SIZE = 32000;
    if (contextStr.length > MAX_WINDOWS_ENV_SIZE) {
      exitWithError(`integrationContext stringified size exceeds ${MAX_WINDOWS_ENV_SIZE} bytes limit on Windows.`);
    }
    // SEC-FIX: Removed integrationContext from envOverrides to prevent data boundary leak

    if (payload.args) {
      payload.args = payload.args.map(a => replaceTemplates(a));
    }
    if (payload.env) {
      const newEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.env)) {
        newEnv[k] = replaceTemplates(v);
      }
      payload.env = newEnv;
    }
    match(payload)
      .with({ type: 'command' }, (p) => {
        p.command = replaceTemplates(p.command);
      })
      .with({ type: 'script' }, (p) => {
        p.scriptPath = replaceTemplates(p.scriptPath);
      })
      .with({ type: 'eval' }, (p) => {
        p.code = replaceTemplates(p.code);
      })
      .exhaustive();

    if (payload.templateOverride) {
      payload.templateOverride = replaceTemplates(payload.templateOverride);
    }
    if (payload.webhookHeaders) {
      const newHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.webhookHeaders)) {
        newHeaders[k] = replaceTemplates(v);
      }
      payload.webhookHeaders = newHeaders;
    }
  }

  match(payload)
    .with({ type: 'command' }, (p) => {
      const c = p.command.trim();
      const doubleQuoteMatch = c.match(/^"([^"]+)"(?:\s+(.*))?$/);
      const singleQuoteMatch = c.match(/^'([^']+)'(?:\s+(.*))?$/);

      if (doubleQuoteMatch) {
        p.command = doubleQuoteMatch[1];
        if (doubleQuoteMatch[2]) {
          p.args = [...tokenizeArgs(doubleQuoteMatch[2]), ...(p.args || [])];
        }
      } else if (singleQuoteMatch) {
        p.command = singleQuoteMatch[1];
        if (singleQuoteMatch[2]) {
          p.args = [...tokenizeArgs(singleQuoteMatch[2]), ...(p.args || [])];
        }
      } else if (c.includes(' ')) {
        const tokens = tokenizeArgs(c);
        if (tokens.length > 1) {
          p.command = tokens[0];
          p.args = [...tokens.slice(1), ...(p.args || [])];
        }
      }
    })
    .with({ type: 'script' }, () => {})
    .with({ type: 'eval' }, () => {})
    .exhaustive();
  
  const parsedCmdArgs = match(payload)
    .with({ type: 'command' }, (p) => {
      let localCmd: string = p.command;
      let localArgs: string[] = [...(p.args || [])];

      if (p.target === 'wsl2') {
        localCmd = convertToWslPath(localCmd);
        
        // [INTENT]: Detects specific Unix utilities that require Regex or Glob escaping before passing to WSL/sh. 
        // [DEPENDENCY]: Relies on specific tool names. 
        // [AGENT-HINT]: If you are adding a new POSIX text-processing tool, you MUST add its basename to this whitelist array, otherwise WSL will fail to parse its unescaped regex/glob arguments.
        const patternExprIdx = findPatternExprIndex(localCmd, localArgs);

        const isShellC = ['sh', 'bash'].includes(path.basename(localCmd).toLowerCase()) && localArgs[0] === '-c';
        localArgs = localArgs.map((a, idx) => {
          if (isShellC && idx === 1) return a;
          let cleaned = a;
          if ((cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
              (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)) {
            cleaned = cleaned.slice(1, -1);
          }
          if (idx === patternExprIdx) return cleaned;
          return convertToWslPath(cleaned);
        });

        if (localCmd.toLowerCase() === 'diff' || localCmd.toLowerCase() === 'diff.exe') {
          if (!localArgs.includes('--strip-trailing-cr')) {
            localArgs.unshift('--strip-trailing-cr');
          }
        } else if (['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'].includes(localCmd.toLowerCase())) {
          if (patternExprIdx !== -1 && !localArgs.includes('-F') && localCmd.toLowerCase() !== 'fgrep') {
            const originalPattern = localArgs[patternExprIdx];
            localArgs[patternExprIdx] = sanitizeWslRegex(originalPattern);
            if (localArgs[patternExprIdx] !== originalPattern && ['grep', 'grep.exe'].includes(localCmd.toLowerCase()) && !localArgs.includes('-E') && !localArgs.includes('-P')) {
              localArgs.unshift('-E');
            }
            if (localArgs[patternExprIdx].endsWith('$')) {
              if (localArgs.includes('-E')) {
                localArgs[localArgs.indexOf('-E')] = '-P';
                localArgs[patternExprIdx] = localArgs[patternExprIdx].replace(/\$$/, () => '\\r?$');
              } else if (!localArgs.includes('-P')) {
                localArgs.unshift('-P');
                const newPatternIdx = findPatternExprIndex(localCmd, localArgs);
                if (newPatternIdx !== -1) {
                  localArgs[newPatternIdx] = localArgs[newPatternIdx].replace(/\$$/, () => '\\r?$');
                }
              } else {
                localArgs[patternExprIdx] = localArgs[patternExprIdx].replace(/\$$/, () => '\\r?$');
              }
            }
          }
        }
      }

      const patternExprIdx = findPatternExprIndex(localCmd, localArgs);
      const hasCmdMeta = /[|&;<>$`{}()]/.test(localCmd) || localCmd.includes(' ');
      const hasArgMeta = localArgs.some((a, idx) => {
        if (idx === patternExprIdx) return false;
        return /[|&;<>]|\$\(|\$\{|`/.test(a);
      });
      const hasShellMeta = hasCmdMeta || hasArgMeta;

      if (BUILT_INS.includes(localCmd.toLowerCase()) || (p.target === 'wsl2' && hasShellMeta)) {
        console.error(`\n   💡 AGENT HINT: '${localCmd}' is a shell built-in or contains shell metacharacters.`);
        console.error(`   🛠️ AUTONOMOUS HEALING: Automatically routing through system shell to prevent execution failure...`);
        
        if (process.platform === 'win32' && p.target !== 'wsl2') {
          // SEC-FIX: Route builtins through pwsh.exe instead of cmd.exe to prevent quote escaping injection vectors
          const wrapped = buildPwshWrapper(localCmd, localArgs);
          localCmd = wrapped.cmd;
          localArgs = wrapped.args;
        } else {
          const shellOperators = ['&&', '||', '|', '|&', '>', '>>', '<', '<<', '<<<', ';', '2>', '1>', '2>&1', '&'];
          const originalCmd = [
            /[|&;<>$`{}()]/.test(localCmd) ? localCmd : escapeUnixArg(localCmd, false),
            ...localArgs.map(a => shellOperators.includes(a.trim()) ? a.trim() : escapeUnixArg(a, false))
          ].join(' ');
          localCmd = 'sh';
          localArgs = ['-c', originalCmd];
        }
      }

      if (p.templateOverride) {
        const updated = applyTemplateOverride(p.templateOverride, localCmd, localArgs, replaceTemplates);
        localCmd = updated.cmd;
        localArgs = updated.args;
      }
      return { cmd: localCmd, args: localArgs };
    })
    .with({ type: 'script' }, (p) => {
      let localCmd: string;
      let localArgs: string[];
      let scriptFile = path.resolve(cwd, p.scriptPath);
      if (!fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
        exitWithError(`The script file '${scriptFile}' does not exist or is not a file.`);
      }
      if (p.interpreter) {
        const interpLower = p.interpreter.toLowerCase();
        if (['ts', 'typescript'].includes(interpLower)) {
          localCmd = 'bun';
        } else if (['js', 'javascript'].includes(interpLower)) {
          localCmd = 'node';
        } else if (interpLower === 'py') {
          localCmd = 'python';
        } else if (interpLower === 'ps1') {
          localCmd = 'pwsh';
        } else if (interpLower === 'sh') {
          localCmd = 'bash';
        } else {
          localCmd = p.interpreter;
        }
      } else {
        const ext = path.extname(scriptFile).toLowerCase();
        localCmd = match(ext)
          .with('.py', () => 'python')
          .with('.js', '.mjs', () => 'node')
          .with('.ts', () => 'bun')
          .with('.sh', () => 'bash')
          .with('.ps1', () => 'pwsh')
          .with('.bat', '.cmd', () => 'cmd.exe')
          .otherwise(() => 'bun');
      }
      // Auto-heal CRLF for bash scripts in WSL
      if (payload.target === 'wsl2' && ['bash', 'sh'].includes(localCmd.toLowerCase())) {
        const content = fs.readFileSync(scriptFile, 'utf-8');
        if (content.includes('\r\n')) {
          tempScriptPath = path.join(os.tmpdir(), `agent-exec-wsl-${crypto.randomUUID()}.sh`);
          fs.writeFileSync(tempScriptPath, content.replace(/\r\n/g, '\n'), 'utf-8');
          scriptFile = tempScriptPath;
        }
      }
      if (isPwsh(localCmd)) {
        localArgs = ['-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else if (isCmd(localCmd)) {
        localArgs = ['/c', scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      } else {
        localArgs = [scriptFile.replace(/\\/g, '/'), ...(p.args || [])];
      }

      if (p.templateOverride) {
        const updated = applyTemplateOverride(p.templateOverride, localCmd, localArgs, replaceTemplates);
        localCmd = updated.cmd;
        localArgs = updated.args;
      }
      return { cmd: localCmd, args: localArgs };
    })
    .with({ type: 'eval' }, (p) => {
      const uniqueId = crypto.randomUUID();
      const scratchDir = path.join(os.tmpdir(), 'agent-exec-scratch');
      if (!fs.existsSync(scratchDir)) {
        fs.mkdirSync(scratchDir, { recursive: true });
      }
      const { effectiveInterpreter, ext } = resolveEvalExecutionTarget(p);
      tempScriptPath = path.join(scratchDir, `agent-eval-${uniqueId}${ext}`);
      try {
        let codeToExecute = p.code;
        if (p.templateOverride) {
          if (p.templateOverride.includes('{{code}}')) {
            codeToExecute = p.templateOverride.replace('{{code}}', p.code);
          } else {
            codeToExecute = `${p.templateOverride}\n${p.code}`;
          }
        }
        codeToExecute = healEvalCodePathHallucinations(codeToExecute, cwd, p.target);
        if (ext === '.ps1') {
          codeToExecute = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n${codeToExecute}`;
        } else if (p.target === 'wsl2') {
          codeToExecute = codeToExecute.replace(/\r\n/g, '\n');
          codeToExecute = codeToExecute.replace(/\b([a-zA-Z]):[/\\]+[^\s"'`;&|)]*/g, (matchStr) => convertToWslPath(matchStr));
          codeToExecute = codeToExecute.replace(/(^|[\s"'`=])(?:\.{1,2}|[a-zA-Z0-9_.-]+)\\[a-zA-Z0-9_.\-\\/]+/g, (matchStr) => matchStr.replace(/\\/g, '/'));
          if (ext === '.sh') {
            codeToExecute = codeToExecute.replace(/(^|\n)\s*\/\/\s*(.*)/g, '$1# $2');
          }
        }
        if (['.js', '.ts'].includes(ext) && hasTopLevelReturn(codeToExecute)) {
          console.error(`\n   💡 AGENT HINT: Code Mode style top-level 'return' detected in eval payload.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping code in async IIFE to capture returned output... (Frictionless Recovery)\x1b[0m`);
          codeToExecute = wrapCodeInAsyncIife(codeToExecute);
        }
        fs.writeFileSync(tempScriptPath, codeToExecute, 'utf-8');
      } catch (err) {
        exitWithError(`Failed to write eval code to temporary file ${tempScriptPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      let localCmd = effectiveInterpreter;
      const interpLower = localCmd.toLowerCase();
      if (['ts', 'typescript'].includes(interpLower)) {
        localCmd = 'bun';
      } else if (['js', 'javascript'].includes(interpLower)) {
        localCmd = 'node';
      } else if (interpLower === 'py') {
        localCmd = 'python';
      } else if (interpLower === 'ps1') {
        localCmd = 'pwsh';
      } else if (interpLower === 'sh') {
        localCmd = 'bash';
      }
      const localArgs = match(localCmd)
        .when(isPwsh, () => [
          '-ExecutionPolicy', 'Bypass', '-NonInteractive', '-NoProfile', '-File', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(isCmd, () => [
          '/c', tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ])
        .when(cmd => process.platform === 'win32' && ['bash', 'sh', 'zsh'].includes(cmd.toLowerCase()), () => {
          const wslPath = tempScriptPath!.replace(/\\/g, '/').replace(/^([a-zA-Z]):\//, (m, drive) => `/mnt/${drive.toLowerCase()}/`);
          return [wslPath, ...(p.args || [])];
        })
        .otherwise(() => [
          tempScriptPath!.replace(/\\/g, '/'), ...(p.args || [])
        ]);

      return { cmd: localCmd, args: localArgs };
    })
    .exhaustive();

  cmd = parsedCmdArgs.cmd;
  args = parsedCmdArgs.args;

  if (payload.target !== 'wsl2') {
    if (['bunx', 'bunx.cmd', 'bunx.exe'].includes(cmd.toLowerCase())) {
      cmd = 'bun';
      args = ['x', ...args];
    }
    cmd = resolveWindowsCommand(cmd, cwd, payload.env);
  }

  Object.assign(envOverrides, DEFAULT_ENV_VARS);

  const wrapped = handleWindowsUnixCommandWrappers(cmd, args, payload);
  cmd = wrapped.cmd;
  args = wrapped.args;

  // integrationContext processed at the start of buildCommand

  const cmdBasename = path.basename(cmd).toLowerCase();
  const ctx: ExecutionContext = { cmdBasename, args, envOverrides, payload };

  // Apply Interceptors Pipeline
  if (!payload.bypassInterceptors) {
    systemInterceptor(ctx);
    gitInterceptor(ctx);
    dockerInterceptor(ctx);
    packageManagerInterceptor(ctx);
    cloudCliInterceptor(ctx);
    replTuiInterceptor(ctx);
    for (const interceptor of customInterceptors) {
      interceptor(ctx);
    }
  }

  // Sync back args and cmd references if modified completely
  if (ctx.cmdBasename && ctx.cmdBasename !== path.basename(cmd).toLowerCase()) {
    cmd = ctx.cmdBasename;
  }
  args = ctx.args;

  let strippedQuotes = false;
  args = args.map(arg => {
    if (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2 && !arg.slice(1, -1).includes('"')) {
      strippedQuotes = true;
      return arg.slice(1, -1);
    }
    if (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2 && !arg.slice(1, -1).includes("'")) {
      strippedQuotes = true;
      return arg.slice(1, -1);
    }
    return arg;
  });

  if (strippedQuotes) {
    recordAgentIssue('UNNECESSARY_QUOTES', 'Arguments wrapped in quotes were detected', { args: ctx.args });
    console.error(`\n   💡 AGENT HINT: Arguments wrapped in quotes were detected.`);
    console.error(`   Because 'shell: false' is used, quotes are NOT needed for spaces. Auto-healing by stripping wrapping quotes...`);
  }

  if (isCmd(path.basename(cmd)) && args[0]?.toLowerCase() === '/c') {
    args = formatForCmdExe(args);
  }

  if (payload.type === 'command') {
    const isWinBatch = cmd.toLowerCase().endsWith('.bat') || cmd.toLowerCase().endsWith('.cmd') || (process.platform === 'win32' && ['pnpm', 'npm', 'yarn', 'npx'].includes(cmd.toLowerCase()));
    if (isWinBatch && payload.target !== 'wsl2') {
      console.error(`\n   💡 AGENT HINT: Intercepted Windows batch file execution. Routing through pwsh to prevent spawn failures and quote vulnerabilities.`);
      const wrapped = buildPwshWrapper(cmd, args);
      cmd = wrapped.cmd;
      args = wrapped.args;
    }
  }

  if (payload.target === 'wsl2') {
    const wslCwd = convertToWslPath(cwd);
    const wslEnvArgs = buildWslEnvArgs(payload.env, envOverrides);
    const patternExprIdx = findPatternExprIndex(path.basename(cmd), args);

    let wslArgs: string[];
    if (['sh', 'bash'].includes(path.basename(cmd).toLowerCase()) && args[0] === '-c') {
      wslArgs = [args[0], args[1], ...args.slice(2).map(a => convertToWslPath(a))];
    } else {
      wslArgs = args.map((arg, idx) => {
        if (idx === patternExprIdx) return arg;
        return convertToWslPath(arg);
      });
    }

    let wslCmd = cmd;
    if (/[a-zA-Z]:[/\\]/.test(wslCmd)) {
      wslCmd = convertToWslPath(wslCmd);
    } else if (wslCmd === 'python') {
      wslCmd = 'python3';
    } else if (isPwsh(wslCmd) || isCmd(wslCmd)) {
      wslCmd = 'bash';
      if (tempScriptPath) {
        wslArgs = [convertToWslPath(tempScriptPath)];
      }
    }

    // Auto-heal CRLF boundary issues for text-processing tools reading Windows files handled earlier before sh -c wrapper

    args = ['--cd', wslCwd, '-e', 'env', ...wslEnvArgs, wslCmd, ...wslArgs];
    cmd = 'wsl.exe';
  }

  return { cmd, args, tempScriptPath, envOverrides, resolvedCwd: payload.cwd ? path.resolve(payload.cwd) : cwd };
}
