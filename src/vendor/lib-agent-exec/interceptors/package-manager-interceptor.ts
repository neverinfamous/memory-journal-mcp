// @ts-nocheck
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';

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
        const sIdx = args.findIndex(a => ['-s', '--symbol', '--pattern'].includes(a));
        const pIdx = args.findIndex(a => ['-p', '--path'].includes(a));
        const pattern = sIdx !== -1 && sIdx + 1 < args.length ? (args[sIdx + 1] ?? '') : '';
        const searchPath = pIdx !== -1 && pIdx + 1 < args.length ? (args[pIdx + 1] ?? '.') : '.';
        if (pattern.length > 0) {
          console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
          ctx.cmdBasename = 'rg';
          ctx.args = ['-n', '-F', pattern, searchPath];
          if ('command' in ctx.payload) {
            ctx.payload.command = 'rg';
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
    const isLongRunningQualityCheck = subCmd && (
      subCmd.startsWith('test') ||
      ['lint', 'typecheck', 'check', 'build'].includes(subCmd) ||
      subCmd.includes('test') ||
      subCmd.includes('lint') ||
      subCmd.includes('typecheck')
    );
    if (isLongRunningQualityCheck) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors and extending timeout for quality command to prevent false positive aborts.... (Frictionless Recovery)`);
      ctx.payload.bypassInterceptors = true;
      if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs <= 30000) {
        ctx.payload.timeoutMs = ctx.payload.target === 'wsl2' ? 90000 : 60000;
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
