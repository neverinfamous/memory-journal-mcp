import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';

export function packageManagerInterceptor({ cmdBasename, args, envOverrides }: ExecutionContext): void {
  if (['apt', 'apt-get'].includes(cmdBasename)) {
    envOverrides['DEBIAN_FRONTEND'] = 'noninteractive';
    if (!args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into apt/apt-get command to prevent prompt hanging.\n${AUTONOMOUS_HEALING_MSG}`);
      args.unshift('-y');
    }
  }

  if (['apk'].includes(cmdBasename)) {
    if (args.includes('add') || args.includes('del')) {
       if (!args.includes('--no-interactive')) {
         console.error(`\n   💡 AGENT HINT: Automatically injecting '--no-interactive' into apk command.\n${AUTONOMOUS_HEALING_MSG}`);
         args.push('--no-interactive');
       }
    }
  }

  if (['pacman', 'pacman.exe'].includes(cmdBasename)) {
    if (!args.includes('--noconfirm')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '--noconfirm' into pacman command.\n${AUTONOMOUS_HEALING_MSG}`);
      args.push('--noconfirm');
    }
  }

  if (['yum', 'dnf'].includes(cmdBasename)) {
    if (!args.includes('-y')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into ${cmdBasename} command.\n${AUTONOMOUS_HEALING_MSG}`);
      args.push('-y');
    }
  }

  if (['conda', 'conda.exe', 'mamba', 'mamba.exe'].includes(cmdBasename)) {
    if (!args.includes('-y') && !args.includes('--yes')) {
      const subCmd = args.filter(a => !a.startsWith('-'))[0];
      if (['install', 'create', 'update', 'upgrade', 'remove', 'uninstall'].includes(subCmd)) {
        console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.\n${AUTONOMOUS_HEALING_MSG}`);
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
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into pip uninstall to prevent prompt hanging.\n${AUTONOMOUS_HEALING_MSG}`);
      args.push('-y');
    }
  }

  if (['npm', 'npm.cmd', 'npm.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe', 'yarn', 'yarn.cmd', 'yarn.exe', 'bun', 'bun.cmd', 'bun.exe'].includes(cmdBasename)) {
    envOverrides['CI'] = '1';
    envOverrides['PNPM_INTERACTIVE'] = 'false';

    const isYarnOrPnpm = cmdBasename.includes('yarn') || cmdBasename.includes('pnpm');
    if (args.includes('--interactive') || (isYarnOrPnpm && args.includes('-i'))) {
      console.error(`\n   💡 AGENT HINT: Stripping interactive flag from ${cmdBasename} command...\n${AUTONOMOUS_HEALING_MSG}`);
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
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into ${cmdBasename} ${subCmd} command to prevent prompt hanging.\n${AUTONOMOUS_HEALING_MSG}`);
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
    envOverrides['CI'] = '1';
    if (!args.includes('-y') && !args.includes('--yes')) {
      console.error(`\n   💡 AGENT HINT: Automatically injecting '-y' into ${cmdBasename} command to prevent installation prompts from hanging.\n${AUTONOMOUS_HEALING_MSG}`);
      args.unshift('-y');
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
