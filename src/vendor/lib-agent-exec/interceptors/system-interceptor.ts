// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';
import { execSync } from 'node:child_process';
import path from 'node:path';

export function systemInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en'];


  const isCommand = payload.type === 'command';
  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();

  // 1. Mutating intercepts (safe to run before block checks)
  match({ cmd, args, payload })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      if (!matchedArgs.some(a => a.includes('BatchMode=yes'))) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        ctx.args.unshift('-o', 'BatchMode=yes');
      }
      if (!matchedArgs.some(a => a.includes('StrictHostKeyChecking='))) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
      }
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args }) => {
      if (process.platform === 'win32' || cmd === 'ping.exe') {
        if (args.includes('-t')) {
          console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
          for (let i = args.length - 1; i >= 0; i--) {
            if (args[i] === '-t') args.splice(i, 1);
          }
        }
      } else {
        if (!args.includes('-c')) {
          console.error(`\n   💡 AGENT HINT: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
          args.unshift('-c', '4');
        }
      }
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if (process.platform !== 'win32' && !matchedArgs.includes('-n') && !matchedArgs.includes('--non-interactive')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        ctx.args.unshift('-n');
      }
    })
    .with({ cmd: P.union('git', 'git.exe') }, ({ args: matchedArgs }) => {
      if (matchedArgs.includes('branch') && matchedArgs.includes('-r')) {
        console.error(`\n   💡 AGENT HINT: 'git branch -r' may return stale deleted branches.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Synchronously running 'git fetch -p' to prune the cache before executing branch listing.\x1b[0m`);
        try {
          execSync('git fetch -p', { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
    })
    .with({ cmd: P.union('cat', 'cat.exe', 'get-content'), payload: { target: P.when(t => t !== 'wsl2') } }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use 'cat', 'cat.exe', or 'get-content' natively. You MUST use the agent-native 'view_file' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('awk', 'sed', 'grep') }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' natively fails or lacks features on Windows.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching execution target to WSL2.\x1b[0m`);
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
      if (!matchedArgs.some(a => a.toLowerCase() === '-noninteractive')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        ctx.args.unshift('-NonInteractive');
      }
      if (!matchedArgs.some(a => a.toLowerCase() === '-noprofile')) {
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
  if (isCommand && !patternTools.includes(cmd)) {
    const hasUnsafe = args.some(arg => {
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
                if (finalState.unquoted.trim() === op) return true;
                const parts = finalState.unquoted.split(op);
                
                return match(parts)
                    .with(P.when(p => p.length < 2), () => false)
                    .otherwise((p) => p.slice(0, -1).some((before, i) => {
                        const after = p[i + 1];
                        return match([before, after])
                            .with([P.when(b => b !== '' && !b.endsWith(' ')), P.any], () => true)
                            .with([P.any, P.when(a => a !== '' && !a.startsWith(' '))], () => true)
                            .otherwise(() => false);
                    }));
            });
        }), () => true)
        .otherwise(() => false);
    });
    if (hasUnsafe) {
      console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
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
  const originalCmd = 'command' in payload && typeof payload.command === 'string' 
    ? path.basename(payload.command).toLowerCase() 
    : cmd;

  match({ cmd, originalCmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32' })
    // Shell inline rules
    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true, inlineFlag: P.union('-ec', '-encodedcommand', '-en') }, () => {
      console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('powershell', 'powershell.exe'), hasInlineCmd: false, args: P.when((a: string[]) => {
      return a.length > 0 && !a.some(arg => ['-file', '-help', '-version', '-?', '/?'].includes(arg.toLowerCase()));
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command implicitly via powershell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
        const stripped = getUnquoted(s);
        return stripped.includes('&&') || stripped.includes('||') || stripped.includes('|') || stripped.includes('>');
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: In PowerShell, avoid using '&&', '||', '|', and '>'. You MUST use semicolons (;) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
        const stripped = getUnquoted(s);
        const tokens = stripped.split(/[\s;|{>&<]+/).filter(Boolean).map(t => t.toLowerCase());
        return tokens.includes('curl') || tokens.includes('wget') || tokens.includes('invoke-webrequest') || tokens.includes('iwr');
    }) }, ({ innerCmdStr }) => {
        const stripped = getUnquoted(innerCmdStr);
        const tokens = stripped.split(/[\s;|{>&<]+/).filter(Boolean).map(t => t.toLowerCase());
        const cmdStr = tokens.find(t => ['curl', 'wget', 'invoke-webrequest', 'iwr'].includes(t)) || 'wget';
        const nativeExe = cmdStr === 'wget' ? 'wget.exe' : 'curl.exe';
        console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdStr}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
        const stripped = getUnquoted(s);
        const tokens = stripped.split(/[\s;|{>&<]+/).filter(Boolean).map(t => t.toLowerCase());
        return tokens.includes('cat') || tokens.includes('cat.exe');
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: 'cat' may fail in PowerShell without GNU tools or proper aliases.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically rewriting 'cat' to 'Get-Content' in PowerShell inline command.\x1b[0m`);
      const inlineIdx = ctx.args.findIndex(a => inlineFlags.includes(a.toLowerCase()));
      if (inlineIdx !== -1 && ctx.args[inlineIdx + 1]) {
        ctx.args[inlineIdx + 1] = ctx.args[inlineIdx + 1].replace(/\bcat\b/g, 'Get-Content');
      }
    })
    .with({ isCommand: true, originalCmd: P.union(...shells), hasInlineCmd: true }, ({ originalCmd: _shellCmd, inlineFlag: flag }: { innerCmdStr: string; originalCmd: string; inlineFlag: string }) => {
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command (${cmdBasename} ${flag}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })

    // Interactive blocks
    .with({ cmd: P.union('su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('ssh-keygen', 'ssh-keygen.exe') }, () => {
      if (!args.includes('-f') || !args.includes('-N')) {
        console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('runas', 'runas.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('sudo', 'sudo.exe'), isWin32: true }, () => {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })

    // Indefinite Hang Blocks
    .with({ cmd: P.union('watch', 'watch.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('tail', 'tail.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
        console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow')) {
        console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })

    // Native tool enforcement
    .with({ isCommand: true, hasStdin: false, cmd: P.union('cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'), positionalArgs: P.when(pa => pa.length === 0) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('xargs', 'xargs.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      const isSafe = match(cmd)
        .with(P.union('jq', 'jq.exe', 'yq', 'yq.exe'), () => args.includes('-n') || args.includes('--null-input') || args.includes('--help'))
        .with(P.union('sed', 'sed.exe'), () => args.includes('-h') || args.includes('--help'))
        .with(P.union('awk', 'gawk'), () => args.includes('-V') || args.includes('--version') || args.includes('-W') || args.includes('--help'))
        .otherwise(() => false);
      
      if (!isSafe) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      if (!args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })
    // Web request tool enforcement
    .with({ isCommand: true, cmd: P.union('curl', 'wget', 'invoke-webrequest', 'iwr') }, () => {
      const cmdStr = cmdBasename;
      const nativeExe = cmd === 'wget' ? 'wget.exe' : 'curl.exe';
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdStr}' natively. You MUST use the agent-native 'read_url_content' tool instead, or natively invoke '${nativeExe}' to bypass the alias.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })

    // Search tool enforcement (FS Alias Hallucinations)
    .with({ isCommand: true, cmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe', 'select-string', 'select-string.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdBasename}' natively. You MUST use the agent-native 'grep_search' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })

    // List dir tool enforcement (FS Alias Hallucinations)
    .with({ isCommand: true, cmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com') }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdBasename}' or its PowerShell cmdlet equivalent (Get-ChildItem) natively. You MUST use the agent-native 'list_dir' tool instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      process.exit(1);
    })

    // Inline Node/Python eval blocks
    .with({ isCommand: true, cmd: P.union('node', 'node.exe'), args: P.when(a => a.some(arg => ['-e', '--eval', '-p', '--print'].includes(arg) || arg.startsWith('-e=') || arg.startsWith('--eval=') || arg.startsWith('-p=') || arg.startsWith('--print='))) }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use inline 'node -e' in shell commands. PowerShell parsing will strip quotes and '--', breaking your script.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Please use the 'eval' JSON payload instead: {"type": "eval", "interpreter": "node", "code": "..."}`);
      process.exit(1);
    })
    .with({ isCommand: true, cmd: P.union('python', 'python.exe', 'python3', 'python3.exe'), args: P.when(a => a.some(arg => arg === '-c' || arg.startsWith('-c='))) }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use inline 'python -c' in shell commands. PowerShell parsing will strip quotes and '--', breaking your script.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Please use the 'eval' JSON payload instead: {"type": "eval", "interpreter": "python", "code": "..."}`);
      process.exit(1);
    })
    .otherwise(() => {});
}
