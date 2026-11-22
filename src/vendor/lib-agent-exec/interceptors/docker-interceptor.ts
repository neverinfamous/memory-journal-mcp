// @ts-nocheck
import { AUTONOMOUS_HEALING_MSG } from '../utils.js';
import {
  DOCKER_GLOBAL_VALUE_FLAGS,
  applyDockerWslRoutingAndTimeouts,
  handleKubectlInterception,
  splitDockerMultiTargets,
} from './docker-lifecycle-guards.js';
import { DOCKER_VALUE_FLAGS, guardDockerTtyAndRepl } from './docker-tty-repl-guard.js';
import { ExecutionContext } from './types.js';

const DOCKER_RUN_EXEC_VALUE_FLAG_SET: ReadonlySet<string> = new Set(DOCKER_VALUE_FLAGS);
const DOCKER_CMDS = ['docker', 'docker.exe', 'docker.bat'];
const DOCKER_COMPOSE_CMDS = ['docker-compose', 'docker-compose.exe', 'docker-compose.bat'];
const KUBECTL_CMDS = ['kubectl', 'kubectl.exe'];
const COMPOSE_GLOBAL_VALUE_FLAGS = new Set(['-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory', '--progress', '--ansi']);
const PRUNE_CATEGORIES = ['system', 'image', 'volume', 'network', 'container', 'builder'];
const MULTI_TARGET_SUBCMDS = ['inspect', 'stop', 'start', 'restart', 'rm', 'rmi', 'kill', 'pause', 'unpause'];

function isLeadingDockerHelp(args: readonly string[], isComposeCmd: boolean): boolean {
  let firstSub: string | undefined;
  let inRunOrExec = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--help' || (firstSub === undefined && a === '-h')) return true;
    const activeFlags = inRunOrExec
      ? DOCKER_RUN_EXEC_VALUE_FLAG_SET
      : ((isComposeCmd || firstSub === 'compose') ? COMPOSE_GLOBAL_VALUE_FLAGS : DOCKER_GLOBAL_VALUE_FLAGS);
    if (activeFlags.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (inRunOrExec) return false;
    if (firstSub === undefined) {
      firstSub = a;
      if (a === 'run' || a === 'exec') inRunOrExec = true;
      continue;
    }
    if ((firstSub === 'container' || firstSub === 'compose') && (a === 'run' || a === 'exec')) {
      inRunOrExec = true;
    }
  }
  return false;
}

function walkSubcommands(args: readonly string[], startIdx: number, valueFlags: ReadonlySet<string>): { pos: string[]; idx: number } {
  const pos: string[] = [];
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    pos.push(a);
    return { pos, idx: i };
  }
  return { pos, idx: -1 };
}

function collectRemainingPositionals(args: readonly string[], startIdx: number, valueFlags: ReadonlySet<string>): string[] {
  const pos: string[] = [];
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (valueFlags.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    pos.push(a);
  }
  return pos;
}

function injectPlainProgressIfMissing(args: string[]): void {
  if (!args.includes('--progress=plain') && !args.includes('--progress')) args.push('--progress=plain');
}

function stripFollowFromLogsArgs(args: string[], startIdx: number, endIdx: number): boolean {
  let stripped = false;
  for (let i = endIdx - 1; i >= startIdx; i--) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '-f' || a === '--follow' || a.startsWith('--follow=')) {
      args.splice(i, 1);
      stripped = true;
    } else if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) {
      const rest = a.replace(/f/g, '');
      if (rest === '-') args.splice(i, 1);
      else args[i] = rest;
      stripped = true;
    }
  }
  return stripped;
}

