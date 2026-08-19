// @ts-nocheck
import { ExecutionContext } from './types.js';
import { match, P } from 'ts-pattern';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { convertToWslPath } from '../command-utils.js';
import { getUnquoted } from './utils.js';
import { runMutatingInterceptors } from './mutating-interceptors.js';
import { runStructuralInterceptors } from './structural-interceptors.js';


export function systemInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, payload } = ctx;
  const { args } = ctx;
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'node', 'node.exe', 'python', 'python.exe', 'bun', 'bun.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval', '-execute', '--execute'];


  const isCommand = payload.type === 'command';
  const rawCmdStr = 'command' in payload && typeof payload.command === 'string' && payload.command.trim().includes(' ')
    ? payload.command.trim()
    : cmdBasename.trim();
  const embeddedArgs = rawCmdStr.includes(' ')
    ? rawCmdStr.split(/\s+/).slice(1)
    : [];
  const combinedArgs = [...embeddedArgs, ...args];
  const positionalArgs = combinedArgs.filter(a => !a.startsWith('-'));
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
    payload.timeoutMs = Math.max(payload.timeoutMs || 30000, 30000);
  }

  // 1. Mutating intercepts (safe to run before block checks)
  runMutatingInterceptors(ctx, { cmd, cmdBasename, args });

  match({ ...ctx, positionalArgs, hasStdin, cmd, isCommand, isWin32: process.platform === 'win32', originalCmd })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd) || args[0] === '-c' || args[0] === '/c') {
        return;
      }
      if (!hasStdin && positionalArgs.length === 0) {
        console.error(`\n   💡 AGENT HINT: 'cat' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Provide a file argument or use view_file.\x1b[0m`);
        process.exit(1);
      }
      console.error(`\n   💡 AGENT INTERCEPT: 'cat' file inspection command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd) || args[0] === '-c' || args[0] === '/c') {
        return;
      }
      if (ctx.payload.target === 'wsl2' || process.platform !== 'win32') {
        return;
      }
      if (!hasStdin && positionalArgs.length <= 1 && !args.some((a: string) => ['-r', '-R', '--recursive', '--files', '--help', '-h', '--version', '-v', '-V'].includes(a))) {
        console.error(`\n   💡 AGENT HINT: 'grep' called without file arguments and no recursive flag. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters or use grep_search.\x1b[0m`);
        process.exit(1);
      }
      console.error(`\n   💡 AGENT INTERCEPT: 'grep' search command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      if (cmdBasename.toLowerCase() === 'select-string') {
        if (ctx.payload.type === 'command') ctx.payload.command = 'grep';
      }
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com') }, () => {
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
        cleanedArgs.push(convertToWslPath(a));
      }
      ctx.args = cleanedArgs;
    })
    .with({ originalCmd: P.union('curl', 'curl.exe', 'wget', 'wget.exe', 'invoke-webrequest', 'iwr') }, () => {
      console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' network command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      if (['invoke-webrequest', 'iwr'].includes(cmdBasename.toLowerCase())) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'curl';
      }
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'find', 'find.exe') }, () => {
      console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';

      if (['find', 'find.exe'].includes(cmdBasename.toLowerCase())) {
        const filterIdx = ctx.args.findIndex(a => ['-filter', '-include'].includes(a.toLowerCase()));
        if (filterIdx !== -1 && filterIdx + 1 < ctx.args.length) {
          const pattern = ctx.args[filterIdx + 1];
          const hasRecurse = ctx.args.some(a => ['-recurse', '-r', '-R', '/s'].includes(a.toLowerCase()));
          let targetPath = '.';
          for (let i = 0; i < ctx.args.length; i++) {
            if (i === filterIdx || i === filterIdx + 1) continue;
            const a = ctx.args[i];
            if (!a.startsWith('-') && !a.startsWith('/')) {
              targetPath = convertToWslPath(a);
              break;
            }
          }
          const newArgs = [targetPath];
          if (!hasRecurse) {
            newArgs.push('-maxdepth', '1');
          }
          newArgs.push('-name', pattern);
          ctx.args = newArgs;
          return;
        }
      }

      // Automatically convert Windows paths (like C:\... or C:/... or "C:\...") to WSL paths (/mnt/c/...)
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ isCommand: true, originalCmd: P.union('rg', 'rg.exe') }, () => {
      const cleanedArgs = ctx.args.map(a => {
        if (a === '-R' || a === '--recursive') return '';
        if (a.startsWith('-') && !a.startsWith('--') && a.includes('R')) {
          const cleaned = a.replace(/R/g, '');
          return cleaned === '-' ? '' : cleaned;
        }
        return a;
      }).filter(Boolean);

      // Auto-heal grep-style flags (--include, --exclude, --exclude-dir) into rg glob flags (-g)
      const healedArgs: string[] = [];
      let convertedGrepFlags = false;
      for (let i = 0; i < cleanedArgs.length; i++) {
        const a = cleanedArgs[i];
        if (a === '--include' && i + 1 < cleanedArgs.length) {
          healedArgs.push('-g', cleanedArgs[++i]);
          convertedGrepFlags = true;
        } else if (a.startsWith('--include=')) {
          healedArgs.push(`-g=${a.slice('--include='.length)}`);
          convertedGrepFlags = true;
        } else if (a === '--exclude' && i + 1 < cleanedArgs.length) {
          const pattern = cleanedArgs[++i];
          healedArgs.push('-g', pattern.startsWith('!') ? pattern : `!${pattern}`);
          convertedGrepFlags = true;
        } else if (a.startsWith('--exclude=')) {
          const pattern = a.slice('--exclude='.length);
          healedArgs.push(`-g=${pattern.startsWith('!') ? pattern : `!${pattern}`}`);
          convertedGrepFlags = true;
        } else if (a === '--exclude-dir' && i + 1 < cleanedArgs.length) {
          const dir = cleanedArgs[++i];
          healedArgs.push('-g', `!${dir}/**`);
          convertedGrepFlags = true;
        } else if (a.startsWith('--exclude-dir=')) {
          const dir = a.slice('--exclude-dir='.length);
          healedArgs.push(`-g=!${dir}/**`);
          convertedGrepFlags = true;
        } else {
          healedArgs.push(a);
        }
      }
      if (convertedGrepFlags) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' does not accept grep-style '--include/--exclude'. Normalizing to ripgrep '-g' (glob) flags... (Frictionless Recovery)`);
      }
      ctx.args = healedArgs;

      if (hasStdin) {
        console.error(`\n   💡 AGENT INTERCEPT: Search command with stdin detected. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
      } else if (process.platform === 'win32' && ctx.payload.target !== 'wsl2') {
        console.error(`\n   💡 AGENT INTERCEPT: 'rg' natively fails or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
        ctx.args = ctx.args.map(a => convertToWslPath(a));
      }
      const updatedPositional = ctx.args.filter(a => !a.startsWith('-'));
      if (!hasStdin && updatedPositional.length <= 1 && !ctx.args.some(a => ['-r', '-R', '--recursive', '--files', '--help', '-h'].includes(a))) {
        console.error(`\n   💡 AGENT INTERCEPT: 'rg' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
        ctx.args.push('.');
      }
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
                const isShell = ['pwsh', 'powershell', 'bash', 'sh', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'].includes(cmdBasename.toLowerCase());
                const isPackageManager = ['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bun.exe'].includes(cmdBasename.toLowerCase());
                
                if (checkStr.trim() === op) return true;
                if (isShell) return true;
                if (isPackageManager) return true;
                
                if (!hasSpacesAround) {
                    if (checkStr.includes('{') || checkStr.includes('[')) return false;
                    if (/[a-zA-Z0-9]/.test(checkStr)) return true;
                    return false;
                }
                
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

  match({ cmd, originalCmd, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, args, hasStdin, isWin32: process.platform === 'win32', payload })
    .with({ isCommand: true, originalCmd: P.union('node', 'node.exe', 'python', 'python.exe', 'python3', 'python3.exe', 'bun', 'bun.exe'), args: P.when((a: string[]) => a.some(arg => ['-e', '--eval', '-p', '--print', '-c', '--command'].includes(arg))) }, ({ originalCmd }) => {
      const interpreter = originalCmd.replace(/\.exe$/, '');
      const flagIdx = ctx.args.findIndex(a => ['-e', '--eval', '-p', '--print', '-c', '--command'].includes(a));
      const scriptContent = ctx.args[flagIdx + 1];
      
      if (scriptContent) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting inline ${interpreter} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)\x1b[0m`);
        const ext = interpreter.startsWith('python') ? 'py' : (interpreter === 'bun' ? 'ts' : 'js');
        
        const outDir = os.tmpdir();
        
        const tmpFile = path.join(outDir, `.agent_inline_script_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpFile, scriptContent);
        
        process.on('exit', () => {
          try {
            if (fs.existsSync(tmpFile)) {
              fs.unlinkSync(tmpFile);
            }
          } catch {
            // ignore

          }
        });
        ctx.cmdBasename = interpreter;
        ctx.args.splice(flagIdx, 2, tmpFile);
        if ('command' in ctx.payload) {
          ctx.payload.command = interpreter;
          ctx.payload.args = ctx.args;
        }
      }
    })
    .otherwise(() => {});
}
