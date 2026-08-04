import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import { ExecutionContext } from './types.js';

export function dockerInterceptor({ cmdBasename, args, payload }: ExecutionContext): void {
  const dockerCmds = ['docker', 'docker.exe', 'docker.bat'];
  const dockerComposeCmds = ['docker-compose', 'docker-compose.exe', 'docker-compose.bat'];
  const kubectlCmds = ['kubectl', 'kubectl.exe'];

  if (kubectlCmds.includes(cmdBasename)) {
    const subCmd = args.filter(a => !a.startsWith('-'))[0];
    if (['edit', 'attach', 'debug'].includes(subCmd)) {
      console.error(`\n   💡 AGENT HINT: 'kubectl ${subCmd}' is highly interactive and will hang. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
    if (subCmd === 'logs') {
      const hasFollow = args.some(a => a === '-f' || a === '--follow');
      if (hasFollow) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: 'kubectl logs -f' runs indefinitely and will cause a timeout. Automatically stripping '-f / --follow' flag... (Frictionless Recovery)`);
        for (let i = args.length - 1; i >= 0; i--) {
          if (args[i] === '-f' || args[i] === '--follow') args.splice(i, 1);
        }
      }
    }
  }

  if (!dockerCmds.includes(cmdBasename) && !dockerComposeCmds.includes(cmdBasename)) return;

  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const knownDockerCmds = ['compose', 'buildx', 'run', 'exec', 'logs', 'build', 'up', 'down', 'start', 'stop', 'restart', 'ps', 'pull', 'push', 'images', 'rm', 'rmi', 'network', 'volume', 'system', 'info', 'version', 'inspect', 'cp', 'export', 'import', 'save', 'load', 'login', 'logout', 'search', 'tag', 'history', 'commit', 'events', 'port', 'top', 'stats', 'attach', 'wait', 'rename', 'update', 'kill', 'pause', 'unpause', 'create', 'plugin'];
  const knownComposeCmds = ['up', 'down', 'run', 'exec', 'logs', 'build', 'start', 'stop', 'restart', 'ps', 'pull', 'push', 'config', 'cp', 'create', 'events', 'images', 'kill', 'ls', 'pause', 'port', 'rm', 'top', 'unpause', 'wait', 'watch'];
  
  const subCmd = dockerCmds.includes(cmdBasename) ? (args.find(a => knownDockerCmds.includes(a)) || positionalArgs[0]) : positionalArgs[0];
  const isComposePlugin = dockerCmds.includes(cmdBasename) && subCmd === 'compose';
  const isBuildxPlugin = dockerCmds.includes(cmdBasename) && subCmd === 'buildx';
  
  const composeSubCmd = isComposePlugin 
      ? (args.slice(args.indexOf('compose') + 1).find(a => knownComposeCmds.includes(a)) || positionalArgs[1]) 
      : (dockerComposeCmds.includes(cmdBasename) ? (args.find(a => knownComposeCmds.includes(a)) || positionalArgs[0]) : null);

  const buildxSubCmd = isBuildxPlugin
      ? (args.slice(args.indexOf('buildx') + 1).filter(a => !a.startsWith('-'))[0])
      : null;
  
  let isDockerTtySensitive = false;
  let isComposeExec = false;
  let isComposeRun = false;

  if (dockerCmds.includes(cmdBasename) && subCmd === 'build') {
     if (!args.includes('--progress=plain') && !args.includes('--progress')) args.push('--progress=plain');
  }

  if (isBuildxPlugin && buildxSubCmd === 'build') {
     if (!args.includes('--progress=plain') && !args.includes('--progress')) args.push('--progress=plain');
  }

  if ((dockerComposeCmds.includes(cmdBasename) || isComposePlugin) && composeSubCmd === 'build') {
     if (!args.includes('--progress=plain') && !args.includes('--progress')) args.push('--progress=plain');
  }

  if (dockerCmds.includes(cmdBasename) && !isComposePlugin && (subCmd === 'run' || subCmd === 'exec' || (subCmd === 'container' && (positionalArgs[1] === 'run' || positionalArgs[1] === 'exec')))) {
    isDockerTtySensitive = true;
  } else if (dockerComposeCmds.includes(cmdBasename) && (composeSubCmd === 'run' || composeSubCmd === 'exec')) {
    isDockerTtySensitive = true;
    if (composeSubCmd === 'exec') isComposeExec = true;
    if (composeSubCmd === 'run') isComposeRun = true;
  } else if (isComposePlugin && (composeSubCmd === 'run' || composeSubCmd === 'exec')) {
    isDockerTtySensitive = true;
    if (composeSubCmd === 'exec') isComposeExec = true;
    if (composeSubCmd === 'run') isComposeRun = true;
  }

  if (dockerCmds.includes(cmdBasename) && subCmd === 'login') {
    if (!args.includes('-u') && !args.includes('--username') && !args.includes('--password-stdin')) {
      console.error(`\n   💡 AGENT HINT: 'docker login' called without credentials (-u or --password-stdin).\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang waiting for a username. Blocking execution.`);
      process.exit(1);
    }
    if (args.includes('--password-stdin') && (!payload.stdin || payload.stdin.trim().length === 0)) {
      console.error(`\n   💡 AGENT HINT: 'docker login --password-stdin' requires credentials via stdin.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   You provided the flag but no valid 'stdin' payload. Blocking execution to prevent hanging.`);
      process.exit(1);
    }
  }

  if (dockerCmds.includes(cmdBasename) && subCmd === 'plugin' && args.includes('install')) {
    if (!args.includes('--grant-all-permissions')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker plugin install' asks for confirmation. Automatically injecting '--grant-all-permissions'... (Frictionless Recovery)`);
      args.push('--grant-all-permissions');
    }
  }

  if (dockerCmds.includes(cmdBasename) && subCmd === 'start') {
    if (args.includes('-i') || args.includes('--interactive') || args.includes('-a') || args.includes('--attach')) {
      console.error(`\n   💡 AGENT HINT: 'docker start' with interactive/attach flags will hang indefinitely. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }

  if (dockerCmds.includes(cmdBasename) && subCmd === 'attach') {
    console.error(`\n   💡 AGENT HINT: 'docker attach' inherently connects stdio to the container and hangs in non-interactive modes. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }

  if (dockerCmds.includes(cmdBasename) && !isComposePlugin) {
    if (subCmd === 'events' || subCmd === 'wait' || (subCmd === 'system' && args.includes('events')) || (subCmd === 'stats' && !args.includes('--no-stream'))) {
       console.error(`\n   💡 AGENT HINT: 'docker ${subCmd}' runs indefinitely or blocks execution. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
       process.exit(1);
    }
  }

  const isLogsCmd = 
    (dockerCmds.includes(cmdBasename) && !isComposePlugin && subCmd === 'logs') ||
    (dockerComposeCmds.includes(cmdBasename) && composeSubCmd === 'logs') ||
    (isComposePlugin && composeSubCmd === 'logs');

  if (isLogsCmd) {
    const hasFollow = args.some(a => a === '-f' || a === '--follow' || a.startsWith('--follow='));
    if (hasFollow) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} logs -f' runs indefinitely and will cause a timeout. Automatically stripping '-f / --follow' flag... (Frictionless Recovery)`);
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i] === '-f' || args[i] === '--follow' || args[i].startsWith('--follow=')) args.splice(i, 1);
      }
    }
  }

  const isUpCmd = 
    (isComposePlugin && composeSubCmd === 'up') ||
    (dockerComposeCmds.includes(cmdBasename) && composeSubCmd === 'up');

  if (isUpCmd) {
    const hasDetach = args.some(a => a === '-d' || a === '--detach');
    if (!hasDetach) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up' was called without '-d' or '--detach'. Automatically appending '-d' flag to prevent indefinite blocking... (Frictionless Recovery)`);
      args.push('-d');
    }
    const watchIdx = args.findIndex(a => a === '--watch');
    if (watchIdx !== -1) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up --watch' runs indefinitely and will cause a timeout. Automatically stripping '--watch' flag... (Frictionless Recovery)`);
      args.splice(watchIdx, 1);
    }
  }

  const isWatchCmd = 
    (isComposePlugin && composeSubCmd === 'watch') ||
    (dockerComposeCmds.includes(cmdBasename) && composeSubCmd === 'watch');

  if (isWatchCmd) {
    console.error(`\n   💡 AGENT HINT: 'docker compose watch' runs indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please run this command manually in a separate terminal if you need live syncing.`);
    process.exit(1);
  }

  const isComposeWaitCmd = 
    (isComposePlugin && composeSubCmd === 'wait') ||
    (dockerComposeCmds.includes(cmdBasename) && composeSubCmd === 'wait');

  if (isComposeWaitCmd) {
    console.error(`\n   💡 AGENT HINT: 'docker compose wait' blocks execution indefinitely. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }

  const isRmCmd = 
    (isComposePlugin && composeSubCmd === 'rm') ||
    (dockerComposeCmds.includes(cmdBasename) && composeSubCmd === 'rm');

  if (isRmCmd) {
    const hasForce = args.some(a => a === '-f' || a === '--force');
    if (!hasForce) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose rm' asks for confirmation. Automatically appending '-f' flag to prevent indefinite blocking... (Frictionless Recovery)`);
      args.push('-f');
    }
  }

  const pruneCategories = ['system', 'image', 'volume', 'network', 'container', 'builder'];
  if (dockerCmds.includes(cmdBasename) && pruneCategories.includes(subCmd) && args.includes('prune')) {
    if (!args.includes('-f') && !args.includes('--force')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker ${subCmd} prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
      args.push('-f');
    }
  }

  if (isBuildxPlugin && buildxSubCmd === 'prune') {
    if (!args.includes('-f') && !args.includes('--force')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker buildx prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
      args.push('-f');
    }
  }

  if (isDockerTtySensitive) {
    const dockerValueFlags = ['-v', '--volume', '-p', '--publish', '--name', '-e', '--env', '--env-file', '--build-arg', '-f', '--file', '-w', '--workdir', '-u', '--user', '--network', '--entrypoint', '-m', '--memory', '--cpus', '--label', '--hostname', '--add-host', '--dns', '--cap-add', '--cap-drop', '--device', '--log-driver', '--log-opt', '--restart', '--mount', '--tmpfs', '--ulimit', '--pid', '--ipc', '--uts', '--userns', '--cgroupns', '--runtime', '--isolation', '--security-opt', '--storage-opt', '--sysctl', '--link', '--health-cmd', '--health-interval', '--health-retries', '--health-timeout', '--stop-signal', '--stop-timeout', '--shm-size', '--gpus', '--ip', '--ip6', '--mac-address', '--init', '--read-only', '--sig-proxy', '--platform', '--pull', '-l', '-h', '--group-add', '--expose', '--domainname', '--blkio-weight', '--cidfile', '--cgroup-parent'];
    
    const hasTtyFlag = args.some(arg => 
      /^-([a-zA-Z]*[ti][a-zA-Z]*)$/.test(arg) || 
      arg.startsWith('--tty') || 
      arg.startsWith('--interactive')
    );
    if (hasTtyFlag) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: You attempted to run a Docker command with a TTY flag. Because 'agent-exec.ts' uses \`shell: false\` and pipes stdio, TTY allocation is NOT supported. Automatically stripping TTY flags (-t, --tty) to prevent process hanging... (Frictionless Recovery)`);
      
      const requiresInteractive = !!payload.stdin;
      if (!requiresInteractive) {
         console.error(`   Also stripping interactive flags (-i, --interactive) since no stdin payload was provided.`);
      }

      let stopStripping = false;
      let seenRunOrExec = false;
      
      const newArgs = [];
      for (let i = 0; i < args.length; i++) {
         const arg = args[i];
         if (stopStripping) { newArgs.push(arg); continue; }
         
         if (!seenRunOrExec) {
            if (arg === 'run' || arg === 'exec') seenRunOrExec = true;
            newArgs.push(arg);
            continue;
         }
         
         if (!arg.startsWith('-')) {
            const prev = args[i-1];
            if (!dockerValueFlags.includes(prev)) stopStripping = true;
            newArgs.push(arg);
            continue;
         }

         if (arg === '--tty' || arg === '-t' || arg.startsWith('--tty=')) continue;
         if (arg === '--interactive' || arg === '-i' || arg.startsWith('--interactive=')) {
            if (requiresInteractive) newArgs.push(arg);
            continue;
         }
         if (/^-([a-zA-Z]*[ti][a-zA-Z]*)$/.test(arg)) {
             let newArg = arg.replace(/t/g, '');
             if (!requiresInteractive) newArg = newArg.replace(/i/g, '');
             if (newArg !== '-') newArgs.push(newArg);
             continue;
         }
         newArgs.push(arg);
      }
      
      // Update args array in place
      args.length = 0;
      args.push(...newArgs);
    }

    if ((isComposeExec || isComposeRun) && !args.includes('-T')) {
      const targetCmd = isComposeExec ? 'exec' : 'run';
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-T' into docker compose ${targetCmd} to forcefully disable TTY allocation... (Frictionless Recovery)`);
      const targetIndex = args.indexOf(targetCmd);
      if (targetIndex !== -1) {
        args.splice(targetIndex + 1, 0, '-T');
      }
    }

    // Container Shell/REPL Detection: Block headless hangs when docker exec/run
    // targets a known interactive shell or REPL without execution flags.
    const containerShells = ['bash', 'sh', 'zsh', 'ash', 'dash', 'fish', 'csh', 'tcsh', 'ksh'];
    const containerRepls = ['python', 'python3', 'node', 'ruby', 'irb', 'perl', 'lua', 'php', 'ghci', 'erl', 'iex', 'scala', 'clojure', 'r', 'R'];
    const containerDbRepls = ['psql', 'mysql', 'sqlite3', 'mongo', 'mongosh', 'redis-cli'];
    const allContainerRepls = [...containerShells, ...containerRepls, ...containerDbRepls];

    let foundRunExec = false;
    let skipNextValue = false;
    let containerName: string | null = null;
    let containerCmd: string | null = null;
    const containerCmdArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!foundRunExec) {
        if (arg === 'run' || arg === 'exec') foundRunExec = true;
        continue;
      }
      if (skipNextValue) { skipNextValue = false; continue; }
      if (arg === '-T' || arg === '--no-TTY') continue;
      if (!containerCmd && arg.startsWith('-')) {
        if (dockerValueFlags.includes(arg) || (arg.startsWith('--') && arg.includes('='))) {
          if (!arg.includes('=')) skipNextValue = true;
        }
        continue;
      }
      if (!containerName) { containerName = arg; continue; }
      if (!containerCmd) { containerCmd = arg; continue; }
      containerCmdArgs.push(arg);
    }

    if (containerCmd && allContainerRepls.includes(containerCmd)) {
      const shellExecFlags = ['-c', '--command'];
      const dbExecFlags = ['-c', '--command', '-e', '--execute', '--eval', '-f', '--file'];
      let hasExecFlag = containerDbRepls.includes(containerCmd)
        ? containerCmdArgs.some(a => dbExecFlags.includes(a))
        : containerCmdArgs.some(a => shellExecFlags.includes(a));

      // Exception for sqlite3 which can take a query directly without flags
      if (containerCmd === 'sqlite3') {
        const nonFlags = containerCmdArgs.filter(a => !a.startsWith('-'));
        if (nonFlags.length >= 2) {
          hasExecFlag = true;
        }
      }

      if (!hasExecFlag && !payload.stdin) {
        console.error(`\n   💡 AGENT HINT: 'docker ... ${containerCmd}' targets an interactive shell/REPL inside the container.\n${AUTONOMOUS_HEALING_MSG}`);
        console.error(`   Without execution flags (e.g., -c 'command') or stdin, it will hang indefinitely.`);
        console.error(`   Please provide a command to execute: e.g., docker exec <container> ${containerCmd} -c 'your command'`);
        process.exit(1);
      }
    }
  }
}
