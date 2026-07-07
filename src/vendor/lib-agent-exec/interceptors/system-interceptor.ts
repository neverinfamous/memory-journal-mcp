// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function systemInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'node', 'node.exe', 'python', 'python.exe', 'bun', 'bun.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval'];


  const isCommand = payload.type === 'command';
  const positionalArgs = args.filter(a => !a.startsWith('-'));
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

  // 0. Early intercept: detect blocked commands embedded in the command string with spaces
  // Agents hallucinate by putting "curl https://example.com" as the command instead of using args
  const networkAliases = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
  if (isCommand && 'command' in payload && typeof payload.command === 'string' && payload.command.includes(' ')) {
    const firstToken = payload.command.trim().split(/\s+/)[0].toLowerCase();
    const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
    if (networkAliases.includes(firstTokenBase) && !firstToken.endsWith('.exe') && payload.target !== 'wsl2') {
      const nativeExe = firstTokenBase === 'wget' ? 'wget.exe' : 'curl.exe';
      console.error(`\n   💡 AGENT HINT: Do NOT use '${firstToken}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    }
  }

  // Intercept network and fs search aliases in eval and script payloads
  if ((payload.type === 'eval' || payload.type === 'script') && (!payload.interpreter || ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(payload.interpreter)) && payload.target !== 'wsl2') {
    let scriptContent = '';
    if (payload.type === 'eval') {
      scriptContent = payload.code;
    } else if (payload.type === 'script' && typeof payload.scriptPath === 'string' && fs.existsSync(payload.scriptPath)) {
      scriptContent = fs.readFileSync(payload.scriptPath, 'utf8');
    }
    const tokens = scriptContent.split(/[\s;|{>&<]+/).filter(Boolean).map((t: string) => t.toLowerCase());
    
    const cmdStr = tokens.find((t: string) => networkAliases.includes(t));
    if (cmdStr) {
      const nativeExe = cmdStr === 'wget' ? 'wget.exe' : 'curl.exe';
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdStr}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    }

    const fsSearchAliases = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe', 'select-string', 'select-string.exe'];
    const searchCmdStr = tokens.find((t: string) => fsSearchAliases.includes(t));
    if (searchCmdStr) {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${searchCmdStr}' or its PowerShell cmdlet equivalent (Select-String) natively. You MUST use the agent-native 'grep_search' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    }

    const fsListAliases = ['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'];
    const listCmdStr = tokens.find((t: string) => fsListAliases.includes(t));
    if (listCmdStr) {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${listCmdStr}' or its PowerShell cmdlet equivalent (Get-ChildItem) natively. You MUST use the agent-native 'list_dir' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    }
  }

  // 1. Mutating intercepts (safe to run before block checks)
  match({ cmd, originalCmd, args, payload, hasStdin })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      if (!matchedArgs.some(a => a.includes('BatchMode=yes'))) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        ctx.args.unshift('-o', 'BatchMode=yes');
      }
      if (!matchedArgs.some(a => a.includes('StrictHostKeyChecking='))) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
      }
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args }) => {
      if (process.platform === 'win32' || cmd === 'ping.exe') {
        if (args.includes('-t')) {
          console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
          for (let i = args.length - 1; i >= 0; i--) {
            if (args[i] === '-t') args.splice(i, 1);
          }
        }
      } else {
        if (!args.includes('-c')) {
          console.error(`\n   💡 AGENT HINT: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
          args.unshift('-c', '4');
        }
      }
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if (process.platform !== 'win32' && !matchedArgs.includes('-n') && !matchedArgs.includes('--non-interactive')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        ctx.args.unshift('-n');
      }
    })
    .with({ cmd: P.union('git', 'git.exe') }, ({ args: matchedArgs }) => {
      if (matchedArgs.includes('add') && matchedArgs.some(a => a.includes('.agents'))) {
        if (!matchedArgs.includes('-f') && !matchedArgs.includes('--force')) {
           console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '-f' to 'git add' for '.agents' path which is ignored... (Frictionless Recovery)\x1b[0m`);
           ctx.args.splice(ctx.args.indexOf('add') + 1, 0, '-f');
        }
      }
      if (matchedArgs.includes('branch') && matchedArgs.includes('-r')) {
        console.error(`\n   💡 AGENT HINT: 'git branch -r' may return stale deleted branches.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Synchronously running 'git fetch -p' to prune the cache before executing branch listing.\x1b[0m`);
        try {
          execSync('git fetch -p', { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
    })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content'), hasStdin: false, payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use 'cat', 'cat.exe', or 'get-content' natively. You MUST use the agent-native 'view_file' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('awk', 'sed', 'jq', 'jq.exe') }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
    })
    .with({ isCommand: true, originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe'), hasStdin: true }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
    })
    .with({ cmd: P.union('gh', 'gh.exe', 'pnpm', 'npm', 'docker', 'docker.exe') }, ({ args }) => {
      const isLogin = args.some(a => a === 'login' || a === 'auth');
      if (isLogin) {
        console.error(`\n   💡 AGENT HINT: Interactive login commands like '${cmdBasename} ${args.join(' ')}' hang the agent.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Blocking execution. Please instruct the user to run this in their own terminal appended with '--agent-bypass'.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args: matchedArgs }) => {
      const scriptStartFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];
      const scriptFlagIdx = matchedArgs.findIndex(a => scriptStartFlags.includes(a.toLowerCase()));
      const searchArgs = scriptFlagIdx === -1 ? matchedArgs : matchedArgs.slice(0, scriptFlagIdx);
      
      if (!searchArgs.some(a => a.toLowerCase() === '-noninteractive')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        ctx.args.unshift('-NonInteractive');
      }
      if (!searchArgs.some(a => a.toLowerCase() === '-noprofile')) {
        ctx.args.unshift('-NoProfile');
      }
    })
    .otherwise(() => {});

  // 1.5. Generic Path Hallucination Intercepts
  for (let i = 0; i < args.length; i++) {
    // memory-journal-mcp backups path hallucination
    if (args[i].includes('memory-journal-mcp\\backups') || args[i].includes('memory-journal-mcp/backups')) {
      console.error(`\n   💡 AGENT HINT: 'backups' directory is located at 'data/backups', not the repository root.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to data/backups.\x1b[0m`);
      args[i] = args[i].replace(/memory-journal-mcp[\\/]backups/g, 'memory-journal-mcp\\data\\backups');
    }
  }

  // 2. Unsafe Pipes Detection
  const shouldCheckPipes = match(payload)
    .with({ type: 'command', target: 'wsl2' }, () => false)
    .with({ type: 'command' }, () => !patternTools.includes(cmd))
    .otherwise(() => false);

  if (shouldCheckPipes) {
    const localInlineIdx = args.findIndex(a => inlineFlags.includes(a.toLowerCase()));
    const hasUnsafe = args.some((arg, index) => {
      // Avoid falsely triggering on semicolons or shell characters inside inline script bodies
      if (localInlineIdx !== -1 && index === localInlineIdx + 1) {
        return false;
      }
      return match(arg)
        .with(P.string.includes('$('), () => true)
        .with(P.string.includes('`'), () => true)
        .with(P.when(a => a.includes('\\&') || a.includes('\\|') || a.includes('\\>') || a.includes('\\<') || a.includes('\\;')), () => true)
        .with(P.when((a: string) => {
            if (exactShellChars.includes(a.trim())) return true;
            
            type ParseState = { inSingle: boolean; inDouble: boolean; unquoted: string; isEscaped: boolean };
            const initialState: ParseState = { inSingle: false, inDouble: false, unquoted: '', isEscaped: false };
            
            const finalState = a.split('').reduce((state: ParseState, char: string) => {
                return match([state, char] as const)
                    .with([{ isEscaped: true, inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, isEscaped: false, unquoted: s.unquoted + c }))
                    .with([{ isEscaped: true }, P.string], ([s]) => ({ ...s, isEscaped: false }))
                    .with([{ inSingle: false, inDouble: false }, '\\'], ([s, c]) => ({ ...s, isEscaped: true, unquoted: s.unquoted + c }))
                    .with([{ inDouble: true }, '\\'], ([s]) => ({ ...s, isEscaped: true }))
                    .with([{ inDouble: false }, "'"], ([s]) => ({ ...s, inSingle: !s.inSingle }))
                    .with([{ inSingle: false }, '"'], ([s]) => ({ ...s, inDouble: !s.inDouble }))
                    .with([{ inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, unquoted: s.unquoted + c }))
                    .with([{ inSingle: true }, P.string], ([s]) => s)
                    .with([{ inDouble: true }, P.string], ([s]) => s)
                    .exhaustive();
            }, initialState);
            
            return exactShellChars.some(op => {
                if (!finalState.unquoted.includes(op)) return false;
                
                const hasSpacesAround = finalState.unquoted.includes(` ${op} `) || finalState.unquoted.startsWith(`${op} `) || finalState.unquoted.endsWith(` ${op}`);
                const isShell = ['pwsh', 'powershell', 'bash', 'sh', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'].includes(cmdBasename.toLowerCase());
                
                return match({ 
                    isExact: finalState.unquoted.trim() === op,
                    hasSpacesAround, 
                    isShell, 
                    argsLen: args.length,
                    cmd: cmdBasename.toLowerCase()
                })
                .with({ isExact: true }, () => true)
                .with({ hasSpacesAround: false }, () => true)
                .with({ isShell: true }, () => true)
                .with({ argsLen: 1 }, ({ cmd }) => !['echo', 'echo.exe'].includes(cmd))
                .otherwise(() => false);
            });
        }), () => true)
        .otherwise(() => false);
    });
    if (hasUnsafe) {
      console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
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
  
  // Helper to safely strip quoted parts using a ts-pattern state machine
  const getUnquoted = (str: string) => {
    type ParseState = { inSingle: boolean; inDouble: boolean; unquoted: string; isEscaped: boolean };
    const initialState: ParseState = { inSingle: false, inDouble: false, unquoted: '', isEscaped: false };
    return str.split('').reduce((state: ParseState, char: string) => {
        return match([state, char] as const)
            .with([{ isEscaped: true, inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, isEscaped: false, unquoted: s.unquoted + c }))
            .with([{ isEscaped: true }, P.string], ([s]) => ({ ...s, isEscaped: false }))
            .with([{ inSingle: false, inDouble: false }, '\\'], ([s, c]) => ({ ...s, isEscaped: true, unquoted: s.unquoted + c }))
            .with([{ inDouble: true }, '\\'], ([s]) => ({ ...s, isEscaped: true }))
            .with([{ inDouble: false }, "'"], ([s]) => ({ ...s, inSingle: !s.inSingle }))
            .with([{ inSingle: false }, '"'], ([s]) => ({ ...s, inDouble: !s.inDouble }))
            .with([{ inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, unquoted: s.unquoted + c }))
            .with([{ inSingle: true }, P.string], ([s]) => s)
            .with([{ inDouble: true }, P.string], ([s]) => s)
            .exhaustive();
    }, initialState).unquoted;
  };

  // 3. Centralized structural blocking using ts-pattern
  match({ cmd, originalCmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32', payload })
    .with({ isCommand: true, originalCmd: P.union('node', 'node.exe', 'python', 'python.exe', 'python3', 'python3.exe', 'bun', 'bun.exe'), args: P.when((a: string[]) => a.some(arg => ['-e', '--eval', '-p', '--print', '-c', '--command'].includes(arg))) }, ({ originalCmd }) => {
      const interpreter = originalCmd.replace(/\.exe$/, '');
      const flagIdx = ctx.args.findIndex(a => ['-e', '--eval', '-p', '--print', '-c', '--command'].includes(a));
      const scriptContent = ctx.args[flagIdx + 1];
      
      if (scriptContent) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting inline ${interpreter} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)\x1b[0m`);
        const ext = interpreter.startsWith('python') ? 'py' : (interpreter === 'bun' ? 'ts' : 'js');
        const tmpFile = path.join(os.tmpdir(), `agent_inline_script_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpFile, scriptContent);
        
        ctx.args.splice(flagIdx, 2, tmpFile);
      } else {
        console.error(`\n   💡 AGENT HINT: Inline script flag found but no script content followed.\x1b[0m`);
        process.exit(1);
      }
    })
    // Shell inline rules
    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true, inlineFlag: P.union('-ec', '-encodedcommand', '-en') }, () => {
      console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: false, args: P.when((a: string[]) => {
      return a.length > 0 && !a.some(arg => ['-file', '-help', '-version', '-?', '/?'].includes(arg.toLowerCase()));
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command implicitly via powershell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
        const stripped = getUnquoted(s);
        return stripped.includes('&&') || stripped.includes('||') || stripped.includes('|') || stripped.includes('>');
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: In PowerShell, avoid using '&&', '||', '|', and '>'. You MUST use semicolons (;) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })

    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true }, ({ originalCmd: _shellCmd, inlineFlag: flag, innerCmdStr }: { innerCmdStr: string; originalCmd: string; inlineFlag: string }) => {
      // Skip blocking for WSL2 targets: bash -c is a legitimate pattern that gets wrapped in wsl.exe later
      if (payload.target === 'wsl2') return;

      const stripped = getUnquoted(innerCmdStr).toLowerCase();
      const tokens = stripped.split(/[\s;|{>&<]+/).filter(Boolean);
      
      const networkAliases = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
      const netCmdStr = tokens.find(t => networkAliases.includes(t));
      if (netCmdStr) {
        const nativeExe = netCmdStr === 'wget' ? 'wget.exe' : 'curl.exe';
        console.error(`\n   💡 AGENT HINT: Do NOT use '${netCmdStr}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }

      const fsSearchAliases = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe', 'select-string', 'select-string.exe'];
      const searchCmdStr = tokens.find(t => fsSearchAliases.includes(t));
      if (searchCmdStr) {
        console.error(`\n   💡 AGENT HINT: Do NOT use '${searchCmdStr}' or its PowerShell cmdlet equivalent (Select-String) natively. You MUST use the agent-native 'grep_search' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }

      const fsListAliases = ['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'];
      const listCmdStr = tokens.find(t => fsListAliases.includes(t));
      if (listCmdStr) {
        console.error(`\n   💡 AGENT HINT: Do NOT use '${listCmdStr}' or its PowerShell cmdlet equivalent (Get-ChildItem) natively. You MUST use the agent-native 'list_dir' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }

      const wrappedShell = (cmdBasename === 'wsl.exe' || cmdBasename === 'wsl') ? (args.find((a: string) => ['bash', 'sh', 'pwsh', 'powershell'].includes(a.toLowerCase())) || cmdBasename) : cmdBasename;
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command (${wrappedShell} ${flag}). This is an agent hallucination.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })

    // Interactive blocks
    .with({ cmd: P.union('su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('ssh-keygen', 'ssh-keygen.exe') }, () => {
      if (!args.includes('-f') || !args.includes('-N')) {
        console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('runas', 'runas.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('sudo', 'sudo.exe'), isWin32: true }, () => {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })

    // Indefinite Hang Blocks
    .with({ cmd: P.union('watch', 'watch.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('tail', 'tail.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
        console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow')) {
        console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }
    })

    // Native tool enforcement
    .with({ isCommand: true, hasStdin: false, cmd: P.union('cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'), positionalArgs: P.when(pa => pa.length === 0) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('xargs', 'xargs.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      const isSafe = match(cmd)
        .with(P.union('jq', 'jq.exe', 'yq', 'yq.exe'), () => args.includes('-n') || args.includes('--null-input') || args.includes('--help'))
        .with(P.union('sed', 'sed.exe'), () => args.includes('-h') || args.includes('--help'))
        .with(P.union('awk', 'gawk'), () => args.includes('-V') || args.includes('--version') || args.includes('-W') || args.includes('--help'))
        .otherwise(() => false);
      
      if (!isSafe) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      if (!args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
        process.exit(1);
      }
    })
    // Web request tool enforcement
    .with({ isCommand: true, originalCmd: P.union('curl', 'wget', 'invoke-webrequest', 'iwr'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      const cmdStr = originalCmd;
      const nativeExe = originalCmd === 'wget' ? 'wget.exe' : 'curl.exe';
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdStr}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })

    // Search tool enforcement (FS Alias Hallucinations)
    .with({ isCommand: true, originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe', 'select-string', 'select-string.exe'), hasStdin: false, payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${originalCmd}' or its PowerShell cmdlet equivalent (Select-String) natively. You MUST use the agent-native 'grep_search' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool, fix the command parameters yourself, OR launch a subagent to fix it using the '/mcp:memory-journal-mcp:mcp-heal' prompt.\x1b[0m`);
      process.exit(1);
    })

    // List dir tool enforcement (FS Alias Hallucinations)
    .with({ isCommand: true, originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently routing '${originalCmd}' to WSL2 for frictionless execution... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
      if (['dir', 'dir.exe', 'gci', 'get-childitem', 'get-childitem.exe'].includes(originalCmd.toLowerCase())) {
        ctx.cmdBasename = 'ls';
        const payloadObj = ctx.payload as { command?: string };
        if (typeof payloadObj.command === 'string') {
          payloadObj.command = payloadObj.command.replace(new RegExp(`^${originalCmd}\\b`, 'i'), 'ls')
            .replace(/\s-Path\b/gi, '');
        }
        ctx.args = ctx.args.filter(a => a.toLowerCase() !== '-path');
      }
    })


    .otherwise(() => {});
}
