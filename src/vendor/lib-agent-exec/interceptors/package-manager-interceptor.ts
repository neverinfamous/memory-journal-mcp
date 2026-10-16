// @ts-nocheck
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { handleRipgrepInterception } from './search-interceptor.js';

export function packageManagerInterceptor(ctx: ExecutionContext): void {
  let { cmdBasename } = ctx;
  const { envOverrides } = ctx;
  let { args } = ctx;
  if (!args) args = [];
  if (args.includes('--help') || args.includes('-h')) return;

  if (['apt', 'apt-get'].includes(cmdBasename)) {
    envOverrides['DEBIAN_FRONTEND'] = 'noninteractive';
    if (!args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into apt/apt-get command to prevent prompt hanging.... (Frictionless Recovery)`);
      args.unshift('-y');
    }
  }

  if (['apk'].includes(cmdBasename)) {
    if (args.includes('add') || args.includes('del')) {
       if (!args.includes('--no-interactive')) {
         console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--no-interactive' into apk command.... (Frictionless Recovery)`);
         args.push('--no-interactive');
       }
    }
  }

  if (['pacman', 'pacman.exe'].includes(cmdBasename)) {
    if (!args.includes('--noconfirm')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '--noconfirm' into pacman command.... (Frictionless Recovery)`);
      args.push('--noconfirm');
    }
  }

  if (['yum', 'dnf'].includes(cmdBasename)) {
    if (!args.includes('-y')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command.... (Frictionless Recovery)`);
      args.push('-y');
    }
  }

  if (['conda', 'conda.exe', 'mamba', 'mamba.exe'].includes(cmdBasename)) {
    if (!args.includes('-y') && !args.includes('--yes')) {
      const subCmd = args.filter(a => !a.startsWith('-'))[0];
      if (['install', 'create', 'update', 'upgrade', 'remove', 'uninstall'].includes(subCmd)) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
        args.push('-y');
      }
    }
  }

  const mIndex = args.indexOf('-m');
  const isPythonPip = ['python', 'python.exe', 'python3', 'python3.exe'].includes(cmdBasename) && mIndex !== -1 && args[mIndex + 1] === 'pip';
  if (['pip', 'pip3', 'pip.exe', 'pip3.exe'].includes(cmdBasename) || isPythonPip) {
    const pipArgs = isPythonPip ? args.slice(mIndex + 2) : args;
    const subCmd = pipArgs.filter(a => !a.startsWith('-'))[0];
    if (subCmd === 'uninstall' && !pipArgs.includes('-y') && !pipArgs.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into pip uninstall to prevent prompt hanging.... (Frictionless Recovery)`);
      args.push('-y');
    }
  }

  if (['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe'].includes(cmdBasename)) {
    const isBunProject = fs.existsSync(path.join(ctx.payload.cwd || process.cwd(), 'bun.lockb'));
    const isNpm = cmdBasename.startsWith('npm');
    const isYarn = cmdBasename.startsWith('yarn');
    const isPnpm = cmdBasename.startsWith('pnpm');

    if (!isBunProject && (isNpm || isYarn)) {
      const nonFlagArgs = args.filter(a => !a.startsWith('-'));
      const subCmd = nonFlagArgs[0];
      let rewriteToPnpm = false;

      if (isNpm) {
        if (subCmd === 'install' && nonFlagArgs.length === 1) {
          rewriteToPnpm = true;
        } else if (subCmd === 'install' && nonFlagArgs.length > 1) {
          rewriteToPnpm = true;
          args[args.indexOf('install')] = 'add';
        } else if (subCmd === 'uninstall' && nonFlagArgs.length > 1) {
          rewriteToPnpm = true;
          args[args.indexOf('uninstall')] = 'remove';
        } else if (['run', 'test', 'start'].includes(subCmd)) {
          rewriteToPnpm = true;
        } else if (subCmd === 'ci') {
          rewriteToPnpm = true;
          args[args.indexOf('ci')] = 'install';
          if (!args.includes('--frozen-lockfile')) args.push('--frozen-lockfile');
        }
      } else if (isYarn) {
        if (!subCmd && args.length === 0) {
          rewriteToPnpm = true;
          args.push('install');
        } else if (['add', 'remove'].includes(subCmd) && nonFlagArgs.length > 1) {
          rewriteToPnpm = true;
        }
      }

      if (rewriteToPnpm) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting '${`${cmdBasename} ${subCmd || ''}`.trim()}' to pnpm... (Frictionless Recovery)`);
        cmdBasename = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
        ctx.cmdBasename = cmdBasename;
        if ('command' in ctx.payload) {
           ctx.payload.command = cmdBasename;
        }
      }
    } else if (isBunProject && (isNpm || isYarn || isPnpm)) {
      const nonFlagArgs = args.filter(a => !a.startsWith('-'));
      const subCmd = nonFlagArgs[0];
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Bun project detected. Transparently rewriting '${`${cmdBasename} ${subCmd || ''}`.trim()}' to bun... (Frictionless Recovery)`);
      if (isNpm && subCmd === 'uninstall') args[args.indexOf('uninstall')] = 'remove';
      if (isNpm && subCmd === 'ci') { args[args.indexOf('ci')] = 'install'; if (!args.includes('--frozen-lockfile')) args.push('--frozen-lockfile'); }
      if (isYarn && !subCmd && args.length === 0) args.push('install');
      cmdBasename = process.platform === 'win32' ? 'bun.exe' : 'bun';
      ctx.cmdBasename = cmdBasename;
      if ('command' in ctx.payload) ctx.payload.command = cmdBasename;
    }

    envOverrides['CI'] = '1';
    envOverrides['PNPM_INTERACTIVE'] = 'false';

    const isYarnOrPnpm = cmdBasename.includes('yarn') || cmdBasename.includes('pnpm');
    if (args.includes('--interactive') || (isYarnOrPnpm && args.includes('-i'))) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripping interactive flag from ${cmdBasename} command... (Frictionless Recovery)`);
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i] === '--interactive' || (isYarnOrPnpm && args[i] === '-i')) args.splice(i, 1);
      }
    }
    const subCmd = args.filter(a => !a.startsWith('-'))[0];
    if (subCmd && (AGENT_NATIVE_TOOLS as readonly string[]).includes(subCmd)) {
      if (subCmd === 'grep_search') {
        const sIdx = args.findIndex(a => ['-s', '--symbol', '--pattern', '--searchpattern', '--search-pattern', '--targetcontent', '--target-content', '--content'].includes(a.toLowerCase()));
        const pIdx = args.findIndex(a => ['-p', '--path', '-d', '--dir', '--searchpath', '--search-path'].includes(a.toLowerCase()));
        const subCmdIdx = args.indexOf(subCmd);
        const argsAfterSubCmd = args.slice(subCmdIdx + 1);
        const nonFlagAfterSubCmd: string[] = [];
        for (let i = 0; i < argsAfterSubCmd.length; i++) {
          const a = argsAfterSubCmd[i];
          if (['-s', '--symbol', '--pattern', '-p', '--path', '-d', '--dir', '--searchpath', '--search-path', '--searchpattern', '--search-pattern', '--targetcontent', '--target-content', '--content'].includes(a.toLowerCase())) {
            i++;
            continue;
          }
          if (!a.startsWith('-')) {
            nonFlagAfterSubCmd.push(a);
          }
        }
        const pattern = sIdx !== -1 && sIdx + 1 < args.length ? (args[sIdx + 1] ?? '') : (nonFlagAfterSubCmd[0] ?? '');
        const searchPath = pIdx !== -1 && pIdx + 1 < args.length ? (args[pIdx + 1] ?? '.') : (nonFlagAfterSubCmd[1] ?? '.');
        const isPathLike = (s: string): boolean => {
          if (!s || s.length === 0) return false;
          const clean = s.trim();
          if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../') || clean.endsWith('/') || clean.endsWith('\\')) return true;
          if (clean.includes('/') || clean.includes('\\') || /^[a-zA-Z]:/.test(clean)) return true;
          try {
            const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? path.resolve(ctx.payload.cwd) : process.cwd();
            return fs.existsSync(path.resolve(cwd, clean)) && fs.statSync(path.resolve(cwd, clean)).isDirectory();
          } catch {
            return false;
          }
        };
        let finalPattern = pattern;
        let finalPath = searchPath;
        if (isPathLike(finalPattern) && !isPathLike(finalPath) && finalPath.length > 0) {
          const tmp = finalPattern;
          finalPattern = finalPath;
          finalPath = tmp;
        }
        if (finalPattern.length > 0) {
          console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
          ctx.cmdBasename = 'rg';
          const rgFlags = ['-n'];
          if (args.some(a => a === '-i' || a === '-ri' || a === '-ir' || a === '--case-insensitive' || (a.startsWith('-') && !a.startsWith('--') && a.includes('i')))) {
            rgFlags.push('-i');
          }
          if (args.some(a => a === '-w' || a === '--word-regexp')) {
            rgFlags.push('-w');
          }
          if (!args.some(a => a === '-e' || a === '--regexp')) {
            rgFlags.push('-F');
          }
          ctx.args = [...rgFlags, finalPattern, finalPath];
          if ('command' in ctx.payload) {
            ctx.payload.command = 'rg';
            ctx.payload.args = ctx.args;
          }
          handleRipgrepInterception(ctx, false);
          return;
        }
      }
      if (subCmd === 'list_dir') {
        const subCmdIdx = args.indexOf(subCmd);
        const pathArg = args.slice(subCmdIdx + 1).find(a => !a.startsWith('-')) ?? '.';
        console.error(`\n   💡 AGENT HINT: 'list_dir' is an agent-native tool, NOT a package manager script.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ls... (Frictionless Recovery)\x1b[0m`);
        ctx.cmdBasename = 'ls';
        ctx.args = [pathArg];
        ctx.payload.target = 'wsl2';
        if ('command' in ctx.payload) {
          ctx.payload.command = 'ls';
          ctx.payload.args = ctx.args;
        }
        return;
      }
      if (subCmd === 'view_file') {
        const subCmdIdx = args.indexOf(subCmd);
        const fileArg = args.slice(subCmdIdx + 1).find(a => !a.startsWith('-'));
        if (fileArg) {
          console.error(`\n   💡 AGENT HINT: 'view_file' is an agent-native tool, NOT a package manager script.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to cat... (Frictionless Recovery)\x1b[0m`);
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
      console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script or CLI binary. Please invoke the '${subCmd}' tool directly instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    if (subCmd && (ECOSYSTEM_MCP_TOOLS as readonly string[]).includes(subCmd)) {
      console.error(`\n   💡 AGENT HINT: '${subCmd}' is an MCP tool, NOT a package manager script or CLI binary. Please call the '${subCmd}' MCP tool via call_mcp_tool instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    if (subCmd === 'upgrade-interactive') {
      console.error(`\n   💡 AGENT HINT: 'yarn upgrade-interactive' is a TUI tool and will hang. Use 'yarn upgrade' instead.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    if (subCmd === 'dlx' || subCmd === 'x') {
      const subCmdIdx = args.indexOf(subCmd);
      const afterSubCmd = args.slice(subCmdIdx + 1);
      const targetPkgIdx = afterSubCmd.findIndex(a => !a.startsWith('-'));
      const targetPkg = targetPkgIdx !== -1 ? afterSubCmd[targetPkgIdx] : undefined;
      if (targetPkg === 'rg' || targetPkg === 'ripgrep') {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd} ${targetPkg}' to native ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
        ctx.cmdBasename = 'rg';
        const absoluteTargetIdx = subCmdIdx + 1 + targetPkgIdx;
        ctx.args = args.filter((a, idx) => idx !== subCmdIdx && idx !== absoluteTargetIdx && a !== '-y' && a !== '--yes');
        if ('command' in ctx.payload) {
          ctx.payload.command = 'rg';
          ctx.payload.args = ctx.args;
        }
        handleRipgrepInterception(ctx, false);
        return;
      }
      if (targetPkg === 'fd' || targetPkg === 'fdfind') {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd} ${targetPkg}' to native fd... (Frictionless Recovery)\x1b[0m`);
        ctx.cmdBasename = 'fd';
        const absoluteTargetIdx = subCmdIdx + 1 + targetPkgIdx;
        ctx.args = args.filter((a, idx) => idx !== subCmdIdx && idx !== absoluteTargetIdx && a !== '-y' && a !== '--yes');
        ctx.payload.target = 'wsl2';
        if ('command' in ctx.payload) {
          ctx.payload.command = 'fd';
          ctx.payload.args = ctx.args;
        }
        return;
      }
    }
    if (['init', 'create', 'dlx', 'x'].includes(subCmd) && !args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.... (Frictionless Recovery)`);
      if (subCmd === 'dlx' || subCmd === 'x') {
         args.splice(args.indexOf(subCmd) + 1, 0, '-y');
      } else {
         args.push('-y');
      }
    }
    if (['install', 'add', 'update', 'upgrade'].includes(subCmd)) {
      if (!args.includes('--no-fund') && cmdBasename.startsWith('npm')) args.push('--no-fund');
      if (!args.includes('--no-audit') && cmdBasename.startsWith('npm')) args.push('--no-audit');
    }
    const nonFlagArgs = args.filter(a => !a.startsWith('-'));
    const targetScript = (subCmd === 'run' || subCmd === 'exec') ? nonFlagArgs[1] : subCmd;
    const isPlaywright = Boolean((targetScript && /playwright/i.test(targetScript)) || args.some(a => /playwright/i.test(a)));
    const isLongRunningQualityCheck = Boolean(
      isPlaywright ||
      (targetScript && (
        targetScript.startsWith('test') ||
        ['lint', 'typecheck', 'check', 'build'].includes(targetScript) ||
        targetScript.includes('test') ||
        targetScript.includes('lint') ||
        targetScript.includes('typecheck')
      )) ||
      args.some(a => /(?:vitest|jest|playwright|test|lint|typecheck|tsc)/i.test(a))
    );
    if (isPlaywright) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors and extending timeout for Playwright test to prevent false positive aborts.... (Frictionless Recovery)`);
      ctx.payload.bypassInterceptors = true;
      if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 600000) {
        ctx.payload.timeoutMs = 600000;
      }
    } else if (isLongRunningQualityCheck) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors and extending timeout for quality command to prevent false positive aborts.... (Frictionless Recovery)`);
      ctx.payload.bypassInterceptors = true;
      const testFiles = args.filter(a => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a));
      const isMultiTest = testFiles.length > 1;
      const isTestDir = args.some(a => /(?:tests?[/\\]\w+[/\\].*[/\\].*|tests?[/\\]$)/i.test(a) && !/\.[a-zA-Z0-9_-]+$/i.test(a));
      const isTestRunner = /(?:vitest|jest|pytest)/i.test(cmdBasename) || args.some(a => /(?:vitest|jest|pytest|^test$)/i.test(a));
      const isFullSuite = isTestRunner && testFiles.length === 0 && !isTestDir;
      const targetTimeout = ctx.payload.target === 'wsl2'
        ? (isMultiTest || isTestDir || isFullSuite ? 180000 : 90000)
        : (isMultiTest || isTestDir || isFullSuite ? 300000 : 240000);
      if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < targetTimeout) {
        ctx.payload.timeoutMs = targetTimeout;
      }
    }
    if (['login', 'adduser', 'publish'].includes(subCmd)) {
      if (subCmd === 'publish' && process.env.NPM_TOKEN) {
         // allow if token exists
      } else {
         console.error(`\n   💡 AGENT HINT: '${cmdBasename} ${subCmd}' may be highly interactive (e.g., OTP prompts, auth) and will hang. Please configure token-based authentication non-interactively.\n${AUTONOMOUS_HEALING_MSG}`);
         process.exit(1);
      }
    }
  }

  if (['npx', 'npx.cmd', 'npx.exe', 'pnpx', 'pnpx.cmd', 'pnpx.exe', 'bunx', 'bunx.cmd', 'bunx.exe'].includes(cmdBasename)) {
    const firstNonFlagIdx = args.findIndex(a => !a.startsWith('-'));
    const runnerTarget = firstNonFlagIdx !== -1 ? args[firstNonFlagIdx] : undefined;
    if (runnerTarget === 'rg' || runnerTarget === 'ripgrep') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${runnerTarget}' to native ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
      ctx.cmdBasename = 'rg';
      ctx.args = args.filter((a, idx) => idx !== firstNonFlagIdx && a !== '-y' && a !== '--yes');
      if ('command' in ctx.payload) {
        ctx.payload.command = 'rg';
        ctx.payload.args = ctx.args;
      }
      handleRipgrepInterception(ctx, false);
      return;
    }
    if (runnerTarget === 'fd' || runnerTarget === 'fdfind') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${runnerTarget}' to native fd... (Frictionless Recovery)\x1b[0m`);
      ctx.cmdBasename = 'fd';
      ctx.args = args.filter((a, idx) => idx !== firstNonFlagIdx && a !== '-y' && a !== '--yes');
      ctx.payload.target = 'wsl2';
      if ('command' in ctx.payload) {
        ctx.payload.command = 'fd';
        ctx.payload.args = ctx.args;
      }
      return;
    }
    if (cmdBasename.startsWith('npx') && args[0] === 'tsx') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting 'npx tsx' to 'pnpm exec tsx' to prevent interactive installation prompts... (Frictionless Recovery)\x1b[0m`);
      ctx.cmdBasename = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
      if ('command' in ctx.payload) {
         ctx.payload.command = ctx.cmdBasename;
      }
      args.unshift('exec');
      const evalIdx = args.findIndex(a => ['-e', '--eval'].includes(a));
      if (evalIdx !== -1 && evalIdx + 1 < args.length) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting inline tsx script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)\x1b[0m`);
        const scriptContent = args[evalIdx + 1];
        const outDir = os.tmpdir();
        const tmpFile = path.join(outDir, `.agent_inline_script_${Date.now()}.ts`);
        fs.writeFileSync(tmpFile, scriptContent);
        process.on('exit', () => {
          try {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
          } catch {
            // ignore
          }
        });
        args.splice(evalIdx, 2, tmpFile);
        if ('command' in ctx.payload) {
          ctx.payload.args = ctx.args;
        }
      }
    } else {
      envOverrides['CI'] = '1';
      const isPlaywright = args.some(a => /playwright/i.test(a));
      const isRunnerQuality = args.some(a => /(?:vitest|jest|playwright|test|lint|typecheck|tsc)/i.test(a));
      if (isPlaywright) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors and extending timeout for Playwright test to prevent false positive aborts.... (Frictionless Recovery)`);
        ctx.payload.bypassInterceptors = true;
        if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 600000) {
          ctx.payload.timeoutMs = 600000;
        }
      } else if (isRunnerQuality) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors and extending timeout for quality command to prevent false positive aborts.... (Frictionless Recovery)`);
        ctx.payload.bypassInterceptors = true;
        const testFiles = args.filter(a => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a));
        const isMultiTest = testFiles.length > 1;
        const isTestDir = args.some(a => /(?:tests?[/\\]\w+[/\\].*[/\\].*|tests?[/\\]$)/i.test(a) && !/\.[a-zA-Z0-9_-]+$/i.test(a));
        const isTestRunner = /(?:vitest|jest|pytest)/i.test(cmdBasename) || args.some(a => /(?:vitest|jest|pytest|^test$)/i.test(a));
        const isFullSuite = isTestRunner && testFiles.length === 0 && !isTestDir;
        const runnerTimeout = ctx.payload.target === 'wsl2'
          ? (isMultiTest || isTestDir || isFullSuite ? 180000 : 90000)
          : (isMultiTest || isTestDir || isFullSuite ? 300000 : 240000);
        if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < runnerTimeout) {
          ctx.payload.timeoutMs = runnerTimeout;
        }
      }
      if (!args.includes('-y') && !args.includes('--yes')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-y' into ${cmdBasename} command to prevent installation prompts from hanging.... (Frictionless Recovery)`);
        args.unshift('-y');
      }
    }
  }

  if (['corepack', 'corepack.cmd', 'corepack.exe'].includes(cmdBasename)) {
    envOverrides['COREPACK_ENABLE_DOWNLOAD_PROMPT'] = '0';
    envOverrides['COREPACK_ENABLE_STRICT'] = '0';
  }

  if (['uv', 'uv.exe', 'uvx', 'uvx.exe'].includes(cmdBasename)) {
    envOverrides['UV_NO_PROGRESS'] = '1';
  }
}
