// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';

export function systemInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en'];
  const stdTools = ['git', 'docker', 'docker-compose', 'gh', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'aws', 'gcloud', 'az', 'terraform', 'tofu', 'kubectl', 'tail', 'watch', 'pm2', 'python', 'python3', 'node', 'journalctl', 'vi', 'vim', 'nvim', 'nano', 'top', 'htop', 'less', 'more', 'tmux', 'screen'];

  const isCommand = payload.type === 'command';
  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();

  // 1. Mutating intercepts (safe to run before block checks)
  match({ cmd, args })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args }) => {
      if (!args.some(a => a.includes('BatchMode=yes'))) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        args.unshift('-o', 'BatchMode=yes');
      }
      if (!args.some(a => a.includes('StrictHostKeyChecking='))) {
        args.unshift('-o', 'StrictHostKeyChecking=accept-new');
      }
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args }) => {
      if (process.platform === 'win32' || cmd === 'ping.exe') {
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
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args }) => {
      if (process.platform !== 'win32' && !args.includes('-n') && !args.includes('--non-interactive')) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        args.unshift('-n');
      }
    })
    .otherwise(() => {});

  // 2. Unsafe Pipes Detection
  if (isCommand && !patternTools.includes(cmd)) {
    const hasUnsafe = args.some(arg => {
      return match(arg)
        .with(P.string.includes('$('), () => true)
        .with(P.string.includes('`'), () => true)
        .with(P.when(a => a.includes('\\&') || a.includes('\\|') || a.includes('\\>') || a.includes('\\<') || a.includes('\\;')), () => true)
        .with(P.when((a: string) => {
            if (exactShellChars.includes(a.trim())) return true;
            
            type ParseState = { inSingle: boolean; inDouble: boolean; unquoted: string };
            const initialState: ParseState = { inSingle: false, inDouble: false, unquoted: '' };
            
            const finalState = a.split('').reduce((state: ParseState, char: string) => {
                return match([state, char] as const)
                    .with([{ inDouble: false }, "'"], ([s]) => ({ ...s, inSingle: !s.inSingle }))
                    .with([{ inSingle: false }, '"'], ([s]) => ({ ...s, inDouble: !s.inDouble }))
                    .with([{ inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, unquoted: s.unquoted + c }))
                    .with([{ inSingle: true }, P.string], ([s]) => s)
                    .with([{ inDouble: true }, P.string], ([s]) => s)
                    .exhaustive();
            }, initialState);
            
            return exactShellChars.some(op => {
                if (!finalState.unquoted.includes(op)) return false;
                const parts = finalState.unquoted.split(op);
                
                return match(parts)
                    .with(P.when(p => p.length < 2), () => false)
                    .with(P.when(p => p.every(part => !part.includes(' '))), () => true)
                    .otherwise(() => false);
            });
        }), () => true)
        .otherwise(() => false);
    });
    if (hasUnsafe) {
      console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
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
  match({ cmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, hasStdin, isWin32: process.platform === 'win32' })
    // Shell inline rules
    .with({ isCommand: true, cmd: P.union(...shells), hasInlineCmd: true, inlineFlag: P.union('-ec', '-encodedcommand', '-en') }, () => {
      console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ isCommand: true, cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: true, innerCmdStr: P.when((s: string) => s.includes('&&') || s.includes('||')) }, () => {
      console.error(`\n   💡 AGENT HINT: In PowerShell, avoid using '&&' and '||'. Prefer ';' for command separation.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ isCommand: true, cmd: P.union(...shells), hasInlineCmd: true }, ({ innerCmdStr, cmd: _shellCmd, inlineFlag: flag }: { innerCmdStr: string; cmd: string; inlineFlag: string }) => {
      const strippedCmdStr = innerCmdStr.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
      const tokens = strippedCmdStr.split(/[\s;|{>&<]+/).filter(Boolean).map((t: string) => t.toLowerCase());
      
      // Native tool enforcement rule
      const blockedAliases = ['cat', 'get-content', 'ls', 'dir', 'get-childitem', 'grep', 'select-string', 'sed'];
      const usedAlias = tokens.find((t: string) => blockedAliases.includes(t));
      if (usedAlias) {
        console.error(`\n   💡 AGENT HINT: Do NOT use '${usedAlias}' in shell commands. You MUST use the provided native tools (view_file, list_dir, grep_search, replace_file_content) instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }

      // stdTools rule
      const usedTool = tokens.find((t: string) => stdTools.includes(t));
      if (usedTool) {
        console.error(`\n   💡 AGENT HINT: You wrapped '${usedTool}' inside an inline shell (${cmdBasename} ${flag}).\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        console.error(`   This bypasses the agent-exec robustness interceptors for ${usedTool} and risks hanging the process.`);
        console.error(`   Please run ${usedTool} directly in the payload: {"type": "command", "command": "${usedTool}", "args": [...]}`);
        console.error(`   If you need shell pipes/redirects with this tool, write a script file to the scratch directory and use a 'script' payload.`);
        process.exit(1);
      }
    })

    // Interactive blocks
    .with({ cmd: P.union('su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ cmd: P.union('ssh-keygen', 'ssh-keygen.exe') }, () => {
      if (!args.includes('-f') || !args.includes('-N')) {
        console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('runas', 'runas.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ cmd: P.union('sudo', 'sudo.exe'), isWin32: true }, () => {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })

    // Indefinite Hang Blocks
    .with({ cmd: P.union('watch', 'watch.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ cmd: P.union('tail', 'tail.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
        console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow')) {
        console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    })

    // Native tool enforcement
    .with({ isCommand: true, cmd: P.union('cat', 'cat.exe', 'get-content', 'ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'grep', 'grep.exe', 'select-string', 'sed', 'sed.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: Do NOT use '${cmdBasename}' directly. You MUST use the provided native tools (view_file, list_dir, grep_search, replace_file_content) instead.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })

    // Missing stdin hang blocks
    .with({ isCommand: true, hasStdin: false, cmd: P.union('cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'), positionalArgs: P.when(pa => pa.length === 0) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('xargs', 'xargs.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      const isSafe = match(cmd)
        .with(P.union('jq', 'jq.exe', 'yq', 'yq.exe'), () => args.includes('-n') || args.includes('--null-input') || args.includes('--help'))
        .with(P.union('sed', 'sed.exe'), () => args.includes('-h') || args.includes('--help'))
        .with(P.union('awk', 'gawk'), () => args.includes('-V') || args.includes('--version') || args.includes('-W') || args.includes('--help'))
        .otherwise(() => false);
      
      if (!isSafe) {
        console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      if (!args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
        console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: If you encounter this hint during an autonomous task, you MUST notify the user IMMEDIATELY. Do not just add it to your task list. Stop and inform the user of the needed self-improvement so they can address it.\x1b[0m (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md))`);
        process.exit(1);
      }
    })
    .otherwise(() => {});
}
