// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';

export function systemInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  
  const containsUnsafePipes = args.some(arg => {
    const stripped = arg.replace(/['"]/g, '');
    return match(stripped)
      .with(P.when(a => exactShellChars.includes(a.trim())), () => true)
      .with(P.string.includes('$('), () => true)
      .with(P.string.includes('`'), () => true)
      .with(P.when(a => a.includes('\\&') || a.includes('\\|') || a.includes('\\>') || a.includes('\\<') || a.includes('\\;')), () => true)
      .with(P.when(a => exactShellChars.some(op => {
          const parts = a.split(op);
          if (parts.length !== 2) return false;
          const isWord = (s: string) => /^[a-zA-Z0-9_-]+$/.test(s);
          return isWord(parts[0]) && isWord(parts[1]);
      })), () => true)
      .otherwise(() => false);
  });

  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe'];
  
  if (containsUnsafePipes && payload.type === 'command' && !patternTools.includes(cmdBasename)) {
    console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings and will fail.`);
    console.error(`   To use shell features, please use a 'script' payload type or pipe natively in PowerShell.`);
    process.exit(1);
  }

  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'];
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en'];

  if (shells.includes(cmdBasename) && payload.type === 'command') {
    const inlineIdx = args.findIndex(a => inlineFlags.includes(a.toLowerCase()));
    
    if (inlineIdx !== -1) {
      const inlineFlag = args[inlineIdx].toLowerCase();
      const innerCmdStr = args[inlineIdx + 1] || '';
      const strippedCmdStr = innerCmdStr.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
      const tokens = strippedCmdStr.split(/[\s;|{>&<]+/).filter(Boolean).map(t => t.toLowerCase());
      
      const stdTools = ['git', 'docker', 'docker-compose', 'gh', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'aws', 'gcloud', 'az', 'terraform', 'tofu', 'kubectl', 'tail', 'watch', 'pm2', 'python', 'python3', 'node', 'journalctl', 'vi', 'vim', 'nvim', 'nano', 'top', 'htop', 'less', 'more', 'tmux', 'screen'];
      const usedTool = tokens.find(t => stdTools.includes(t));

      match({ shell: cmdBasename.toLowerCase(), flag: inlineFlag, tokens, usedTool })
        .with({ flag: P.union('-ec', '-encodedcommand', '-en') }, () => {
           console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           process.exit(1);
        })
        .with({ shell: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), tokens: P.when(ts => {
           const catIdx = ts.indexOf('cat');
           if (catIdx !== -1) {
              const afterCat = ts.slice(catIdx + 1).filter(t => !t.startsWith('-'));
              return afterCat.length >= 2;
           }
           return false;
        }) }, () => {
           console.error(`\n   💡 AGENT HINT: In PowerShell, 'cat' is an alias for Get-Content. You CANNOT use space-separated arguments for multiple files like 'cat file1 file2'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           console.error(`   Please use comma-separated arrays instead: 'Get-Content file1, file2'.`);
           process.exit(1);
        })
        .with({ usedTool: P.not(P.nullish) }, ({ usedTool }) => {
           console.error(`\n   💡 AGENT HINT: You wrapped '${usedTool}' inside an inline shell (${cmdBasename} ${args[inlineIdx]}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
           console.error(`   This bypasses the agent-exec robustness interceptors for ${usedTool} and risks hanging the process.`);
           console.error(`   Please run ${usedTool} directly in the payload: {"type": "command", "command": "${usedTool}", "args": [...]}`);
           console.error(`   If you need shell pipes/redirects with this tool, write a script file to the scratch directory and use a 'script' payload.`);
           process.exit(1);
        })
        .otherwise(() => {});
    }
  }

  if (['su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (cmdBasename === 'ssh-keygen' || cmdBasename === 'ssh-keygen.exe') {
    if (!args.includes('-f') || !args.includes('-N')) {
      console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
      process.exit(1);
    }
  }

  if (['ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe'].includes(cmdBasename)) {
    if (!args.some(a => a.includes('BatchMode=yes'))) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      args.unshift('-o', 'BatchMode=yes');
    }
    if (!args.some(a => a.includes('StrictHostKeyChecking='))) {
      args.unshift('-o', 'StrictHostKeyChecking=accept-new');
    }
  }

  if (cmdBasename === 'watch' || cmdBasename === 'watch.exe') {
    console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
    process.exit(1);
  }

  if (cmdBasename === 'tail' || cmdBasename === 'tail.exe') {
    if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
      console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }

  if (['journalctl', 'journalctl.exe'].includes(cmdBasename) && (args.includes('-f') || args.includes('--follow'))) {
      console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (cmdBasename === 'ping' || cmdBasename === 'ping.exe') {
    if (process.platform === 'win32' || cmdBasename === 'ping.exe') {
      if (args.includes('-t')) {
        console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        for (let i = args.length - 1; i >= 0; i--) {
          if (args[i] === '-t') args.splice(i, 1);
        }
      }
    } else {
      if (!args.includes('-c')) {
        console.error(`\n   💡 AGENT HINT: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        args.unshift('-c', '4');
      }
    }
  }

  if (['runas', 'runas.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
  }

  if (cmdBasename === 'sudo' || cmdBasename === 'sudo.exe') {
    if (process.platform === 'win32') {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
    if (!args.includes('-n') && !args.includes('--non-interactive')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      args.unshift('-n');
    }
  }

  const positionalArgs = args.filter(a => !a.startsWith('-'));

  if (!payload.stdin && payload.type === 'command') {
    const filters0 = ['cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'];
    if (filters0.includes(cmdBasename) && positionalArgs.length === 0) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }

    if (['xargs', 'xargs.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }

    const filters1 = ['awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'];
    if (filters1.includes(cmdBasename) && positionalArgs.length <= 1) {
      if (['jq', 'jq.exe', 'yq', 'yq.exe'].includes(cmdBasename) && (args.includes('-n') || args.includes('--null-input') || args.includes('--help'))) {
        // -n means null input, doesn't hang.
      } else if (['sed', 'sed.exe'].includes(cmdBasename) && (args.includes('-h') || args.includes('--help'))) {
        // help doesn't hang
      } else if (['awk', 'gawk'].includes(cmdBasename) && (args.includes('-V') || args.includes('--version') || args.includes('-W') || args.includes('--help'))) {
        // help doesn't hang
      } else {
        console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    }

    const grepCmds = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'];
    if (grepCmds.includes(cmdBasename) && positionalArgs.length <= 1 && !args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    }
  }
}
