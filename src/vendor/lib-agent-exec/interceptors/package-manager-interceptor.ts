import fs from 'fs';
import path from 'path';
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';

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
    if (subCmd && subCmd.startsWith('test')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Disabling stall interceptors for test command to prevent false positives from coverage/progress output.... (Frictionless Recovery)`);
      ctx.payload.bypassInterceptors = true;
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
