// @ts-nocheck
import { match, P } from 'ts-pattern';
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { convertToWslPath, findPatternExprIndex } from '../command-utils.js';
import { getUnquoted } from './utils.js';
import { handleRipgrepInterception, parseGrepSearchArgs } from './search-interceptor.js';

export function runStructuralInterceptors(
  ctx: ExecutionContext,
  derived: { cmd: string; cmdBasename: string; originalCmd: string; args: string[]; isCommand: boolean; hasInlineCmd: boolean; inlineFlag: string; innerCmdStr: string; positionalArgs: string[]; hasStdin: boolean; shells: readonly string[] }
) {
  const { cmd, cmdBasename, originalCmd, args, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, hasStdin } = derived;
  const payload = ctx.payload;

  match({ cmd, originalCmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32', payload })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'), hasInlineCmd: true, inlineFlag: P.union('-ec', '-encodedcommand', '-en') }, () => {
      console.error(`\n   💡 AGENT HINT: Inline '-EncodedCommand' shell wrappers are blocked by agent-exec to prevent bypasses.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: false, args: P.when((a: string[]) => {
      return a.length > 0 && !a.some(arg => ['-file', '-help', '-version', '-?', '/?'].includes(arg.toLowerCase()));
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command implicitly via powershell.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'), hasInlineCmd: true, innerCmdStr: P.when((s: string) => {
        const stripped = getUnquoted(s);
        return stripped.includes('&&') || stripped.includes('||') || stripped.includes('|') || stripped.includes('>');
    }) }, () => {
      console.error(`\n   💡 AGENT HINT: In PowerShell, avoid using '&&', '||', '|', and '>'. You MUST use semicolons (;) for simple commands, or use a WSL2 JSON payload for POSIX pipelines.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, originalCmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'), hasInlineCmd: true }, () => {
      const flag = inlineFlag;
      if (payload.target === 'wsl2') return;

      const stripped = getUnquoted(innerCmdStr).toLowerCase();
      const tokens = stripped.split(/[\s;|{>&<]+/).filter(Boolean);
      
      const networkAliases = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
      const netCmdStr = tokens.find(t => networkAliases.includes(t));
      if (netCmdStr) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command in shell string detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        return;
      }

      const fsSearchAliases = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe'];
      const searchCmdStr = tokens.find(t => fsSearchAliases.includes(t));
      if (searchCmdStr) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Search command in shell string detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        return;
      }

      const fsViewAliases = ['cat', 'cat.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'wc', 'wc.exe', 'more'];
      const viewCmdStr = tokens.find(t => fsViewAliases.includes(t));
      const isMultiFilePwshCat = (viewCmdStr === 'cat' || viewCmdStr === 'cat.exe') &&
        ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(originalCmd.toLowerCase()) &&
        tokens.filter(t => t !== viewCmdStr && !t.startsWith('-')).length > 1;
      if (viewCmdStr && !isMultiFilePwshCat) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: File view command in shell string detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        return;
      }

      const fsFileOpAliases = ['rm', 'rm.exe', 'cp', 'cp.exe', 'mv', 'mv.exe', 'mkdir', 'touch', 'chmod', 'diff'];
      const fileOpCmdStr = tokens.find(t => fsFileOpAliases.includes(t));
      if (fileOpCmdStr) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: File operation command in shell string detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        return;
      }

      const fsListAliases = ['ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'];
      const listCmdStr = tokens.find(t => fsListAliases.includes(t));
      if (listCmdStr) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Directory list command in shell string detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        return;
      }

      const wrappedShell = (cmdBasename === 'wsl.exe' || cmdBasename === 'wsl') ? (args.find((a: string) => ['bash', 'sh', 'pwsh', 'powershell'].includes(a.toLowerCase())) || cmdBasename) : cmdBasename;
      console.error(`\n   💡 AGENT HINT: You attempted to run an inline shell command (${wrappedShell} ${flag}). This is an agent hallucination.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      console.error(`   This bypasses the agent-exec robustness interceptors and risks hanging the process.`);
      console.error(`   Please use the proper execution payloads ('command', 'eval', or 'script') or native tools.`);
      console.error(`   If you need shell pipes/redirects, write a script file to the scratch directory and use a 'script' payload.`);
      process.exit(1);
    })

    // Interactive blocks
    .with({ cmd: P.union('su', 'su.exe', 'passwd', 'passwd.exe', 'chsh', 'chsh.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' requires an interactive password/tty prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('ssh-keygen', 'ssh-keygen.exe') }, () => {
      if (!args.includes('-f') || !args.includes('-N')) {
        console.error(`\n   💡 AGENT HINT: 'ssh-keygen' without '-f' (file) and '-N' (passphrase) will prompt interactively.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
        console.error(`   Please provide '-f <path>' and '-N ""' to run non-interactively. Blocking execution.`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('runas', 'runas.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'runas' requires an interactive password prompt. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('sudo', 'sudo.exe'), isWin32: true }, () => {
      console.error(`\n   💡 AGENT HINT: 'sudo' on Windows triggers an interactive UAC dialog. Blocking execution to prevent headless hang.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })

    // Indefinite Hang Blocks
    .with({ cmd: P.union('watch', 'watch.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'watch' command runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ cmd: P.union('tail', 'tail.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow') || args.some(a => a.startsWith('--follow='))) {
        console.error(`\n   💡 AGENT HINT: 'tail -f' runs indefinitely. Blocking execution to prevent agent hanging.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('journalctl', 'journalctl.exe') }, () => {
      if (args.includes('-f') || args.includes('--follow')) {
        console.error(`\n   💡 AGENT HINT: 'journalctl -f' runs indefinitely. Blocking execution.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
        process.exit(1);
      }
    })

    // Native tool enforcement
    .with({ isCommand: true, hasStdin: false, cmd: P.union('cat', 'cat.exe', 'wc', 'wc.exe', 'head', 'head.exe', 'tail', 'tail.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe', 'find', 'find.exe', 'findstr', 'findstr.exe', 'gpg', 'gpg.exe'), positionalArgs: P.when(pa => pa.length === 0) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('xargs', 'xargs.exe') }, () => {
      console.error(`\n   💡 AGENT HINT: 'xargs' reads from stdin, but no stdin payload was provided. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ isCommand: true, hasStdin: false, cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe'), positionalArgs: P.when(pa => pa.length <= 1) }, () => {
      const isSafe = match(cmd)
        .with(P.union('jq', 'jq.exe', 'yq', 'yq.exe'), () => args.includes('-n') || args.includes('--null-input') || args.includes('--help'))
        .with(P.union('sed', 'sed.exe'), () => args.includes('-h') || args.includes('--help'))
        .with(P.union('awk', 'gawk'), () => args.includes('-V') || args.includes('--version') || args.includes('-W') || args.includes('--help') || args.some(a => a.includes('BEGIN')))
        .otherwise(() => false);
      
      if (!isSafe) {
        ctx.args = ctx.args.map(a => a.startsWith('C:\\') ? `/mnt/c/${a.slice(3).replace(/\\/g, '/')}` : a);
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
        process.exit(1);
      }
    })
    // Web request tool enforcement
    .with({ isCommand: true, originalCmd: P.union('curl', 'wget', 'invoke-webrequest', 'iwr'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })

    .with({ isCommand: true, hasStdin: false, cmd: P.union('grep', 'grep.exe', 'egrep', 'fgrep') }, () => {
      if (!args) ctx.args = [];
      const hasHelpOrVer = ctx.args.some(a => ['--help', '-h', '--version', '-V'].includes(a));
      if (hasHelpOrVer) return;
      const hasPattern = ctx.args.some(a => a === '-e' || a.startsWith('-e') || a === '--regexp' || a.startsWith('--regexp=') || a === '-f' || a.startsWith('--file'));
      if (positionalArgs.length === 0 && !hasPattern) {
        console.error(`\n   💡 AGENT HINT: '${cmd.replace(/\.exe$/, '')}' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
        process.exit(1);
      }
    })

    // Search tool enforcement
    .with({ isCommand: true, originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      if (args && (args.includes('--help') || args.includes('-h'))) return;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Search command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
      const patternIdx = findPatternExprIndex(originalCmd, ctx.args);
      ctx.args = ctx.args.map((a, idx) => idx === patternIdx ? a : convertToWslPath(a));
    })

    // List dir tool enforcement
    .with({ isCommand: true, originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com'), payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Directory listing command '${originalCmd}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => {
        if (a.toLowerCase() === '-recurse') return '-R';
        return convertToWslPath(a);
      });
    })

    // File removal tool enforcement
    .with({ isCommand: true, originalCmd: P.union('rm', 'rm.exe', 'rmdir', 'rmdir.exe'), isWin32: true, payload: P.when((p: unknown) => typeof p === 'object' && p !== null && !('target' in p && p.target === 'wsl2')) }, () => {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: File removal command '${originalCmd}' detected on Windows. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    // Native tool and MCP tool direct execution enforcement
    .with({ originalCmd: P.when((c: string) => (AGENT_NATIVE_TOOLS as readonly string[]).includes(c.toLowerCase().replace(/\.exe$/, ''))) }, () => {
      const toolName = originalCmd.toLowerCase().replace(/\.exe$/, '');
      if (toolName === 'grep_search') {
        const { pattern, searchPath, isCaseInsensitive, isWord, isRegex } = parseGrepSearchArgs(args);
        if (pattern.length > 0) {
          console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly as CLI command.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
          ctx.cmdBasename = 'rg';
          const rgFlags = ['-n'];
          if (isCaseInsensitive) {
            rgFlags.push('-i');
          }
          if (isWord) {
            rgFlags.push('-w');
          }
          if (!isRegex) {
            rgFlags.push('-F');
          }
          ctx.args = [...rgFlags, pattern, searchPath];
          if ('command' in ctx.payload) {
            ctx.payload.command = 'rg';
            ctx.payload.args = ctx.args;
          }
          handleRipgrepInterception(ctx, false);
          return;
        } else if (searchPath.length > 0) {
          console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly as CLI command without search pattern.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg) --files... (Frictionless Recovery)\x1b[0m`);
          ctx.cmdBasename = 'rg';
          ctx.args = ['--files', searchPath];
          if ('command' in ctx.payload) {
            ctx.payload.command = 'rg';
            ctx.payload.args = ctx.args;
          }
          handleRipgrepInterception(ctx, false);
          return;
        }
      }
      if (toolName === 'list_dir') {
        const pathArg = args.find(a => !a.startsWith('-')) ?? '.';
        console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly as CLI command.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
        ctx.cmdBasename = 'ls';
        ctx.args = [pathArg];
        ctx.payload.target = 'wsl2';
        if ('command' in ctx.payload) {
          ctx.payload.command = 'ls';
          ctx.payload.args = ctx.args;
        }
        return;
      }
      if (toolName === 'view_file') {
        const fileArg = args.find(a => !a.startsWith('-'));
        if (fileArg) {
          console.error(`\n   💡 AGENT HINT: 'view_file' executed directly as CLI command.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'view_file' to cat... (Frictionless Recovery)\x1b[0m`);
          ctx.cmdBasename = 'cat';
          ctx.args = [fileArg];
          ctx.payload.target = 'wsl2';
          if ('command' in ctx.payload) {
            ctx.payload.command = 'cat';
            ctx.payload.args = ctx.args;
          }
          return;
        }
      }
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' is an agent-native tool, NOT a terminal CLI binary. Please invoke the '${cmdBasename}' tool directly instead of executing it via the terminal.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })
    .with({ originalCmd: P.when((c: string) => (ECOSYSTEM_MCP_TOOLS as readonly string[]).includes(c.toLowerCase().replace(/\.exe$/, ''))) }, () => {
      console.error(`\n   💡 AGENT HINT: '${cmdBasename}' is an MCP tool, NOT a terminal CLI binary. Please call the '${cmdBasename}' MCP tool via call_mcp_tool instead of executing it via the terminal.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    })

    .otherwise(() => {});
}
