// @ts-nocheck
import { ExecutionContext } from './types.js';

export function replTuiInterceptor({ cmdBasename, args, envOverrides, payload }: ExecutionContext): void {
  const replCommands = [
    'node', 'node.exe', 'node.cmd', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe',
    'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'wsl', 'wsl.exe', 'adb', 'adb.exe',
    'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'bun', 'bun.exe', 'bun.cmd',
    'ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd',
    'ts-node', 'tsx', 'deno', 'irb', 'iex', 'php', 'lua', 'irssi', 'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
    'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe', 'pry', 'tinker', 'scala', 'clojure', 'sbcl', 'ghci', 'erl', 'hugs', 'kdb', 'q', 'r', 'R',
    'ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe', 'openssl', 'openssl.exe'
  ];

  const tuiCommands = ['less', 'more', 'vi', 'vim', 'nvim', 'nano', 'emacs', 'top', 'htop', 'tmux', 'screen', 'lazygit', 'lazydocker', 'k9s', 'ncdu', 'fzf', 'mut', 'mc', 'micro', 'w3m', 'lynx', 'links', 'btop', 'nmon', 'glances', 'vimdiff', 'joe', 'bat', 'glow', 'tig', 'nmtui', 'minikube', 'k3d', 'alsamixer', 'cfdisk', 'cgdisk', 'parted'];

  if (replCommands.includes(cmdBasename) && payload.type === 'command' && !payload.stdin) {
    const explicitlyInteractive = args.includes('-i') || args.includes('--interactive') || (cmdBasename === 'php' && args.includes('-a'));
    const isNodeDebug = ['node', 'node.exe', 'node.cmd'].includes(cmdBasename) && args.some(a => a === 'inspect' || a.startsWith('--inspect'));
    const isDbRepl = ['mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe', 'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe'].includes(cmdBasename) && !args.some(a => ['-c', '--command', '-e', '--execute', '--eval'].includes(a));
    const isNakedShell = ['ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe'].includes(cmdBasename) && args.filter(a => !a.startsWith('-') && !a.includes('@')).length === 0;

    if (args.length === 0 || explicitlyInteractive || isNodeDebug || isDbRepl || isNakedShell) {
      const reason = isDbRepl ? `as a DB client without execution flags` : (isNakedShell ? `as a naked shell/connection without commands` : (isNodeDebug ? `with a debugging flag` : (explicitlyInteractive ? `with an interactive flag` : `without arguments or stdin`)));
      console.error(`\n   💡 AGENT HINT: You attempted to start an interactive REPL (${cmdBasename} ${reason}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
      console.error(`   If you meant to execute code, use the 'eval' payload type, provide a script, or pass 'stdin'.`);
      process.exit(1);
    }
    
    if (['python', 'python.exe', 'python.cmd', 'python3', 'python3.exe'].includes(cmdBasename)) {
      const isPythonInteractive = args.includes('-i') || args.some((a, i) => a === '-m' && args[i + 1] === 'pdb');
      if (isPythonInteractive) {
        console.error(`\n   💡 AGENT HINT: You attempted to start Python in interactive mode or with a debugger (-i or -m pdb).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
        process.exit(1);
      }
    }
  }

  if (tuiCommands.includes(cmdBasename) && payload.type === 'command') {
    console.error(`\n   💡 AGENT HINT: You attempted to start an interactive TUI application (${cmdBasename}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please use standard terminal commands (e.g. cat, grep, list_dir, view_file) instead.`);
    process.exit(1);
  }

  if (['node', 'node.exe', 'node.cmd', 'bun', 'bun.exe', 'bun.cmd', 'npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe', 'bunx', 'bunx.cmd', 'bunx.exe', 'yarn', 'yarn.cmd', 'yarn.exe'].includes(cmdBasename) && payload.type === 'command') {
    if (args.includes('--watch')) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename} --watch' runs indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang until timeout.`);
      console.error(`   Please use standard execution without watch mode.`);
      process.exit(1);
    }
    const watchTools = ['nodemon', 'ts-node-dev'];
    const usedWatchTool = args.find(a => watchTools.includes(a));
    if (usedWatchTool) {
      console.error(`\n   💡 AGENT HINT: '${usedWatchTool}' runs indefinitely in watch mode. Blocking execution to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (['tsx', 'tsx.cmd', 'tsx.exe'].includes(cmdBasename) && args.includes('watch')) {
     console.error(`\n   💡 AGENT HINT: 'tsx watch' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
     process.exit(1);
  }

  if (['nodemon', 'nodemon.cmd', 'nodemon.exe', 'ts-node-dev', 'ts-node-dev.cmd', 'ts-node-dev.exe'].includes(cmdBasename)) {
     console.error(`\n   💡 AGENT HINT: '${cmdBasename}' runs indefinitely in watch mode. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
     process.exit(1);
  }

  if (['pm2', 'pm2.cmd', 'pm2.exe'].includes(cmdBasename)) {
     if (args.includes('logs') || args.includes('monit') || args.includes('dash')) {
         console.error(`\n   💡 AGENT HINT: 'pm2 ${args.find(a => ['logs', 'monit', 'dash'].includes(a))}' is interactive/runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
         process.exit(1);
     }
  }

  if (['bun', 'bun.exe', 'bun.cmd'].includes(cmdBasename)) {
    if (args.includes('repl')) {
      console.error(`\n   💡 AGENT HINT: 'bun repl' is interactive and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (['cmd', 'cmd.exe'].includes(cmdBasename)) {
    if (args.some(a => a.toLowerCase() === 'pause')) {
      console.error(`\n   💡 AGENT HINT: 'pause' in cmd.exe waits for a keypress and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (['tail', 'tail.exe'].includes(cmdBasename) && (args.includes('-f') || args.includes('--follow'))) {
    console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    process.exit(1);
  }

  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmdBasename)) {
    envOverrides['POWERSHELL_TELEMETRY_OPTOUT'] = '1';
    envOverrides['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1';
    
    if (args.some(a => a.toLowerCase() === '-noexit')) {
      console.error(`\n   💡 AGENT HINT: 'pwsh -NoExit' prevents the shell from exiting and will hang indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }

    const uiCmdlets = ['Get-Credential', 'Show-Command', 'Out-GridView', 'Read-Host', 'PromptForChoice'];
    if (args.some(a => uiCmdlets.some(c => a.includes(c)))) {
      console.error(`\n   💡 AGENT HINT: PowerShell UI cmdlets like Get-Credential or Out-GridView will hang headlessly. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (payload.type === 'command' && ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(cmdBasename)) {
    const cIndex = args.findIndex(a => a.toLowerCase() === '-c' || a.toLowerCase() === '-command');
    if (cIndex !== -1 && cIndex + 1 < args.length) {
      console.error(`\n   💡 AGENT HINT: Intercepted inline PowerShell command. Converting to Base64 -EncodedCommand to prevent quote parsing failures.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
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
      console.error(`\n   💡 AGENT HINT: Automatically injected [${newArgs.join(', ')}] into ${cmdBasename} command to prevent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    }
  }
}
