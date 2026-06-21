// @ts-nocheck
import { ExecutionContext } from './types.js';

export function systemInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const shellChars = ['|', '>', '<', '&&', '||', ';', '$(', '`'];
  const hasShellChars = args.some(a => shellChars.some(c => a.includes(c)));
  if (hasShellChars && payload.type === 'command') {
    console.error(`\n   💡 AGENT HINT: Shell operators (|, >, <, &&, ||, ;, $(, \`) detected in arguments.`);
    console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings.`);
    console.error(`   To use shell features, please use a 'script' payload type instead.`);
  }

  if (['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(cmdBasename) && payload.type === 'command') {
    const isInline = args.some(a => ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en'].includes(a.toLowerCase()));
    if (isInline) {
       const inlineIdx = args.findIndex(a => ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en'].includes(a.toLowerCase()));
       const isEncoded = ['-ec', '-encodedcommand', '-en'].includes(args[inlineIdx].toLowerCase());
       if (isEncoded) {
           console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.`);
           process.exit(1);
       }
       const innerCmdStr = args[inlineIdx + 1];
       if (innerCmdStr) {
           const stdToolsRegex = /(?:^|;|&&|\|\||\||\{|&)\s*(?:'|")?(git|docker|docker-compose|gh|npm|pnpm|yarn|bun|cargo|aws|gcloud|az|terraform|tofu|kubectl)(?:'|")?\b/i;
           const match = stdToolsRegex.exec(innerCmdStr);
           if (match) {
               const innerCmdBasename = match[1].toLowerCase();
               console.error(`\n   💡 AGENT HINT: You wrapped '${innerCmdBasename}' inside an inline shell (${cmdBasename} ${args[inlineIdx]}).`);
               console.error(`   This bypasses the agent-exec robustness interceptors for ${innerCmdBasename} and risks hanging the process.`);
               console.error(`   Please run ${innerCmdBasename} directly in the payload: {"type": "command", "command": "${innerCmdBasename}", "args": [...]}`);
               console.error(`   If you need shell pipes/redirects with this tool, write a script file to the scratch directory and use a 'script' payload.`);
               process.exit(1);
           }
       }
    }
  }

  if (['su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.`);
      process.exit(1);
  }

  if (cmdBasename === 'ssh-keygen' || cmdBasename === 'ssh-keygen.exe') {
    if (!args.includes('-f') || !args.includes('-N')) {
      console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.`);
      console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
      process.exit(1);
    }
  }

  if (['ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe'].includes(cmdBasename)) {
    if (!args.some(a => a.includes('BatchMode=yes'))) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.`);
      args.unshift('-o', 'BatchMode=yes');
    }
    if (!args.some(a => a.includes('StrictHostKeyChecking='))) {
      args.unshift('-o', 'StrictHostKeyChecking=accept-new');
    }
  }

  if (cmdBasename === 'watch' || cmdBasename === 'watch.exe') {
    console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.`);
    process.exit(1);
  }

  if (cmdBasename === 'tail' || cmdBasename === 'tail.exe') {
    if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
      console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.`);
      process.exit(1);
    }
  }

  if (['journalctl', 'journalctl.exe'].includes(cmdBasename) && (args.includes('-f') || args.includes('--follow'))) {
      console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.`);
      process.exit(1);
  }

  if (cmdBasename === 'ping' || cmdBasename === 'ping.exe') {
    if (process.platform === 'win32' || cmdBasename === 'ping.exe') {
      if (args.includes('-t')) {
        console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.`);
        for (let i = args.length - 1; i >= 0; i--) {
          if (args[i] === '-t') args.splice(i, 1);
        }
      }
    } else {
      if (!args.includes('-c')) {
        console.error(`\n   💡 AGENT HINT: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.`);
        args.unshift('-c', '4');
      }
    }
  }

  if (['runas', 'runas.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.`);
      process.exit(1);
  }

  if (cmdBasename === 'sudo' || cmdBasename === 'sudo.exe') {
    if (process.platform === 'win32') {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.`);
      process.exit(1);
    }
    if (!args.includes('-n') && !args.includes('--non-interactive')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.`);
      args.unshift('-n');
    }
  }

  const positionalArgs = args.filter(a => !a.startsWith('-'));

  if (!payload.stdin && payload.type === 'command') {
    const filters0 = ['cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'];
    if (filters0.includes(cmdBasename) && positionalArgs.length === 0) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.`);
      process.exit(1);
    }

    if (['xargs', 'xargs.exe'].includes(cmdBasename)) {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.`);
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
        console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments and no stdin. It will hang indefinitely.`);
        process.exit(1);
      }
    }

    const grepCmds = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe'];
    if (grepCmds.includes(cmdBasename) && positionalArgs.length <= 1 && !args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' called without file arguments, no recursive flag, and no stdin. It will hang indefinitely.`);
      process.exit(1);
    }
  }
}