function handleDockerLogsCmd(cmdBasename: string, args: string[], ctx: ExecutionContext, resolvedLogsIdx?: number): void {
  const logsIdx = resolvedLogsIdx !== undefined && resolvedLogsIdx >= 0 ? resolvedLogsIdx : args.indexOf('logs');
  const startIdx = logsIdx !== -1 ? logsIdx + 1 : 0;
  const ddIdx = args.indexOf('--', startIdx);
  const endIdx = ddIdx === -1 ? args.length : ddIdx;
  if (stripFollowFromLogsArgs(args, startIdx, endIdx)) {
    if (ctx.payload.type === 'command') ctx.payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} logs -f' runs indefinitely and will cause a timeout. Automatically stripping '-f / --follow' flag... (Frictionless Recovery)`);
  }
  const postLogsDd = args.indexOf('--', startIdx);
  const postLogsSlice = args.slice(startIdx, postLogsDd === -1 ? args.length : postLogsDd);
  const hasTailOrLimit = postLogsSlice.some(a =>
    a === '--tail' || a.startsWith('--tail=') || a === '-n' || a.startsWith('-n=') ||
    a === '--since' || a.startsWith('--since=') || a === '--until' || a.startsWith('--until=')
  );
  if (!hasTailOrLimit) {
    if (logsIdx !== -1) args.splice(logsIdx + 1, 0, '--tail', '1000');
    else args.push('--tail', '1000');
    if (ctx.payload.type === 'command') ctx.payload.args = args;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: '${cmdBasename} logs' called without a limit. Automatically appending '--tail 1000' to prevent output from exceeding maxBuffer... (Frictionless Recovery)\x1b[0m`);
  }
}

function hasDockerStartInteractiveFlag(args: readonly string[]): boolean {
  const startIdx = args.indexOf('start');
  const start = startIdx !== -1 ? startIdx + 1 : 0;
  for (let i = start; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--detach-keys' || a === '--checkpoint' || a === '--checkpoint-dir') { i++; continue; }
    if (a === '--interactive' || a === '--attach' || (!a.startsWith('--') && /^-[a-zA-Z]*[ia][a-zA-Z]*$/.test(a))) return true;
  }
  return false;
}

function guardDockerComposeSubcmd(
  ctx: ExecutionContext,
  args: string[],
  composeSubCmd: string | undefined,
  composeSubIdx: number,
): void {
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  if (composeSubCmd === 'up') {
    if (!args.includes('-d') && !args.includes('--detach')) {
      args.push('-d');
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up' was called without '-d' or '--detach'. Automatically appending '-d' flag to prevent indefinite blocking... (Frictionless Recovery)`);
    }
    const ddIdx = args.indexOf('--', Math.max(0, composeSubIdx + 1));
    const endIdx = ddIdx === -1 ? args.length : ddIdx;
    let strippedWatch = false;
    for (let i = endIdx - 1; i > composeSubIdx; i--) {
      const a = args[i];
      if (a === undefined) continue;
      if (a === '--watch' || a === '-w') {
        args.splice(i, 1);
        strippedWatch = true;
      } else if (/^-[dVw]*w[dVw]*$/.test(a)) {
        const rest = a.replace(/w/g, '');
        if (rest === '-') args.splice(i, 1);
        else args[i] = rest;
        strippedWatch = true;
      }
    }
    if (strippedWatch) {
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose up --watch' runs indefinitely and will cause a timeout. Automatically stripping '--watch / -w' flag... (Frictionless Recovery)`);
    }
  }
  if (composeSubCmd === 'watch') {
    console.error(`\n   💡 AGENT HINT: 'docker compose watch' runs indefinitely.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang indefinitely.`);
    console.error(`   Please run this command manually in a separate terminal if you need live syncing.`);
    process.exit(1);
  }
  if (composeSubCmd === 'wait' || composeSubCmd === 'attach' || composeSubCmd === 'events' || (composeSubCmd === 'stats' && !args.includes('--no-stream'))) {
    console.error(`\n   💡 AGENT HINT: 'docker compose ${composeSubCmd}' blocks or streams indefinitely. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  const afterComposeRm = composeSubIdx >= 0 ? args.slice(composeSubIdx + 1) : args;
  if (composeSubCmd === 'rm' && !afterComposeRm.includes('-f') && !afterComposeRm.includes('--force')) {
    args.push('-f');
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker compose rm' asks for confirmation. Automatically appending '-f' flag to prevent indefinite blocking... (Frictionless Recovery)`);
  }
}

