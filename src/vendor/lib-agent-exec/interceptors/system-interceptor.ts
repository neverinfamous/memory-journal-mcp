// @ts-nocheck
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { match, P } from 'ts-pattern';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { convertToWslPath, getPositionalArgs, healFragmentedQuotes, escapeUnixArg } from '../command-utils.js';
import { getUnquoted } from './utils.js';
import { runMutatingInterceptors } from './mutating-interceptors.js';
import { runStructuralInterceptors } from './structural-interceptors.js';
import { healPathHallucinations, healEvalCodePathHallucinations } from '../path-healer.js';
import { handleFindInterception, handleRipgrepInterception, handleGrepInterception } from './search-interceptor.js';
const INTERPRETER_INLINE_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  tsx: ['-e', '--eval', '-p', '--print'],
  'ts-node': ['-e', '--eval', '-p', '--print'],
  python: ['-c', '--command'],
  python3: ['-c', '--command'],
};

function getInlineScriptDetails(interpreter: string, args: string[]): { flagIdx: number; isPrint: boolean; scriptContent: string } | null {
  const allowed = INTERPRETER_INLINE_FLAGS[interpreter.toLowerCase()];
  if (!allowed || args.length === 0) return null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (allowed.includes(arg)) {
      if (i + 1 < args.length) {
        return {
          flagIdx: i,
          isPrint: ['-p', '--print'].includes(arg),
          scriptContent: args[i + 1],
        };
      }
      return null;
    }
    // If we encounter an argument before any inline flag that is NOT an interpreter option,
    // then it's a subcommand or a script path, so any subsequent flags belong to that script/subcommand!
    if (!arg.startsWith('-')) {
      return null;
    }
    // If it looks like a script file or relative/absolute path, it's not an interpreter option
    if (arg.startsWith('./') || arg.startsWith('.\\') || /\\.(?:ts|js|mjs|cjs|py)$/i.test(arg)) {
      return null;
    }
  }
  return null;
}

