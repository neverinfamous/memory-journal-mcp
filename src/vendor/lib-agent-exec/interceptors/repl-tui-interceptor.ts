// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';
export function replTuiInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  console.error("DEBUG EXECUTION:", JSON.stringify({cmdBasename, args, type: payload.type, command: 'command' in payload ? payload.command : undefined, code: 'code' in payload ? payload.code : undefined, scriptPath: 'scriptPath' in payload ? payload.scriptPath : undefined}));
  const replCommands = [
    'node', 'node.exe', 'node.cmd', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe',
    'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'wsl', 'wsl.exe', 'adb', 'adb.exe',
    'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'bun', 'bun.exe', 'bun.cmd',
    'ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd',
    'ts-node', 'tsx', 'deno', 'irb', 'iex', 'php', 'lua', 'irssi', 'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
    'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe', 'pry', 'tinker', 'scala', 'clojure', 'sbcl', 'ghci', 'erl', 'hugs', 'kdb', 'q', 'r', 'R',
    'ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe', 'openssl', 'openssl.exe'
  ];

  const baseTui = ['less', 'more', 'vi', 'vim', 'nvim', 'nano', 'emacs', 'top', 'htop', 'tmux', 'screen', 'lazygit', 'lazydocker', 'k9s', 'ncdu', 'fzf', 'mut', 'mc', 'micro', 'w3m', 'lynx', 'links', 'btop', 'nmon', 'glances', 'vimdiff', 'joe', 'bat', 'glow', 'tig', 'nmtui', 'minikube', 'k3d', 'alsamixer', 'cfdisk', 'cgdisk', 'parted', 'watch', 'journalctl'];
  const tuiCommands = [...baseTui, ...baseTui.map(c => `${c}.exe`)];

  match({ cmdBasename, type: payload.type, hasStdin: !!payload.stdin, args })
    .with({ type: 'command', hasStdin: false, cmdBasename: P.when(c => replCommands.includes(c as string)) }, ({ cmdBasename, args }) => {
      const explicitlyInteractive = args.includes('-i') || args.includes('--interactive') || (cmdBasename === 'php' && args.includes('-a'));
      const isNodeDebug = ['node', 'node.exe', 'node.cmd'].includes(cmdBasename) && args.some(a => a === 'inspect' || a.startsWith('--inspect'));
      const isDbRepl = ['mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe', 'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe'].includes(cmdBasename) && !args.some(a => ['-c', '--command', '-e', '--execute', '--eval'].includes(a));
      const isNakedShell = ['ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe'].includes(cmdBasename) && args.filter(a => !a.startsWith('-') && !a.includes('@')).length === 0;

      if (args.length === 0 || explicitlyInteractive || isNodeDebug || isDbRepl || isNakedShell) {
        const reason = isDbRepl ? `as a DB client without execution flags` : (isNakedShell ? `as a naked shell/connection without commands` : (isNodeDebug ? `with a debugging flag` : (explicitlyInteractive ? `with an interactive flag` : `without arguments or stdin`)));
        console.error(`\n   💡 AGENT HINT: You attempted to start an interactive REPL (${cmdBasename} ${reason}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
        console.error(`   If you meant to execute code, use the 'eval' payload type, provide a script, or pass 'stdin'.`);
        process.exit(1);
      }
      
      if (['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(cmdBasename)) {
        const isPythonInteractive = args.includes('-i') || args.some((a, i) => a === '-m' && args[i + 1] === 'pdb');
        if (isPythonInteractive) {
          console.error(`\n   💡 AGENT HINT: You attempted to start Python in interactive mode or with a debugger (-i or -m pdb).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
          console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
          process.exit(1);
        }
      }
    })
    .with({ type: 'command', cmdBasename: P.when(c => tuiCommands.includes(c as string)) }, () => {
      console.error(`\n   💡 AGENT HINT: You attempted to start an interactive TUI application (${cmdBasename}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
      console.error(`   Please use standard terminal commands (e.g. cat, grep, list_dir, view_file) instead.`);
      process.exit(1);
    })
    .with({ type: 'command', cmdBasename: P.union('node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe', 'bunx', 'bunx.cmd', 'bunx.exe', 'yarn', 'yarn.cmd', 'yarn.exe') }, ({ args }) => {
      if (args.includes('--watch')) {
        console.error(`\n   💡 AGENT HINT: '${cmdBasename} --watch' runs indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang until timeout.`);
        console.error(`   Please use standard execution without watch mode.`);
        process.exit(1);
      }
      const watchTools = ['nodemon', 'ts-node-dev'];
      const usedWatchTool = args.find(a => watchTools.includes(a));
      if (usedWatchTool) {
        console.error(`\n   💡 AGENT HINT: '${usedWatchTool}' runs indefinitely in watch mode. Blocking execution to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmdBasename: P.union('tsx', 'tsx.cmd', 'tsx.exe'), args: P.when(a => a.includes('watch')) }, () => {
       console.error(`\n   💡 AGENT HINT: 'tsx watch' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ cmdBasename: P.union('nodemon', 'nodemon.cmd', 'nodemon.exe', 'ts-node-dev', 'ts-node-dev.cmd', 'ts-node-dev.exe') }, () => {
       console.error(`\n   💡 AGENT HINT: '${cmdBasename}' runs indefinitely in watch mode. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ cmdBasename: P.union('pm2', 'pm2.cmd', 'pm2.exe') }, ({ args }) => {
       if (args.includes('logs') || args.includes('monit') || args.includes('dash')) {
           console.error(`\n   💡 AGENT HINT: 'pm2 ${args.find(a => ['logs', 'monit', 'dash'].includes(a))}' is interactive/runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
           process.exit(1);
       }
    })
    .with({ cmdBasename: P.union('bun', 'bun.exe', 'bun.cmd'), args: P.when(a => a.includes('repl')) }, () => {
       console.error(`\n   💡 AGENT HINT: 'bun repl' is interactive and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ cmdBasename: P.union('cmd', 'cmd.exe'), args: P.when(a => a.some(arg => arg.toLowerCase() === 'pause')) }, () => {
       console.error(`\n   💡 AGENT HINT: 'pause' in cmd.exe waits for a keypress and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ cmdBasename: P.union('tail', 'tail.exe'), args: P.when(a => a.includes('-f') || a.includes('--follow')) }, () => {
       console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ cmdBasename: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args }) => {
      envOverrides['POWERSHELL_TELEMETRY_OPTOUT'] = '1';
      envOverrides['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1';
      
      if (args.some(a => a.toLowerCase() === '-noexit')) {
        console.error(`\n   💡 AGENT HINT: 'pwsh -NoExit' prevents the shell from exiting and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
  
      const uiCmdlets = ['Get-Credential', 'Show-Command', 'Out-GridView', 'Read-Host', 'PromptForChoice'];
      if (args.some(a => uiCmdlets.some(c => a.includes(c)))) {
        console.error(`\n   💡 AGENT HINT: PowerShell UI cmdlets like Get-Credential or Out-GridView will hang headlessly. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
        process.exit(1);
      }
    })
    .otherwise(() => {});

  const tuiRegex = new RegExp(`(?:^|\\s|;|&&|\\|\\||\\||\\{|&|\\n|['"])(${[...tuiCommands, 'watch', 'watch.exe', 'journalctl', 'journalctl.exe'].join('|')})\\b`, 'i');
  const replRegex = new RegExp(`(?:^|\\s|;|&&|\\|\\||\\||\\{|&|\\n|['"])(${replCommands.join('|')})(?=\\s*['"]?\\s*(?:$|;|&&|\\|\\||\\||&|\\n))`, 'i');
  const interactiveFlagRegex = new RegExp(`(?:^|\\s|;|&&|\\|\\||\\||\\{|&|\\n|['"])(${replCommands.join('|')})\\s+(?:[^;\\n|&]*\\s)?(?:-(?!-)[a-zA-Z0-9]{0,3}i[a-zA-Z0-9]{0,3}\\b|--interactive\\b|inspect\\b|--inspect\\b|-m\\s+pdb\\b)`, 'i');
  const tailFRegex = /tail(?:\\.exe)?.*(?:-f|--follow)/i;
  const nodeWatchRegex = /(?:node|bun|npx|pnpx|bunx|yarn)(?:\\.exe|\\.cmd)?.*--watch/i;
  const watchToolRegex = /(?:nodemon|ts-node-dev)(?:\\.exe|\\.cmd)?/i;
  const tsxWatchRegex = /tsx(?:\\.exe|\\.cmd)?\\s+watch/i;
  const pm2InteractiveRegex = /pm2(?:\\.exe|\\.cmd)?\\s+(?:logs|monit|dash)/i;
  const bunReplRegex = /bun(?:\\.exe|\\.cmd)?\\s+repl/i;
  const cmdPauseRegex = /pause\\b/i;
  const pwshNoExitRegex = /pwsh(?:\\.exe)?\\s+.*-noexit/i;
  const pwshUiRegex = /(?:Get-Credential|Show-Command|Out-GridView|Read-Host|PromptForChoice)/i;

  const extractScriptBody = (type: string, cmd: string, cmdArgs: string[], code?: string): string | null => {
    return match({ type, cmd: cmd.toLowerCase(), cmdArgs, code })
      .with({ type: 'eval', code: P.string }, (p) => p.code)
      .with({ type: 'command', cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, (p) => {
        const idx = p.cmdArgs.findIndex(a => a.toLowerCase() === '-c' || a.toLowerCase() === '-command');
        if (idx !== -1 && idx + 1 < p.cmdArgs.length) {
            return p.cmdArgs.slice(idx + 1).join(' ').replace(/^['"]|['"]$/g, '').trim();
        }
        return null;
      })
      .with({ type: 'command', cmd: P.union('sh', 'sh.exe', 'bash', 'bash.exe') }, (p) => {
        const idx = p.cmdArgs.findIndex(a => a === '-c');
        if (idx !== -1 && idx + 1 < p.cmdArgs.length) return p.cmdArgs[idx + 1];
        return null;
      })
      .with({ type: 'command', cmd: P.union('cmd', 'cmd.exe') }, (p) => {
        const idx = p.cmdArgs.findIndex(a => a.toLowerCase() === '/c');
        if (idx !== -1 && idx + 1 < p.cmdArgs.length) return p.cmdArgs.slice(idx + 1).join(' ');
        return null;
      })
      .with({ type: 'command', cmd: P.union('wsl', 'wsl.exe') }, (p) => {
        const eIdx = p.cmdArgs.findIndex(a => a === '-e' || a === '--exec');
        if (eIdx !== -1 && eIdx + 1 < p.cmdArgs.length) {
            return p.cmdArgs.slice(eIdx + 1).join(' ');
        }
        return p.cmdArgs.filter(a => !a.startsWith('-')).join(' ');
      })
      .with({ type: 'command', cmd: P.union('docker', 'docker.exe', 'docker-compose', 'docker-compose.exe') }, (p) => {
        const runExecIdx = p.cmdArgs.findIndex(a => a === 'run' || a === 'exec');
        if (runExecIdx !== -1) {
            // Find first positional argument after run/exec that doesn't start with '-'
            // This is naive but works for the regex matcher since we just need the string
            const remaining = p.cmdArgs.slice(runExecIdx + 1).filter(a => !a.startsWith('-'));
            if (remaining.length > 0) {
                // Return everything after the first non-flag argument (which is usually the image or container)
                return remaining.slice(1).join(' ');
            }
        }
        return null;
      })
      .otherwise(() => null);
  };

  const extractedScriptBody = extractScriptBody(payload.type, cmdBasename, args, 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined);

  if (payload.type === 'command' && ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmdBasename)) {
    const cIndex = args.findIndex(a => a.toLowerCase() === '-c' || a.toLowerCase() === '-command');
    if (cIndex !== -1 && cIndex + 1 < args.length) {
      console.error(`\n   💡 AGENT HINT: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      const scriptArgs = args.slice(cIndex + 1);
      const safeArgs = scriptArgs.map(a => {
        if (!/[ \t]/.test(a)) return a;
        if (a.startsWith("'") && a.endsWith("'")) return a;
        if (a.startsWith('"') && a.endsWith('"')) return a;
        if (a.startsWith('$(') || a.startsWith('@(')) return a;
        return `'${a.replace(/'/g, "''")}'`;
      });
      const scriptBody = scriptArgs.length === 1 ? scriptArgs[0] : safeArgs.join(' ');
      
      const scriptContent = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;\n$OutputEncoding = [System.Text.Encoding]::UTF8;\n$ErrorActionPreference = 'Stop';\n$ProgressPreference = 'SilentlyContinue';\n$ConfirmPreference = 'None';\n` + scriptBody;
      const encoded = Buffer.from(scriptContent, 'utf16le').toString('base64');
      args.splice(cIndex, args.length - cIndex, '-EncodedCommand', encoded);
    }

    const hasNonInteractive = args.some(a => a.toLowerCase() === '-noninteractive');
    const hasNoProfile = args.some(a => a.toLowerCase() === '-noprofile');
    const hasExecutionPolicy = args.some(a => a.toLowerCase() === '-executionpolicy' || a.toLowerCase() === '-ep');
    
    const newArgs: string[] = [];
    if (!hasExecutionPolicy) newArgs.push('-ExecutionPolicy', 'Bypass');
    if (!hasNonInteractive) newArgs.push('-NonInteractive');
    if (!hasNoProfile) newArgs.push('-NoProfile');
    
    if (newArgs.length > 0) {
      args.unshift(...newArgs);
      console.error(`\n   💡 AGENT HINT: Automatically injected [${newArgs.join(', ')}] into ${cmdBasename} command to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
    }
  }

  match({ ...payload, scriptBody: extractedScriptBody })
    .with({ scriptBody: P.when(body => typeof body === 'string' && tuiRegex.test(body)) }, (p) => {
      const m = tuiRegex.exec(p.scriptBody as string);
      const innerCmdBasename = m ? m[1].toLowerCase() : 'tui-app';
      console.error(`\n   💡 AGENT HINT: You wrapped '${innerCmdBasename}' inside an inline script.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications inside inline scripts will hang indefinitely.`);
      console.error(`   Please run ${innerCmdBasename} directly in the payload or use standard terminal commands instead.`);
      process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && (replRegex.test(body) || interactiveFlagRegex.test(body))) }, (p) => {
      const m = replRegex.exec(p.scriptBody as string) || interactiveFlagRegex.exec(p.scriptBody as string);
      const innerCmdBasename = m ? m[1].toLowerCase() : 'repl-app';
      console.error(`\n   💡 AGENT HINT: You wrapped '${innerCmdBasename}' inside an inline script.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications inside inline scripts will hang indefinitely.`);
      console.error(`   Please run ${innerCmdBasename} directly in the payload or use standard terminal commands instead.`);
      process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && tailFRegex.test(body)) }, () => {
      console.error(`\n   💡 AGENT HINT: You wrapped 'tail' inside an inline script.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications inside inline scripts will hang indefinitely.`);
      console.error(`   Please run tail directly in the payload or use standard terminal commands instead.`);
      process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && tuiRegex.test(c)) }, (p) => {
       const m = tuiRegex.exec(p.code as string);
       const innerCmdBasename = m ? m[1].toLowerCase() : 'tui-app';
       console.error(`\n   💡 AGENT HINT: You passed '${innerCmdBasename}' inside an eval payload.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications natively will hang indefinitely.`);
       console.error(`   Please use standard terminal commands instead.`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && (replRegex.test(c) || interactiveFlagRegex.test(c))) }, (p) => {
       const m = replRegex.exec(p.code as string) || interactiveFlagRegex.exec(p.code as string);
       const innerCmdBasename = m ? m[1].toLowerCase() : 'repl-app';
       console.error(`\n   💡 AGENT HINT: You passed '${innerCmdBasename}' inside an eval payload.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications natively will hang indefinitely.`);
       console.error(`   Please use standard terminal commands instead.`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && tailFRegex.test(c)) }, () => {
       console.error(`\n   💡 AGENT HINT: You passed 'tail' inside an eval payload.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       console.error(`   Because 'agent-exec.ts' is non-interactive, running TUI/REPL applications natively will hang indefinitely.`);
       console.error(`   Please use standard terminal commands instead.`);
       process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && (nodeWatchRegex.test(body) || watchToolRegex.test(body) || tsxWatchRegex.test(body))) }, () => {
       console.error(`\n   💡 AGENT HINT: Node watch mode runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && (nodeWatchRegex.test(c) || watchToolRegex.test(c) || tsxWatchRegex.test(c))) }, () => {
       console.error(`\n   💡 AGENT HINT: Node watch mode runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && pm2InteractiveRegex.test(body)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'pm2' is interactive/runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && pm2InteractiveRegex.test(c)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'pm2' is interactive/runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && bunReplRegex.test(body)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'bun repl' is interactive and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && bunReplRegex.test(c)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'bun repl' is interactive and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && cmdPauseRegex.test(body)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'pause' in cmd waits for a keypress and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && cmdPauseRegex.test(c)) }, () => {
       console.error(`\n   💡 AGENT HINT: 'pause' in cmd waits for a keypress and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ scriptBody: P.when(body => typeof body === 'string' && (pwshNoExitRegex.test(body) || pwshUiRegex.test(body))) }, () => {
       console.error(`\n   💡 AGENT HINT: PowerShell -NoExit or UI cmdlets will hang headlessly. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .with({ type: 'eval', code: P.when(c => typeof c === 'string' && (pwshNoExitRegex.test(c) || pwshUiRegex.test(c))) }, () => {
       console.error(`\n   💡 AGENT HINT: PowerShell -NoExit or UI cmdlets will hang headlessly. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m`);
       process.exit(1);
    })
    .otherwise(() => {});
}