function guardNonInteractiveDockerSubcmds(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  subCmd: string | undefined,
  composeSubCmd: string | undefined,
  composeSubIdx: number,
  buildxSubCmd: string | undefined,
  containerSubCmd: string | undefined,
  secondSubPos: string | undefined,
  resolvedLogsIdx: number,
  isComposePlugin: boolean,
  isBuildxPlugin: boolean,
  isDockerCmd: boolean,
  isComposeCmd: boolean,
  stdin: string | undefined,
): void {
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  const targetSub = isDockerCmd && subCmd === 'container' ? containerSubCmd : subCmd;
  if (isDockerCmd && subCmd === 'login') {
    const hasUsername = args.some(a => a === '-u' || a === '--username' || a.startsWith('--username=') || a.startsWith('-u=') || (a.startsWith('-u') && !a.startsWith('--') && a.length > 2));
    const hasPasswordStdin = args.includes('--password-stdin');
    const hasPasswordFlag = args.some(a => a === '-p' || a === '--password' || a.startsWith('--password=') || a.startsWith('-p=') || (a.startsWith('-p') && !a.startsWith('--') && a.length > 2));
    if (!hasUsername && !hasPasswordStdin) {
      console.error(`\n   💡 AGENT HINT: 'docker login' called without credentials (-u or --password-stdin).\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   Because 'agent-exec.ts' is non-interactive, this will hang waiting for a username. Blocking execution.`);
      process.exit(1);
    }
    if (hasPasswordStdin && (!stdin || stdin.trim().length === 0)) {
      console.error(`\n   💡 AGENT HINT: 'docker login --password-stdin' requires credentials via stdin.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   You provided the flag but no valid 'stdin' payload. Blocking execution to prevent hanging.`);
      process.exit(1);
    }
    if (!hasPasswordStdin && !hasPasswordFlag) {
      console.error(`\n   💡 AGENT HINT: 'docker login' without --password or --password-stdin will prompt for a password interactively. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
      process.exit(1);
    }
  }
  if (isDockerCmd && subCmd === 'plugin' && args.includes('install') && !args.includes('--grant-all-permissions')) {
    args.push('--grant-all-permissions');
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker plugin install' asks for confirmation. Automatically injecting '--grant-all-permissions'... (Frictionless Recovery)`);
  }
  if (isDockerCmd && targetSub === 'start' && hasDockerStartInteractiveFlag(args)) {
    console.error(`\n   💡 AGENT HINT: 'docker start' with interactive/attach flags will hang indefinitely. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (isDockerCmd && targetSub === 'attach') {
    console.error(`\n   💡 AGENT HINT: 'docker attach' inherently connects stdio to the container and hangs in non-interactive modes. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (isDockerCmd && !isComposePlugin && (targetSub === 'events' || targetSub === 'wait' || (subCmd === 'system' && args.includes('events')) || (targetSub === 'stats' && !args.includes('--no-stream')))) {
    console.error(`\n   💡 AGENT HINT: 'docker ${targetSub}' runs indefinitely or blocks execution. Blocking execution to prevent hanging.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }

  const isComposeOrPlugin = isComposePlugin || isComposeCmd;
  if ((isDockerCmd && !isComposePlugin && targetSub === 'logs') || (isComposeOrPlugin && composeSubCmd === 'logs')) {
    handleDockerLogsCmd(cmdBasename, args, ctx, resolvedLogsIdx);
  }
  if (isComposeOrPlugin) guardDockerComposeSubcmd(ctx, args, composeSubCmd, composeSubIdx);
  if (isDockerCmd && subCmd !== undefined && PRUNE_CATEGORIES.includes(subCmd) && secondSubPos === 'prune') {
    if (!args.includes('-f') && !args.includes('--force')) {
      args.push('-f');
      syncArgs();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker ${subCmd} prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
    }
  }
  if (isBuildxPlugin && buildxSubCmd === 'prune' && !args.includes('-f') && !args.includes('--force')) {
    args.push('-f');
    syncArgs();
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'docker buildx prune' asks for confirmation. Automatically injecting '-f' to prevent hanging... (Frictionless Recovery)`);
  }
}

export function dockerInterceptor(ctx: ExecutionContext): void {
  const { cmdBasename, args, payload } = ctx;
  if (KUBECTL_CMDS.includes(cmdBasename)) {
    handleKubectlInterception(args, ctx);
    return;
  }

  const isDockerCmd = DOCKER_CMDS.includes(cmdBasename);
  const isComposeCmd = DOCKER_COMPOSE_CMDS.includes(cmdBasename);
  if (!isDockerCmd && !isComposeCmd) return;
  if (isLeadingDockerHelp(args, isComposeCmd)) return;

  const firstInfo = walkSubcommands(args, 0, isComposeCmd ? COMPOSE_GLOBAL_VALUE_FLAGS : DOCKER_GLOBAL_VALUE_FLAGS);
  const subCmd = isDockerCmd ? firstInfo.pos[0] : undefined;
  const isComposePlugin = isDockerCmd && subCmd === 'compose';
  const isBuildxPlugin = isDockerCmd && subCmd === 'buildx';

  const composeInfo = isComposePlugin
    ? walkSubcommands(args, firstInfo.idx + 1, COMPOSE_GLOBAL_VALUE_FLAGS)
    : (isComposeCmd ? firstInfo : { pos: [], idx: -1 });
  const composeSubCmd = composeInfo.pos[0];
  const buildxSubCmd = isBuildxPlugin
    ? walkSubcommands(args, firstInfo.idx + 1, new Set(['--builder'])).pos[0]
    : undefined;
  const secondInfo = (isDockerCmd && subCmd !== undefined && PRUNE_CATEGORIES.includes(subCmd))
    ? walkSubcommands(args, firstInfo.idx + 1, new Set())
    : { pos: [], idx: -1 };
  const secondSubPos = secondInfo.pos[0];
  const containerSubCmd = subCmd === 'container' ? secondSubPos : undefined;
  const remainingDockerPos = (isDockerCmd && subCmd !== undefined && !isComposePlugin)
    ? collectRemainingPositionals(args, firstInfo.idx + 1, new Set())
    : [];
  const effectiveSub = subCmd;

  const isDockerBuild = (isDockerCmd && effectiveSub === 'build') ||
    (isBuildxPlugin && buildxSubCmd === 'build') ||
    ((isComposeCmd || isComposePlugin) && composeSubCmd === 'build');
  if (isDockerBuild) injectPlainProgressIfMissing(args);

  const isDockerScout = isDockerCmd && effectiveSub === 'scout';
  applyDockerWslRoutingAndTimeouts(ctx, isDockerBuild, isDockerScout);

  const isComposeOrPlugin = isComposePlugin || isComposeCmd;
  const resolvedLogsIdx = isComposeOrPlugin
    ? composeInfo.idx
    : (subCmd === 'container' ? secondInfo.idx : firstInfo.idx);
  guardNonInteractiveDockerSubcmds(
    ctx, cmdBasename, args, effectiveSub, composeSubCmd, composeInfo.idx,
    buildxSubCmd, containerSubCmd, secondSubPos, resolvedLogsIdx,
    isComposePlugin, isBuildxPlugin, isDockerCmd, isComposeCmd, payload.stdin,
  );

  if (isDockerCmd && !isComposePlugin && !isBuildxPlugin && effectiveSub !== undefined && MULTI_TARGET_SUBCMDS.includes(effectiveSub)) {
    splitDockerMultiTargets(args, effectiveSub, ctx);
  }

  const isContainerExec = (isDockerCmd && !isComposePlugin && (effectiveSub === 'run' || effectiveSub === 'exec' || (effectiveSub === 'container' && (containerSubCmd === 'run' || containerSubCmd === 'exec' || remainingDockerPos[0] === 'run' || remainingDockerPos[0] === 'exec')))) ||
    (isComposeOrPlugin && (composeSubCmd === 'run' || composeSubCmd === 'exec'));
  if (isContainerExec) {
    const runExecIdx = isComposeOrPlugin
      ? composeInfo.idx
      : (effectiveSub === 'container' ? secondInfo.idx : firstInfo.idx);
    guardDockerTtyAndRepl(
      ctx,
      isComposeOrPlugin && composeSubCmd === 'exec',
      isComposeOrPlugin && composeSubCmd === 'run',
      runExecIdx >= 0 ? runExecIdx : undefined,
    );
  }
}