export function systemInterceptor(ctx: ExecutionContext): void {
  const originalArgs = ctx.args;
  ctx.args = healFragmentedQuotes(ctx.args);
  if (ctx.args.length !== originalArgs.length || ctx.args.some((a, idx) => a !== originalArgs[idx])) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected fragmented quotes from PowerShell tokenization. Reassembling arguments... (Frictionless Recovery)\x1b[0m`);
  }
  const { cmdBasename, payload } = ctx;
  const { args } = ctx;
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'fd', 'fd.exe', 'fdfind', 'fdfind.exe', 'node', 'node.exe', 'python', 'python.exe', 'bun', 'bun.exe', 'tail', 'tail.exe', 'head', 'head.exe', 'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval', '-execute', '--execute'];
  if (payload.type === 'eval' && typeof payload.code === 'string') {
    const trimmedCode = payload.code.trim();

    // Frictionless Recovery: detect grep_search invocation in eval code
    if (/^grep_search\s*\(/i.test(trimmedCode)) {
      const patternMatch = trimmedCode.match(/SearchPattern\s*:\s*["'`]([^"'`]+)["'`]/i);
      const pathMatch = trimmedCode.match(/SearchPath\s*:\s*["'`]([^"'`]+)["'`]/i);
      const caseMatch = trimmedCode.match(/CaseInsensitive\s*:\s*(true|false)/i);
      const regexMatch = trimmedCode.match(/IsRegex\s*:\s*(true|false)/i);

      if (patternMatch !== null && patternMatch[1] !== undefined) {
        const pattern = patternMatch[1];
        const searchPath = (pathMatch !== null && pathMatch[1] !== undefined) ? pathMatch[1] : '.';
        const isCaseInsensitive = caseMatch !== null && caseMatch[1] !== undefined ? caseMatch[1].toLowerCase() === 'true' : false;
        const isRegex = regexMatch !== null && regexMatch[1] !== undefined ? regexMatch[1].toLowerCase() === 'true' : false;

        console.error(`\n   💡 AGENT HINT: 'grep_search' called as a function inside eval code.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating grep_search function call to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);

        const flags = ['-n'];
        if (isCaseInsensitive) flags.push('-i');
        if (!isRegex) flags.push('-F');
        payload.code = `rg ${flags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(searchPath, false)}`;
      }
    } else {
      const pkgGrepMatch = trimmedCode.match(/^(?:bun|npm|pnpm|yarn|npx)\s+(?:run\s+)?grep_search\b\s*(.*)$/i);
      if (pkgGrepMatch !== null) {
        const rest = pkgGrepMatch[1] ?? '';
        const sMatch = rest.match(/(?:-s|--symbol|--pattern)\s+["'`]([^"'`]+)["'`]|(?:-s|--symbol|--pattern)\s+([^\s]+)/i);
        const pMatch = rest.match(/(?:-p|--path)\s+["'`]([^"'`]+)["'`]|(?:-p|--path)\s+([^\s]+)/i);
        const pattern = (sMatch !== null ? (sMatch[1] ?? sMatch[2]) : undefined) ?? '';
        const searchPath = (pMatch !== null ? (pMatch[1] ?? pMatch[2]) : undefined) ?? '.';

        if (pattern.length > 0) {
          console.error(`\n   💡 AGENT HINT: 'grep_search' executed via package manager in eval code.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'bun run grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
          payload.code = `rg -n -F ${escapeUnixArg(pattern, false)} ${escapeUnixArg(searchPath, false)}`;
        }
      }
    }

    if ((AGENT_NATIVE_TOOLS as readonly string[]).includes(trimmedCode)) {
      console.error(`\n   💡 AGENT HINT: '${trimmedCode}' is an agent-native tool, NOT executable code or a shell script. Please invoke the '${trimmedCode}' tool directly.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    }
    const matchedMcpTool = (ECOSYSTEM_MCP_TOOLS as readonly string[]).find(t => trimmedCode === t || trimmedCode.startsWith(`${t}(`) || trimmedCode.startsWith(`${t} `));
    if (matchedMcpTool !== undefined) {
      console.error(`\n   💡 AGENT HINT: '${matchedMcpTool}' is an MCP tool, NOT executable code or a shell script. Please call the '${matchedMcpTool}' MCP tool via call_mcp_tool.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    }
  }

  const isCommand = payload.type === 'command';
  const rawCmdStr = 'command' in payload && typeof payload.command === 'string' && payload.command.trim().includes(' ')
    ? payload.command.trim()
    : cmdBasename.trim();
  const embeddedArgs = rawCmdStr.includes(' ')
    ? rawCmdStr.split(/\s+/).slice(1)
    : [];
  const combinedArgs = [...embeddedArgs, ...args];
  const positionalArgs = getPositionalArgs(cmdBasename, combinedArgs);
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();

  // Extract the first token's basename when the command string contains spaces
  // to prevent path.basename("curl https://example.com") returning "example.com"
  const originalCmd = 'command' in payload && typeof payload.command === 'string'
    ? (() => {
        const cmdStr = payload.command.trim();
        const firstToken = cmdStr.includes(' ') ? cmdStr.split(/\s+/)[0] : cmdStr;
        return path.basename(firstToken).toLowerCase();
      })()
    : cmd;

  // 0. Early intercept: detect commands embedded in command string or scripts
  const networkAliases = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
  if (isCommand && 'command' in payload && typeof payload.command === 'string' && payload.command.includes(' ')) {
    const firstToken = payload.command.trim().split(/\s+/)[0].toLowerCase();
    const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
    if (networkAliases.includes(firstTokenBase) && !firstToken.endsWith('.exe') && payload.target !== 'wsl2') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${firstToken}' detected in command string. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      payload.target = 'wsl2';
    }
  }

  // Intercept network, search, and fs list aliases in eval and script payloads (ONLY for shell scripts)
  if ((payload.type === 'eval' || payload.type === 'script') && payload.target !== 'wsl2') {
    const isShellPayload = (() => {
      if (payload.type === 'eval') {
        const interp = (payload.interpreter || 'pwsh').toLowerCase();
        return ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(interp);
      }
      if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
        if (payload.interpreter) {
          return ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(payload.interpreter.toLowerCase());
        }
        const ext = path.extname(payload.scriptPath).toLowerCase();
        return ['.ps1', '.bat', '.cmd', '.sh', '.bash'].includes(ext);
      }
      return false;
    })();

    if (isShellPayload) {
      let scriptContent = '';
      if (payload.type === 'eval') {
        scriptContent = payload.code;
      } else if (payload.type === 'script' && typeof payload.scriptPath === 'string' && fs.existsSync(payload.scriptPath)) {
        scriptContent = fs.readFileSync(payload.scriptPath, 'utf8');
      }
      const tokens = scriptContent.split(/[\s;|{>&<]+/).filter(Boolean).map((t: string) => t.toLowerCase());
      
      const cmdStr = tokens.find((t: string) => networkAliases.includes(t));
      const fsSearchAliases = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe'];
      const searchCmdStr = tokens.find((t: string) => fsSearchAliases.includes(t));
      const fsListAliases = ['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'];
      const listCmdStr = tokens.find((t: string) => fsListAliases.includes(t));

      if (cmdStr || searchCmdStr || listCmdStr) {
        const detected = cmdStr || searchCmdStr || listCmdStr;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Shell command/script using '${detected}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        if (!payload.interpreter || ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(payload.interpreter)) {
          payload.interpreter = 'bash';
        }
      }
    }
  }

  if (payload.target === 'wsl2') {
    let defaultWslTimeout = 30000;
    
    if (payload.type === 'eval' || payload.type === 'script') {
      const codeOrScript = payload.type === 'eval' ? payload.code : (payload.scriptPath || '');
      const hasQualityCheck = codeOrScript && /(?:typecheck|tsc|lint|check|build|test|vitest|jest|playwright)/i.test(codeOrScript);
      const hasMountedSearch = codeOrScript && /(?:find|grep|rg|ls|tree)\b/i.test(codeOrScript);
      
      if (hasQualityCheck) {
        defaultWslTimeout = 90000;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected quality check in WSL2 eval payload. Auto-extending timeout to 90s... (Frictionless Recovery)`);
      } else if (hasMountedSearch) {
        defaultWslTimeout = 90000;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected file search across mounted filesystem in WSL2 eval payload. Auto-extending timeout to 90s... (Frictionless Recovery)`);
      }
    } else if (payload.type === 'command') {
      const isQuality = /(?:typecheck|tsc|lint|check|build|test|vitest|jest|playwright)/i.test(cmdBasename) || (args && args.some(a => /(?:typecheck|tsc|lint|check|build|test|vitest|jest|playwright)/i.test(a)));
      const isSearch = /(?:find|grep|rg|ls|tree)\b/i.test(cmdBasename) || (args && args.some(a => /(?:find|grep|rg|ls|tree)\b/i.test(a)));
      
      if (isQuality) {
        defaultWslTimeout = 90000;
      } else if (isSearch) {
        defaultWslTimeout = 90000;
      }
    }
    
    payload.timeoutMs = Math.max(payload.timeoutMs || defaultWslTimeout, defaultWslTimeout);
  }

  // 1. Generic Path Hallucination Intercepts (runs before tool matching so healed paths are matched)
  healPathHallucinations(ctx);

  // 1.1. Mutating intercepts (safe to run before block checks)
  runMutatingInterceptors(ctx, { cmd, cmdBasename, args });

  const activeCombinedArgs = [...embeddedArgs, ...ctx.args];
  const activePositionalArgs = getPositionalArgs(cmdBasename, activeCombinedArgs);

  match({ ...ctx, positionalArgs: activePositionalArgs, hasStdin, cmd, isCommand, isWin32: process.platform === 'win32', originalCmd })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      if (!hasStdin && activePositionalArgs.length === 0) {
        console.error(`\n   💡 AGENT HINT: 'cat' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Provide a file argument or use view_file.\x1b[0m`);
        process.exit(1);
      }
      console.error(`\n   💡 AGENT INTERCEPT: 'cat' file inspection command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      if (embeddedArgs.length > 0 && ctx.args.length === 0) {
        ctx.args = [...embeddedArgs];
        ctx.cmdBasename = originalCmd;
        if (ctx.payload.type === 'command') {
          ctx.payload.command = originalCmd;
          ctx.payload.args = ctx.args;
        }
      }
      if (cmdBasename.toLowerCase().startsWith('select-string')) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'grep';
        ctx.cmdBasename = 'grep';
      }
      handleGrepInterception(ctx, hasStdin);
    })
    .with({ originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' directory listing command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      if ('interpreter' in ctx.payload && ctx.payload.interpreter && ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(ctx.payload.interpreter.toLowerCase())) {
        ctx.payload.interpreter = 'bash';
      }

      const filterIdx = ctx.args.findIndex(a => ['-filter', '-include'].includes(a.toLowerCase()));
      const hasRecurse = ctx.args.some(a => ['-recurse', '-r', '-R', '/s'].includes(a.toLowerCase()));
      const hasFile = ctx.args.some(a => a.toLowerCase() === '-file');
      const hasDir = ctx.args.some(a => a.toLowerCase() === '-directory');

      if (filterIdx !== -1 && filterIdx + 1 < ctx.args.length) {
        const pattern = ctx.args[filterIdx + 1];
        let targetPath = '.';
        for (let i = 0; i < ctx.args.length; i++) {
          if (i === filterIdx || i === filterIdx + 1) continue;
          const a = ctx.args[i];
          if (!a.startsWith('-')) {
            targetPath = convertToWslPath(a);
            break;
          }
        }
        if (ctx.payload.type === 'command') {
          ctx.payload.command = 'find';
        }
        const newArgs = [targetPath];
        if (!hasRecurse) {
          newArgs.push('-maxdepth', '1');
        }
        if (hasFile) newArgs.push('-type', 'f');
        if (hasDir) newArgs.push('-type', 'd');
        newArgs.push('-name', pattern);
        ctx.args = newArgs;
        return;
      }

      // Check if this is a recursive search with a file pattern (e.g. dir /s /b pattern.ext or dir /s pattern)
      const nonFlagArgs = ctx.args.filter(a => !a.startsWith('-') && !a.startsWith('/'));
      if (hasRecurse && nonFlagArgs.length > 0) {
        const patternArg = nonFlagArgs[0];
        let targetPath = '.';
        let pattern = patternArg;
        
        if (patternArg.includes('/') || patternArg.includes('\\')) {
          const lastSep = Math.max(patternArg.lastIndexOf('/'), patternArg.lastIndexOf('\\'));
          const dirPart = patternArg.substring(0, lastSep);
          pattern = patternArg.substring(lastSep + 1);
          if (dirPart) {
            targetPath = convertToWslPath(dirPart);
          }
        }

        if (pattern && pattern !== '.' && pattern !== '..') {
          if (ctx.payload.type === 'command') {
            ctx.payload.command = 'find';
          }
          const newArgs = [targetPath];
          if (hasFile) newArgs.push('-type', 'f');
          if (hasDir) newArgs.push('-type', 'd');
          newArgs.push('-name', pattern);
          ctx.args = newArgs;
          return;
        }
      }

      if (['dir', 'get-childitem', 'gci'].includes(cmdBasename.toLowerCase())) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'ls';
      }

      const cleanedArgs: string[] = [];
      let skipNext = false;
      for (let i = 0; i < ctx.args.length; i++) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        const a = ctx.args[i];
        const lower = a.toLowerCase();
        if (lower === '-path' || lower === '-path:') {
          continue;
        }
        if (lower === '-filter' || lower === '-include') {
          skipNext = true;
          continue;
        }
        if (lower === '-recurse' || lower === '/s') {
          cleanedArgs.push('-R');
          continue;
        }
        if (lower === '/b') {
          cleanedArgs.push('-1');
          continue;
        }
        if (lower === '-file' || lower === '-directory') {
          continue;
        }
        if (lower === '-name') {
          cleanedArgs.push('-1');
          continue;
        }
        if (lower === '-force' || lower === '-hidden') {
          cleanedArgs.push('-a');
          continue;
        }
        if (lower === '-readonly') {
          continue;
        }
        cleanedArgs.push(convertToWslPath(a));
      }
      ctx.args = cleanedArgs;
    })
    .with({ originalCmd: P.union('curl', 'curl.exe', 'wget', 'wget.exe', 'invoke-webrequest', 'iwr') }, () => {
      if (ctx.payload.target !== 'wsl2') {
        console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' network command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
      }
      if (['invoke-webrequest', 'iwr'].includes(cmdBasename.toLowerCase())) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'curl';
      }
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'find', 'find.exe', 'tail', 'tail.exe', 'head', 'head.exe', 'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe') }, () => {
      if (ctx.payload.target !== 'wsl2') {
        console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
      }

      if (['find', 'find.exe'].includes(cmdBasename.toLowerCase())) {
        handleFindInterception(ctx);
      }

      // Automatically convert Windows paths (like C:\... or C:/... or "C:\...") to WSL paths (/mnt/c/...)
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ isCommand: true, originalCmd: P.union('rg', 'rg.exe') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      handleRipgrepInterception(ctx, hasStdin);
    })
    .with({ cmd: P.union('gh', 'gh.exe', 'pnpm', 'npm', 'docker', 'docker.exe') }, ({ args }) => {
      const isLogin = args.some(a => a === 'login' || a === 'auth');
      if (isLogin) {
        console.error(`\n   💡 AGENT HINT: Interactive login commands like '${cmdBasename} ${args.join(' ')}' hang the agent.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Blocking execution. Authentication must be handled externally.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args: matchedArgs }) => {
      const scriptStartFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];
      const scriptFlagIdx = matchedArgs.findIndex(a => scriptStartFlags.includes(a.toLowerCase()));
      const searchArgs = scriptFlagIdx === -1 ? matchedArgs : matchedArgs.slice(0, scriptFlagIdx);
      
      if (!searchArgs.some(a => a.toLowerCase() === '-noninteractive')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-NonInteractive');
      }
      if (!searchArgs.some(a => a.toLowerCase() === '-noprofile')) {
        ctx.args.unshift('-NoProfile');
      }
    })
    .otherwise(() => {});


  // 2. Unsafe Pipes Detection
  const cmdLower = cmdBasename.toLowerCase();
  const isPkgMgr = ['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bun.exe', 'npx', 'npx.cmd'].includes(cmdLower);
  const pkgSubcommand = isPkgMgr ? args.find(a => !a.startsWith('-'))?.toLowerCase() : undefined;
  const isInvokingPatternTool = pkgSubcommand !== undefined && patternTools.includes(pkgSubcommand);

  const shouldCheckPipes = match(payload)
    .with({ type: 'command', target: 'wsl2' }, () => false)
    .with({ type: 'command' }, () => !patternTools.includes(cmd) && !isInvokingPatternTool)
    .otherwise(() => false);

  if (shouldCheckPipes) {
    const hasUnsafe = args.some((arg, index) => {
      // Avoid falsely triggering on semicolons or shell characters inside inline script bodies or attached values
      if (index > 0 && inlineFlags.includes(args[index - 1].toLowerCase())) {
        return false;
      }
      if (inlineFlags.some(flag => arg.toLowerCase().startsWith(flag + '=') || (flag.length === 2 && arg.toLowerCase().startsWith(flag) && arg.length > 2))) {
        return false;
      }
      return match(arg)
        .with(P.string.includes('$('), () => true)
        .with(P.string.includes('`'), () => true)
        .with(P.when(a => a.includes('\\&') || a.includes('\\|') || a.includes('\\>') || a.includes('\\<') || a.includes('\\;')), () => true)
        .with(P.when((a: string) => {
            if (exactShellChars.includes(a.trim())) return true;
            
            const finalState = { unquoted: getUnquoted(a) };
            
            return exactShellChars.some(op => {
                let checkStr = finalState.unquoted;
                checkStr = checkStr.replace(/<[^>]+>/g, '');
                if (op === '>') {
                    checkStr = checkStr.replace(/=>/g, '').replace(/->/g, '');
                } else if (op === '<') {
                    checkStr = checkStr.replace(/<-/g, '');
                }
                
                if (!checkStr.includes(op)) return false;
                
                const hasSpacesAround = checkStr.includes(` ${op} `) || checkStr.startsWith(`${op} `) || checkStr.endsWith(` ${op}`);
                const isShell = ['pwsh', 'powershell', 'bash', 'sh', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'].includes(cmdLower);
                
                if (checkStr.trim() === op) return true;
                if (isShell) return true;
                
                if (checkStr.includes('{') || checkStr.includes('[')) return false;
                
                if (!hasSpacesAround) {
                    if (op === '|') return false; // Single | without spaces is regex alternation or union type
                    if (op === '&&' || op === '||') return true; // Chained commands without spaces
                    return false;
                }
                
                if (isPkgMgr) return true;
                return false;
            });
        }), () => true)
        .otherwise(() => false);
    });
    if (hasUnsafe) {
      console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings and will fail.`);
      console.error(`   To use shell features, please use a 'script' payload type or pipe natively in PowerShell.`);
      process.exit(1);
    }
  }

  // Helper for inline commands
  const inlineIdx = args.findIndex(a => inlineFlags.includes(a.toLowerCase()));
  const hasInlineCmd = inlineIdx !== -1;
  const inlineFlag = hasInlineCmd ? args[inlineIdx].toLowerCase() : '';
  const innerCmdStr = hasInlineCmd ? (args[inlineIdx + 1] || '') : '';
  


  // 3. Centralized structural blocking using ts-pattern
  runStructuralInterceptors(ctx, { cmd, cmdBasename, originalCmd, args, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, hasStdin, shells });

  const interpreterName = originalCmd.replace(/\.exe$/i, '').toLowerCase();
  const inlineDetails = isCommand && ['node', 'bun', 'python', 'python3', 'tsx', 'ts-node'].includes(interpreterName)
    ? getInlineScriptDetails(interpreterName, ctx.args)
    : null;

  if (inlineDetails) {
    const { flagIdx, isPrint, scriptContent } = inlineDetails;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting inline ${interpreterName} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)\x1b[0m`);
    const ext = interpreterName.startsWith('python') ? 'py' : (['bun', 'tsx', 'ts-node'].includes(interpreterName) ? 'ts' : 'js');
    const outDir = os.tmpdir();
    const tmpFile = path.join(outDir, `.agent_inline_script_${Date.now()}.${ext}`);

    const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
      ? path.resolve(ctx.payload.cwd)
      : process.cwd();

    let fileContent = interpreterName.startsWith('python')
      ? `import sys; sys.path.insert(0, '')\n${scriptContent}`
      : healEvalCodePathHallucinations(scriptContent, cwd, ctx.payload.target);

    if (isPrint) {
      fileContent = `try {\n  const __res = eval(${JSON.stringify(fileContent)});\n  if (__res !== undefined) console.log(__res);\n} catch {\n  ${fileContent}\n}\n`;
    }

    fs.writeFileSync(tmpFile, fileContent);
    process.on('exit', () => {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // ignore
      }
    });

    ctx.cmdBasename = interpreterName;
    ctx.args.splice(flagIdx, 2, tmpFile);
    if ('command' in ctx.payload) {
      ctx.payload.command = interpreterName;
      ctx.payload.args = ctx.args;
    }
  }
}
