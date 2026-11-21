// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { healFragmentedQuotes } from '../command-utils.js';
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

export function unwrapPackageRunnerShell(ctx: ExecutionContext): void {
  const pkgBase = ctx.cmdBasename.toLowerCase().replace(/\.(exe|cmd)$/i, '');
  if (!PACKAGE_RUNNERS.includes(pkgBase)) return;
  const runIdx = ctx.args[0]?.toLowerCase() === 'run' ? 1 : 0;
  const possibleShell = ctx.args[runIdx]?.toLowerCase().replace(/\.(exe|cmd)$/i, '');
  if (possibleShell !== undefined && possibleShell.length > 0 && DIRECT_SHELLS.includes(possibleShell)) {
    rebindPackageRunnerToShell(ctx, possibleShell, runIdx);
    return;
  }
  if (ctx.args.some(arg => path.basename(arg).toLowerCase() === 'agent-exec.ts')) {
    extendNestedAgentExec(ctx);
  }
}

function rebindPackageRunnerToShell(ctx: ExecutionContext, possibleShell: string, runIdx: number): void {
  console.error(`\n   💡 AGENT HINT: Shell '${possibleShell}' invoked through package runner '${ctx.cmdBasename}'.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Unwrapping package runner to execute shell directly with safety interceptors... (Frictionless Recovery)\x1b[0m`);
  ctx.cmdBasename = possibleShell;
  if (ctx.payload.type === 'command') {
    ctx.payload.command = possibleShell;
  }
  ctx.args = ctx.args.slice(runIdx + 1);
}

function extendNestedAgentExec(ctx: ExecutionContext): void {
  ctx.payload.bypassInterceptors = true;
  let nestedTimeout = 180000;
  for (const arg of ctx.args) {
    nestedTimeout = Math.max(nestedTimeout, timeoutFloorForArg(arg));
  }
  ctx.payload.timeoutMs = Math.max(ctx.payload.timeoutMs || nestedTimeout, nestedTimeout);
}

function timeoutFloorForArg(arg: unknown): number {
  if (typeof arg !== 'string') return 0;
  return Math.max(readLooseTimeout(arg), readFlagTimeout(arg), keywordFloor(arg), timeoutFloorForJsonFile(arg));
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
  return parsed;
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

function timeoutFloorForJsonFile(filePath: string): number {
  if (!filePath.endsWith('.json') || !fs.existsSync(filePath)) return 0;
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return Math.max(readTimeoutMsField(fileContent), keywordFloor(fileContent));
  } catch {
    return 0;
  }
}
