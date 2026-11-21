// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import {
  applyDockerWslRoutingAndTimeouts,
  handleKubectlInterception,
  splitDockerMultiTargets,
} from './docker-lifecycle-guards.js';
import { guardDockerTtyAndRepl } from './docker-tty-repl-guard.js';
import { ExecutionContext } from './types.js';

const DOCKER_CMDS = ['docker', 'docker.exe', 'docker.bat'];
const DOCKER_COMPOSE_CMDS = ['docker-compose', 'docker-compose.exe', 'docker-compose.bat'];
const KUBECTL_CMDS = ['kubectl', 'kubectl.exe'];
const KNOWN_DOCKER_CMDS = ['compose', 'buildx', 'run', 'exec', 'logs', 'build', 'up', 'down', 'start', 'stop', 'restart', 'ps', 'pull', 'push', 'images', 'rm', 'rmi', 'network', 'volume', 'system', 'info', 'version', 'inspect', 'cp', 'export', 'import', 'save', 'load', 'login', 'logout', 'search', 'tag', 'history', 'commit', 'events', 'port', 'top', 'stats', 'attach', 'wait', 'rename', 'update', 'kill', 'pause', 'unpause', 'create', 'plugin'];
const KNOWN_COMPOSE_CMDS = ['up', 'down', 'run', 'exec', 'logs', 'build', 'start', 'stop', 'restart', 'ps', 'pull', 'push', 'config', 'cp', 'create', 'events', 'images', 'kill', 'ls', 'pause', 'port', 'rm', 'top', 'unpause', 'wait', 'watch'];
const PRUNE_CATEGORIES = ['system', 'image', 'volume', 'network', 'container', 'builder'];
const MULTI_TARGET_SUBCMDS = ['inspect', 'stop', 'start', 'restart', 'rm', 'rmi', 'kill', 'pause', 'unpause'];

function injectPlainProgressIfMissing(args: string[]): void {
  if (!args.includes('--progress=plain') && !args.includes('--progress')) args.push('--progress=plain');
}

function handleDockerLogsCmd(cmdBasename: string, args: string[]): void {
  if (args.some(a => a === '-f' || a === '--follow' || a.startsWith('--follow='))) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} logs -f' runs indefinitely and will cause a timeout. Automatically stripping '-f / --follow' flag... (Frictionless Recovery)`);
    for (let i = args.length - 1; i >= 0; i--) {
      const a = args[i];
      if (a === '-f' || a === '--follow' || (a !== undefined && a.startsWith('--follow='))) args.splice(i, 1);
    }
  }
  const hasTailOrLimit = args.some(a =>
    a === '--tail' || a.startsWith('--tail=') || a === '-n' || a.startsWith('-n=') ||
    a === '--since' || a.startsWith('--since=') || a === '--until' || a.startsWith('--until=')
  );
  if (!hasTailOrLimit) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} logs' called without a limit. Automatically appending '--tail 1000' to prevent output from exceeding maxBuffer... (Frictionless Recovery)\x1b[0m`);
    const logsIdx = args.indexOf('logs');
    if (logsIdx !== -1) args.splice(logsIdx + 1, 0, '--tail', '1000');
    else args.push('--tail', '1000');
  }
}

function guardDockerComposeSubcmd(
  args: string[],
  composeSubCmd: string | undefined,
): void {
  if (composeSubCmd === 'up') {
    if (!args.includes('-d') && !args.includes('--detach')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up' was called without '-d' or '--detach'. Automatically appending '-d' flag to prevent indefinite blocking... (Frictionless Recovery)`);
      args.push('-d');
    }
    const watchIdx = args.indexOf('--watch');
    if (watchIdx !== -1) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up --watch' runs indefinitely and will cause a timeout. Automatically stripping '--watch' flag... (Frictionless Recovery)`);
      args.splice(watchIdx, 1);
    }
  }
  if (composeSubCmd === 'watch') {
    console.error(`\n   💡 AGENT HINT: 'docker compose watch' runs indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please run this command manually in a separate terminal if you need live syncing.`);
    process.exit(1);
  }
  if (composeSubCmd === 'wait') {
    console.error(`\n   💡 AGENT HINT: 'docker compose wait' blocks execution indefinitely. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (composeSubCmd === 'rm' && !args.includes('-f') && !args.includes('--force')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose rm' asks for confirmation. Automatically appending '-f' flag to prevent indefinite blocking... (Frictionless Recovery)`);
    args.push('-f');
  }
}

