// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTONOMOUS_HEALING_MSG, findEcosystemScript, resolveFreshCompiledCommitBundle } from '../utils.js';
import type { ExecutionContext } from './types.js';

const COMMIT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function readCommitMessage(args: string[]): string | undefined {
  const mIndex = args.findIndex((arg) => arg === '-m' || arg === '--message');
  if (mIndex !== -1 && mIndex + 1 < args.length) return args[mIndex + 1];
  const amIndex = args.findIndex((arg) => arg === '-am' || arg === '-ma');
  if (amIndex !== -1 && amIndex + 1 < args.length) return args[amIndex + 1];
  const mPrefix = args.find((arg) => (arg.startsWith('-m') || arg.startsWith('--message=')) && arg.length > 2);
  if (mPrefix !== undefined) return mPrefix.startsWith('--message=') ? mPrefix.slice(10) : mPrefix.slice(2);
  const amPrefix = args.find((arg) => (arg.startsWith('-am') || arg.startsWith('-ma')) && arg.length > 3);
  if (amPrefix !== undefined) return amPrefix.slice(3);
  return undefined;
}

function isSameResolvedPath(a: string, b: string): boolean {
  const normA = path.resolve(a);
  const normB = path.resolve(b);
  return process.platform === 'win32' ? normA.toLowerCase() === normB.toLowerCase() : normA === normB;
}

function resolveCommitScript(targetCwd: string, rawCwd: string, cwd: string): string | null {
  const localAgentPath = path.join(targetCwd, '.agents', 'scripts', 'commit.ts');
  const localScriptsPath = path.join(targetCwd, 'scripts', 'commit.ts');
  const sameAsProcessCwd = isSameResolvedPath(targetCwd, process.cwd());
  const fallbackCommitScript = path.resolve(COMMIT_DIR, '../../commit.ts');
  if (fs.existsSync(localAgentPath)) return sameAsProcessCwd ? './.agents/scripts/commit.ts' : localAgentPath;
  if (fs.existsSync(localScriptsPath)) return sameAsProcessCwd ? './scripts/commit.ts' : localScriptsPath;
  return findEcosystemScript(targetCwd, 'commit.ts')
    || findEcosystemScript(rawCwd, 'commit.ts')
    || findEcosystemScript(cwd, 'commit.ts')
    || (fs.existsSync(fallbackCommitScript) ? fallbackCommitScript : null);
}

function applyCommitWrapper(ctx: ExecutionContext, script: string, message: string, targetCwd: string, explicitCwd: string | undefined): void {
  console.error(`\n   💡 AGENT HINT: 'git commit' is intercepted for safety.`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Transparently rewriting to '${script}' with default scores... (Frictionless Recovery)`);
  const compiledCommit = ctx.payload.target !== 'wsl2' ? resolveFreshCompiledCommitBundle(script, targetCwd) : null;
  if (compiledCommit !== null) {
    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
    ctx.cmdBasename = nodeCmd;
    ctx.args = [compiledCommit, '--msg', message, '--impact', '0.5', '--confidence', '0.5', '--validation', 'passed'];
    ctx.payload.bypassInterceptors = true;
    if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 240000) {
      ctx.payload.timeoutMs = 240000;
    }
  } else {
    ctx.cmdBasename = 'bun';
    ctx.args = [script, '--msg', message, '--impact', '0.5', '--confidence', '0.5', '--validation', 'passed'];
  }
  if (explicitCwd !== undefined || !isSameResolvedPath(targetCwd, process.cwd())) ctx.args.push('--cwd', targetCwd);
  if ('command' in ctx.payload) {
    ctx.payload.command = ctx.cmdBasename;
    ctx.payload.args = ctx.args;
  }
}

export function rewriteGitCommit(
  ctx: ExecutionContext,
  args: string[],
  targetCwd: string,
  rawCwd: string,
  explicitCwd: string | undefined,
): void {
  const cwd = ctx.payload.cwd || process.cwd();
  const commitScript = resolveCommitScript(targetCwd, rawCwd, cwd);
  const message = readCommitMessage(args);
  if (args.includes('--amend') && commitScript !== null) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'git commit --amend' is forbidden when using the commit.ts wrapper because it breaks the Memory Journal tracking.`);
    console.error(`   Because 'agent-exec.ts' requires strict tracking, this is blocked. Please create a new commit or bypass the interceptor if you must amend.`);
    process.exit(1);
  }
  if (message !== undefined && commitScript !== null) {
    applyCommitWrapper(ctx, commitScript, message, targetCwd, explicitCwd);
    return;
  }
  if (message !== undefined) return;
  if (commitScript !== null) {
    console.error(`\n   💡 AGENT HINT: 'git commit' is strictly forbidden via the shell.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   You must use the designated wrapper instead: bun ${commitScript}`);
    process.exit(1);
  }
  console.error(`\n   💡 AGENT HINT: 'git commit' without '-m' will open an interactive editor and hang.\n${AUTONOMOUS_HEALING_MSG}`);
  console.error(`   Because 'agent-exec.ts' is non-interactive, you MUST provide '-m' or '--message'.`);
  process.exit(1);
}
