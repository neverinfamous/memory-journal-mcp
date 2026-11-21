// @ts-nocheck
import fs from 'node:fs';
import { AUTONOMOUS_HEALING_MSG, emitInterceptBanner } from '../utils.js';
import type { ExecutionContext } from './types.js';

const KUBECTL_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-n', '--namespace', '--context', '--kubeconfig', '-l', '--selector',
  '--cluster', '--user', '--server', '-s', '--token',
  '--certificate-authority', '--client-certificate', '--client-key',
  '--request-timeout', '-v', '--v', '-o', '--output', '--as', '--as-group', '--cache-dir',
]);

function extractKubectlSubcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (KUBECTL_GLOBAL_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return undefined;
}

export function handleKubectlInterception(args: string[]): void {
  const subCmd = extractKubectlSubcommand(args);
  if (subCmd !== undefined && ['edit', 'attach', 'debug'].includes(subCmd)) {
    console.error(`\n   💡 AGENT HINT: 'kubectl ${subCmd}' is highly interactive and will hang. Blocking execution.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (subCmd !== 'logs') return;

  if (args.some(a => a === '-f' || a === '--follow')) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'kubectl logs -f' runs indefinitely and will cause a timeout. Automatically stripping '-f / --follow' flag... (Frictionless Recovery)`);
    for (let i = args.length - 1; i >= 0; i--) {
      if (args[i] === '-f' || args[i] === '--follow') args.splice(i, 1);
    }
  }

  const hasTailOrLimit = args.some(a =>
    a === '--tail' || a.startsWith('--tail=') || a === '--since' || a.startsWith('--since=')
  );
  if (!hasTailOrLimit) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'kubectl logs' called without a limit. Automatically appending '--tail 1000' to prevent output from exceeding maxBuffer... (Frictionless Recovery)`);
    const logsIdx = args.indexOf('logs');
    if (logsIdx !== -1) args.splice(logsIdx + 1, 0, '--tail', '1000');
    else args.push('--tail', '1000');
  }
}

function hasExplicitDockerHost(args: readonly string[], payloadEnv: Record<string, string> | undefined): boolean {
  if (args.some(a => a === '-H' || a === '--host' || a.startsWith('--host=') || a.startsWith('-H='))) return true;
  const hostVal = payloadEnv?.DOCKER_HOST ?? payloadEnv?.docker_host ?? process.env['DOCKER_HOST'];
  return typeof hostVal === 'string' && hostVal.trim().length > 0;
}

export function normalizeWslDockerBinaryName(ctx: ExecutionContext): void {
  const lower = ctx.cmdBasename.toLowerCase();
  let normalized: string | null = null;
  if (lower === 'docker.exe' || lower === 'docker.bat') normalized = 'docker';
  else if (lower === 'docker-compose.exe' || lower === 'docker-compose.bat') normalized = 'docker-compose';
  if (normalized === null) return;
  ctx.cmdBasename = normalized;
  if ('command' in ctx.payload) ctx.payload.command = normalized;
}

export function applyDockerWslRoutingAndTimeouts(
  ctx: ExecutionContext,
  isDockerBuild: boolean,
  isDockerScout: boolean,
): void {
  const { args, payload } = ctx;

  if (process.platform === 'win32' && payload.target !== 'wsl2') {
    if (isDockerScout) {
      emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'docker scout' on Windows Docker CLI experiences proxy timeouts while indexing images.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Switching execution target to WSL2 with 1800s timeout... (Frictionless Recovery)\x1b[0m`);
      payload.target = 'wsl2';
      payload.bypassInterceptors = true;
      payload.timeoutMs = Math.max(payload.timeoutMs ?? 0, 1800000);
      normalizeWslDockerBinaryName(ctx);
      return;
    }
    if (!hasExplicitDockerHost(args, payload.env) && !fs.existsSync('\\\\.\\pipe\\docker_engine')) {
      emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Windows Docker Desktop pipe not found; routing Docker command to WSL2 engine...`);
      payload.target = 'wsl2';
      normalizeWslDockerBinaryName(ctx);
    }
  } else if (payload.target === 'wsl2') {
    normalizeWslDockerBinaryName(ctx);
  }

  if (isDockerBuild || isDockerScout) {
    const minTimeout = isDockerScout ? 1800000 : 600000;
    const timeoutMsg = isDockerScout ? '1800s' : '600s';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout to ${timeoutMsg} for Docker ${isDockerScout ? 'scout' : 'build'}.`);
    payload.bypassInterceptors = true;
    if (payload.timeoutMs === undefined || payload.timeoutMs < minTimeout) {
      payload.timeoutMs = minTimeout;
    }
  }
}

const MULTI_TARGET_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-f', '--format', '--type', '-t', '--time', '--timeout',
  '-s', '--signal', '--detach-keys', '--context', '-c',
  '-H', '--host', '-l', '--log-level', '--config',
]);

export function splitDockerMultiTargets(args: string[], subCmd: string): void {
  const subCmdIdx = args.indexOf(subCmd);
  if (subCmdIdx === -1) return;
  const expandedArgs: string[] = args.slice(0, subCmdIdx + 1);
  let skipNext = false;
  let splitCount = 0;

  for (let i = subCmdIdx + 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (skipNext) { skipNext = false; expandedArgs.push(arg); continue; }
    if (arg.startsWith('-')) {
      if (MULTI_TARGET_VALUE_FLAGS.has(arg)) skipNext = true;
      expandedArgs.push(arg);
      continue;
    }
    const unquoted = arg.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    if (/\s/.test(unquoted) && /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*(?:\s+[a-zA-Z0-9][a-zA-Z0-9_./:@-]*)+$/.test(unquoted)) {
      const parts = unquoted.split(/\s+/).filter(Boolean);
      expandedArgs.push(...parts);
      splitCount += parts.length;
      continue;
    }
    expandedArgs.push(arg);
  }

  if (splitCount > 0) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected whitespace-joined target IDs in 'docker ${subCmd}'. Splitting into ${splitCount} individual arguments... (Frictionless Recovery)`);
    args.length = 0;
    args.push(...expandedArgs);
  }
}