function guardNonInteractiveDockerSubcmds(
  cmdBasename: string,
  args: string[],
  subCmd: string | undefined,
  composeSubCmd: string | undefined,
  buildxSubCmd: string | undefined,
  isComposePlugin: boolean,
  isBuildxPlugin: boolean,
  isDockerCmd: boolean,
  isComposeCmd: boolean,
  stdin: string | undefined,
): void {
  if (isDockerCmd && subCmd === 'login') {
    if (!args.includes('-u') && !args.includes('--username') && !args.includes('--password-stdin')) {
      console.error(`\n   💡 AGENT HINT: 'docker login' called without credentials (-u or --password-stdin).\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang waiting for a username. Blocking execution.`);
      process.exit(1);
    }
    if (args.includes('--password-stdin') && (!stdin || stdin.trim().length === 0)) {
      console.error(`\n   💡 AGENT HINT: 'docker login --password-stdin' requires credentials via stdin.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   You provided the flag but no valid 'stdin' payload. Blocking execution to prevent hanging.`);
      process.exit(1);
    }
  }
  if (isDockerCmd && subCmd === 'plugin' && args.includes('install') && !args.includes('--grant-all-permissions')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker plugin install' asks for confirmation. Automatically injecting '--grant-all-permissions'... (Frictionless Recovery)`);
    args.push('--grant-all-permissions');
  }
  if (isDockerCmd && subCmd === 'start' && (args.includes('-i') || args.includes('--interactive') || args.includes('-a') || args.includes('--attach'))) {
    console.error(`\n   💡 AGENT HINT: 'docker start' with interactive/attach flags will hang indefinitely. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (isDockerCmd && subCmd === 'attach') {
    console.error(`\n   💡 AGENT HINT: 'docker attach' inherently connects stdio to the container and hangs in non-interactive modes. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (isDockerCmd && !isComposePlugin && (subCmd === 'events' || subCmd === 'wait' || (subCmd === 'system' && args.includes('events')) || (subCmd === 'stats' && !args.includes('--no-stream')))) {
    console.error(`\n   💡 AGENT HINT: 'docker ${subCmd}' runs indefinitely or blocks execution. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }

  const isComposeOrPlugin = isComposePlugin || isComposeCmd;
  if ((isDockerCmd && !isComposePlugin && subCmd === 'logs') || (isComposeOrPlugin && composeSubCmd === 'logs')) {
    handleDockerLogsCmd(cmdBasename, args);
  }
  if (isComposeOrPlugin) guardDockerComposeSubcmd(args, composeSubCmd);
  if (isDockerCmd && subCmd !== undefined && PRUNE_CATEGORIES.includes(subCmd) && args.includes('prune')) {
    if (!args.includes('-f') && !args.includes('--force')) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker ${subCmd} prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
      args.push('-f');
    }
  }
  if (isBuildxPlugin && buildxSubCmd === 'prune' && !args.includes('-f') && !args.includes('--force')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker buildx prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
    args.push('-f');
  }
}

export function dockerInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  if (KUBECTL_CMDS.includes(cmdBasename)) {
    handleKubectlInterception(args);
    return;
  }

  const isDockerCmd = DOCKER_CMDS.includes(cmdBasename);
  const isComposeCmd = DOCKER_COMPOSE_CMDS.includes(cmdBasename);
  if (!isDockerCmd && !isComposeCmd) return;

  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const subCmd = isDockerCmd ? (args.find(a => KNOWN_DOCKER_CMDS.includes(a)) ?? positionalArgs[0]) : positionalArgs[0];
  const isComposePlugin = isDockerCmd && subCmd === 'compose';
  const isBuildxPlugin = isDockerCmd && subCmd === 'buildx';

  const composeSubCmd = isComposePlugin
    ? (args.slice(args.indexOf('compose') + 1).find(a => KNOWN_COMPOSE_CMDS.includes(a)) ?? positionalArgs[1])
    : (isComposeCmd ? (args.find(a => KNOWN_COMPOSE_CMDS.includes(a)) ?? positionalArgs[0]) : undefined);
  const buildxSubCmd = isBuildxPlugin
    ? args.slice(args.indexOf('buildx') + 1).filter(a => !a.startsWith('-'))[0]
    : undefined;

  const isDockerBuild = (isDockerCmd && subCmd === 'build') ||
    (isBuildxPlugin && buildxSubCmd === 'build') ||
    ((isComposeCmd || isComposePlugin) && composeSubCmd === 'build');
  if (isDockerBuild) injectPlainProgressIfMissing(args);

  const isDockerScout = isDockerCmd && (subCmd === 'scout' || args.includes('scout'));
  applyDockerWslRoutingAndTimeouts(ctx, isDockerBuild, isDockerScout);

  guardNonInteractiveDockerSubcmds(cmdBasename, args, subCmd, composeSubCmd, buildxSubCmd, isComposePlugin, isBuildxPlugin, isDockerCmd, isComposeCmd, payload.stdin);

  if (isDockerCmd && !isComposePlugin && !isBuildxPlugin && subCmd !== undefined && MULTI_TARGET_SUBCMDS.includes(subCmd)) {
    splitDockerMultiTargets(args, subCmd);
  }

  const isContainerExec = (isDockerCmd && !isComposePlugin && (subCmd === 'run' || subCmd === 'exec' || (subCmd === 'container' && (positionalArgs[1] === 'run' || positionalArgs[1] === 'exec')))) ||
    ((isComposeCmd || isComposePlugin) && (composeSubCmd === 'run' || composeSubCmd === 'exec'));
  if (isContainerExec) {
    const isCompose = isComposeCmd || isComposePlugin;
    guardDockerTtyAndRepl(ctx, isCompose && composeSubCmd === 'exec', isCompose && composeSubCmd === 'run');
  }
}
