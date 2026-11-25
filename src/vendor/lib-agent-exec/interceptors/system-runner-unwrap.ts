// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath, healFragmentedQuotes } from '../command-utils.js';
import { nestedAgentExec } from './system-timeout-flags.js';
import type { ExecutionContext } from './types.js';

const PACKAGE_RUNNERS = ['bun', 'pnpm', 'npm', 'npx', 'yarn', 'bunx', 'pnpx', 'node', 'tsx', 'ts-node'];
const DIRECT_SHELLS = ['pwsh', 'powershell', 'cmd', 'bash', 'sh', 'wsl'];

export function healFragmentedQuoteArgs(ctx: ExecutionContext): void {
  const originalArgs = ctx.args;
  const cwd = ctx.payload.cwd ?? ctx.cwd;
  ctx.args = healFragmentedQuotes(ctx.args, cwd);
  const changed = ctx.args.length !== originalArgs.length || ctx.args.some((arg, idx) => arg !== originalArgs[idx]);
  if (!changed) return;
  if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
    ctx.payload.args = [...ctx.args];
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected fragmented quotes from PowerShell tokenization. Reassembling arguments... (Frictionless Recovery)\x1b[0m`);
}

const RUNNER_DIR_VALUE_FLAGS = new Set(['--cwd', '--dir', '-C', '--prefix']);
const RUNNER_SKIP_VALUE_FLAGS = new Set(['-p', '--package', '-r', '--require', '--import', '--preload', '--env-file', '--conditions', '--tsconfig', '--tsconfig-override']);
const RUNNER_UNWRAP_SUBCMDS = new Set(['run', 'exec', 'x', 'dlx']);
const JS_RUNTIME_RUNNERS = new Set(['bun', 'node', 'tsx', 'ts-node']);

function resolveUnwrapTargetDir(rawDir: string, ctx: ExecutionContext): string {
  const base = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
    ? ctx.payload.cwd
    : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? ctx.cwd : process.cwd());
  if (rawDir.startsWith('/') || rawDir.startsWith('~') || /^[a-zA-Z]:[/\\]/.test(rawDir)) return rawDir;
  if (base === '~' || base.startsWith('~/')) return path.posix.join(base, rawDir);
  if (base.startsWith('/')) return path.posix.resolve(base, rawDir);
  return path.resolve(base, rawDir);
}

export function unwrapPackageRunnerShell(ctx: ExecutionContext): void {
  const pkgBase = ctx.cmdBasename.toLowerCase().replace(/\.(exe|cmd)$/i, '');
  if (!PACKAGE_RUNNERS.includes(pkgBase)) return;
  const isJsRuntime = JS_RUNTIME_RUNNERS.has(pkgBase);
  let runIdx = 0;
  let sawSubcmd = false;
  let targetDir: string | undefined;
  while (runIdx < ctx.args.length) {
    const a = ctx.args[runIdx];
    if (a === undefined) break;
    if (a === '--') {
      if (!isJsRuntime || sawSubcmd) runIdx += 1;
      break;
    }
    const low = a.toLowerCase();
    if (low === '-e' || low === '--eval' || low === '--print' || low.startsWith('--eval=') || low.startsWith('--print=') || (isJsRuntime && low === '-p')) {
      return;
    }
    if (a === '--filter' || a === '-F' || a.startsWith('--filter=')) return;
    if (RUNNER_DIR_VALUE_FLAGS.has(a)) {
      targetDir = ctx.args[runIdx + 1];
      runIdx += 2;
      continue;
    }
    const dirEqMatch = /^(--(?:cwd|dir|prefix))=(.+)$/.exec(a);
    if (dirEqMatch?.[2] !== undefined) {
      targetDir = dirEqMatch[2];
      runIdx += 1;
      continue;
    }
    if (RUNNER_SKIP_VALUE_FLAGS.has(a)) { runIdx += 2; continue; }
    if (a.startsWith('-')) { runIdx += 1; continue; }
    if (!sawSubcmd && RUNNER_UNWRAP_SUBCMDS.has(low)) {
      sawSubcmd = true;
      runIdx += 1;
      continue;
    }
    break;
  }
  const possibleShell = ctx.args[runIdx]?.toLowerCase().replace(/\.(exe|cmd)$/i, '');
  if (possibleShell !== undefined && possibleShell.length > 0 && DIRECT_SHELLS.includes(possibleShell)) {
    rebindPackageRunnerToShell(ctx, possibleShell, runIdx, targetDir);
    return;
  }
  if (nestedAgentExec(ctx.args, runIdx)) {
    extendNestedAgentExec(ctx);
  }
}

function rebindPackageRunnerToShell(ctx: ExecutionContext, possibleShell: string, runIdx: number, targetDir?: string): void {
  const originalRunner = ctx.cmdBasename;
  ctx.cmdBasename = possibleShell;
  if (ctx.payload.type === 'command') {
    ctx.payload.command = possibleShell;
  }
  if (targetDir !== undefined && targetDir.trim().length > 0) {
    const resolvedDir = resolveUnwrapTargetDir(targetDir.trim(), ctx);
    ctx.payload.cwd = resolvedDir;
    ctx.cwd = resolvedDir;
  }
  ctx.args = ctx.args.slice(runIdx + 1);
  if (ctx.payload.type === 'command') {
    ctx.payload.args = ctx.args;
  }
  console.error(`\n   💡 AGENT HINT: Shell '${possibleShell}' invoked through package runner '${originalRunner}'.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Unwrapping package runner to execute shell directly with safety interceptors... (Frictionless Recovery)\x1b[0m`);
}

function extendNestedAgentExec(ctx: ExecutionContext): void {
  ctx.payload.bypassInterceptors = true;
  const rawPayloadCwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? ctx.payload.cwd : undefined;
  const hostPayloadCwd = rawPayloadCwd !== undefined
    ? (process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd)
        ? convertToWindowsPath(rawPayloadCwd)
        : (process.platform === 'win32' && rawPayloadCwd.startsWith('/') ? undefined : rawPayloadCwd))
    : undefined;
  const baseCwd = hostPayloadCwd ?? (ctx.cwd !== undefined && ctx.cwd.length > 0 ? ctx.cwd : process.cwd());
  let nestedTimeout = 180000;
  for (const arg of ctx.args) {
    nestedTimeout = Math.max(nestedTimeout, timeoutFloorForArg(arg, baseCwd));
  }
  ctx.payload.timeoutMs = ctx.payload.timeoutMs === 0 ? 0 : Math.max(ctx.payload.timeoutMs ?? nestedTimeout, nestedTimeout);
}

function timeoutFloorForArg(arg: unknown, baseCwd: string): number {
  if (typeof arg !== 'string') return 0;
  return Math.max(readLooseTimeout(arg), readFlagTimeout(arg), keywordFloor(arg), timeoutFloorForJsonFile(arg, baseCwd));
}

function readLooseTimeout(text: string): number {
  const timeoutMatch = text.match(/["']?timeoutMs["']?\s*:\s*(\d+)/i) || text.match(/["']?timeout["']?\s*:\s*(\d+)/i);
  return parsedTimeout(timeoutMatch);
}

function readTimeoutMsField(text: string): number {
  return parsedTimeout(text.match(/["']?timeoutMs["']?\s*:\s*(\d+)/i));
}

function readFlagTimeout(text: string): number {
  return parsedTimeout(text.match(/^--(?:timeout|timeoutMs)=(\d+)$/i));
}

function parsedTimeout(match: RegExpMatchArray | null): number {
  if (match === null || match[1] === undefined) return 0;
  const parsed = parseInt(match[1], 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(parsed, 2_147_483_647);
}

function keywordFloor(text: string): number {
  let floor = 0;
  if (/(?:docker|docker-compose|podman)/i.test(text) && /scout/i.test(text)) {
    floor = Math.max(floor, 1800000);
  } else if (((/(?:docker|docker-compose|podman)/i.test(text) && /\b(?:build|pull|push|up|down|restart|recreate|load|save|import|export|prune)\b|Health\.Status/i.test(text)) || /recreate-ecosystem/i.test(text))) {
    floor = Math.max(floor, 600000);
  }
  if (/backup-conversations\.ts/i.test(text)) floor = Math.max(floor, 1500000);
  if (/(?:playwright|cypress|\be2e\b)/i.test(text)) floor = Math.max(floor, 600000);
  if (/(?:coverage|--coverage)/i.test(text)) floor = Math.max(floor, 600000);
  if (/(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(text)) floor = Math.max(floor, 600000);
  return floor;
}

function timeoutFloorForJsonFile(filePath: string, baseCwd: string): number {
  if (!filePath.endsWith('.json')) return 0;
  try {
    const resolved = path.resolve(baseCwd, filePath);
    const st = fs.statSync(resolved, { throwIfNoEntry: false });
    if (st === undefined || !st.isFile() || st.size > 512 * 1024) return 0;
    const fileContent = fs.readFileSync(resolved, 'utf8');
    return Math.max(readTimeoutMsField(fileContent), keywordFloor(fileContent));
  } catch {
    return 0;
  }
}
