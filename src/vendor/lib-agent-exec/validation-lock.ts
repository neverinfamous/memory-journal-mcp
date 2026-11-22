// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPidAlive } from './process-manager.js';

export type ValidationLockKind = 'build' | 'typecheck' | 'playwright' | 'full-lint' | 'full-test' | 'check';
export interface ValidationClassification { kind: ValidationLockKind; label: string; }
export interface ValidationLockHandle { lockPath: string; scopeKey: string; kind: ValidationLockKind; release: () => void; }
export interface AcquireValidationLockOptions {
  projectDir: string;
  classification: ValidationClassification;
  timeoutMs?: number;
  lockDir?: string;
  staleTtlMs?: number;
  isJson?: boolean;
  env?: Record<string, string | undefined>;
  isPidAliveFn?: (pid: number) => boolean;
}
interface ValidationLockRecord { pid: number; token: string; kind: string; label: string; cwd: string; acquiredAt: number; }

const DEFAULT_LOCK_DIR = path.join(os.tmpdir(), 'agent-exec-validation-locks');
const DEFAULT_STALE_TTL_MS = 1_800_000;
const CORRUPT_LOCK_GRACE_MS = 10_000;
const RUNNER_CMDS = new Set(['pnpm', 'pnpx', 'bun', 'bunx', 'npm', 'npx', 'yarn']);
const RUNNER_VALUE_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix', '--filter', '-F', '-c', '--call', '--userconfig', '-p', '--package', '--store-dir', '--loglevel', '--reporter']);
const NODE_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '-C', '--env-file', '--title', '-e', '--eval', '-p', '--print']);
const DIRECT_NODE_TOOLS = new Set(['tsc', 'tsup', 'vitest', 'playwright', 'eslint', 'esbuild', 'vite', 'next']);
const CODE_FILE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/i;
const ESLINT_VALUE_FLAGS = new Set(['-c', '--config', '-f', '--format', '--ext', '--rulesdir', '-o', '--output-file', '--cache-location', '--cache-strategy', '--parser', '--parser-options', '--plugin', '--rule', '--env', '--global', '--resolve-plugins-relative-to', '--ignore-path', '--ignore-pattern', '--max-warnings']);
const TEST_VALUE_FLAGS = new Set(['-c', '--config', '--project', '--reporter', '-r', '-t', '--test-name-pattern', '--testNamePattern', '--shard', '--timeout', '--test-timeout', '--hook-timeout', '--bail', '--maxWorkers', '--minWorkers', '--max-workers', '--min-workers', '--concurrency', '--environment', '--env', '--root', '--dir', '--mode', '--outputFile', '--output-file', '--pool', '--preload', '--tsconfig', '--filter', '-n']);

function normalizeCmdBasename(rawCmd: string): string {
  return path.basename(rawCmd.trim()).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '');
}

function skipLeadingFlags(args: readonly string[], startIdx: number, valueFlags: ReadonlySet<string>): number {
  let i = startIdx;
  while (i < args.length) {
    const token = args[i];
    if (token === undefined || token === '--' || !token.startsWith('-')) return i;
    i += !token.includes('=') && valueFlags.has(token) ? 2 : 1;
  }
  return args.length;
}

function unwrapRunnerCommand(cmd: string, args: readonly string[]): { tool: string; rest: readonly string[] } | null {
  const base = normalizeCmdBasename(cmd);
  if (base === 'node') {
    const idx = skipLeadingFlags(args, 0, NODE_VALUE_FLAGS);
    const script = args[idx];
    if (script === undefined) return null;
    const scriptBase = path.basename(script).toLowerCase().replace(/\.(?:mjs|cjs|js)$/i, '');
    return DIRECT_NODE_TOOLS.has(scriptBase) ? { tool: scriptBase, rest: args.slice(idx + 1) } : null;
  }
  if (!RUNNER_CMDS.has(base)) return { tool: base, rest: args };
  const idx = skipLeadingFlags(args, 0, RUNNER_VALUE_FLAGS);
  const first = args[idx];
  if (first === undefined) return null;
  if (base === 'npx' || base === 'pnpx' || base === 'bunx') {
    return { tool: normalizeCmdBasename(first).replace(/\.(?:mjs|cjs|js)$/i, ''), rest: args.slice(idx + 1) };
  }
  if ((base === 'pnpm' && (first === 'exec' || first === 'dlx')) || (base === 'npm' && first === 'exec') || (base === 'bun' && first === 'x')) {
    const toolIdx = skipLeadingFlags(args, idx + 1, RUNNER_VALUE_FLAGS);
    const bin = args[toolIdx];
    return bin !== undefined ? { tool: normalizeCmdBasename(bin).replace(/\.(?:mjs|cjs|js)$/i, ''), rest: args.slice(toolIdx + 1) } : null;
  }
  if (first === 'run') {
    const scriptName = args[idx + 1];
    return scriptName !== undefined ? { tool: scriptName, rest: args.slice(idx + 2) } : null;
  }
  if (base === 'bun' && first === 'test') return { tool: 'bun-test', rest: args.slice(idx + 1) };
  return { tool: first, rest: args.slice(idx + 1) };
}

function hasPositionalTargetPaths(args: readonly string[], valueFlags: ReadonlySet<string>, requireCodeExt: boolean): boolean {
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (token === undefined) break;
    if (token === '--') { i += 1; continue; }
    if (token.startsWith('-')) { i += !token.includes('=') && valueFlags.has(token) ? 2 : 1; continue; }
    if (requireCodeExt ? CODE_FILE_EXT_RE.test(token) : token !== '.' && token !== './' && token !== '*' && token !== '**') return true;
    i += 1;
  }
  return false;
}

/** [INTENT]: Classify whether a command requires per-repo validation serialization or can run lock-free. */
export function classifyValidationCommand(cmd: string, args: readonly string[]): ValidationClassification | null {
  const unwrapped = unwrapRunnerCommand(cmd, args);
  if (unwrapped === null) return null;
  const { tool, rest } = unwrapped;
  const lowerTool = tool.toLowerCase();

  if (lowerTool === 'playwright' || /^pretest:e2e$|^test:e2e(?::.*)?$|^test-e2e(?:-.*)?$/.test(lowerTool)) return { kind: 'playwright', label: tool };
  if (lowerTool === 'tsc') return rest.some((a) => a === '-b' || a === '--build' || a.startsWith('--build=')) ? { kind: 'build', label: 'tsc -b' } : { kind: 'typecheck', label: 'tsc' };
  if (lowerTool === 'tsup' || lowerTool === 'esbuild') return { kind: 'build', label: lowerTool };
  if (lowerTool === 'vite' || lowerTool === 'next') return rest[skipLeadingFlags(rest, 0, new Set())] === 'build' ? { kind: 'build', label: `${lowerTool} build` } : null;
  if (lowerTool === 'eslint') return hasPositionalTargetPaths(rest, ESLINT_VALUE_FLAGS, true) ? null : { kind: 'full-lint', label: 'eslint' };
  if (lowerTool === 'bun-test') return hasPositionalTargetPaths(rest, TEST_VALUE_FLAGS, false) ? null : { kind: 'full-test', label: 'bun test' };
  if (lowerTool === 'vitest') {
    const subIdx = skipLeadingFlags(rest, 0, TEST_VALUE_FLAGS);
    const sub = rest[subIdx];
    if (sub === 'bench') return { kind: 'full-test', label: 'vitest bench' };
    const targetArgs = sub === 'run' || sub === 'watch' ? rest.slice(subIdx + 1) : rest;
    return hasPositionalTargetPaths(targetArgs, TEST_VALUE_FLAGS, false) ? null : { kind: 'full-test', label: 'vitest' };
  }
  if (/^(?:build(?::.*|-.*)?|compile)$/.test(lowerTool)) return { kind: 'build', label: tool };
  if (/^typecheck(?::.*|-.*)?$/.test(lowerTool)) return { kind: 'typecheck', label: tool };
  if (/^lint(?::.*|-.*)?$/.test(lowerTool)) return { kind: 'full-lint', label: tool };
  if (/^(?:test(?::(?:coverage|unit|integration|vendor|zod|all))?|bench)$/.test(lowerTool)) return { kind: 'full-test', label: tool };
  if (lowerTool === 'check') return { kind: 'check', label: 'check' };
  return null;
}

/** [INTENT]: Derive a deterministic, case-normalized SHA-256 scope key for a project working directory. */
export function resolveValidationScopeKey(projectDir: string): { scopeKey: string; normalizedDir: string } {
  let resolved: string;
  try { resolved = fs.realpathSync.native(projectDir); } catch { resolved = path.resolve(projectDir); }
  const root = path.parse(resolved).root;
  let trimmed = resolved;
  while (trimmed.length > root.length && (trimmed.endsWith('\\') || trimmed.endsWith('/'))) trimmed = trimmed.slice(0, -1);
  const normalizedDir = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
  return { scopeKey: crypto.createHash('sha256').update(normalizedDir).digest('hex').slice(0, 16), normalizedDir };
}

/** [INTENT]: Allow explicit opt-out via `AGENT_EXEC_VALIDATION_LOCK=0` or `false`. */
export function isValidationLockDisabled(env?: Record<string, string | undefined>): boolean {
  const cleaned = (env?.['AGENT_EXEC_VALIDATION_LOCK'] ?? process.env['AGENT_EXEC_VALIDATION_LOCK'] ?? '').trim().toLowerCase();
  return cleaned === '0' || cleaned === 'false';
}

function parseLockRecord(rawText: string): ValidationLockRecord | null {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    if (!('pid' in parsed) || typeof parsed.pid !== 'number' || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (!('token' in parsed) || typeof parsed.token !== 'string' || parsed.token.length === 0) return null;
    if (!('kind' in parsed) || typeof parsed.kind !== 'string' || !('label' in parsed) || typeof parsed.label !== 'string' || !('cwd' in parsed) || typeof parsed.cwd !== 'string') return null;
    if (!('acquiredAt' in parsed) || typeof parsed.acquiredAt !== 'number' || !Number.isFinite(parsed.acquiredAt)) return null;
    return { pid: parsed.pid, token: parsed.token, kind: parsed.kind, label: parsed.label, cwd: parsed.cwd, acquiredAt: parsed.acquiredAt };
  } catch {
    return null;
  }
}

function tryReclaimStaleLock(lockPath: string, staleTtlMs: number, isPidAliveFn: (pid: number) => boolean): boolean {
  const stat = fs.statSync(lockPath, { throwIfNoEntry: false });
  if (stat === undefined) return true;
  let record: ValidationLockRecord | null;
  try {
    record = parseLockRecord(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return false;
  }
  const now = Date.now();
  const isStale = record === null
    ? now - stat.mtimeMs > CORRUPT_LOCK_GRACE_MS
    : !isPidAliveFn(record.pid) || now - record.acquiredAt > staleTtlMs;
  if (!isStale) return false;
  try { fs.unlinkSync(lockPath); return true; } catch { return false; }
}

function createOwnershipRelease(lockPath: string, token: string): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const record = parseLockRecord(fs.readFileSync(lockPath, 'utf8'));
      if (record !== null && record.token === token) fs.unlinkSync(lockPath);
    } catch { /* Lock already removed or unreadable. */ }
  };
}

/** [INTENT]: Acquire an exclusive per-repo validation lock file, queuing cleanly behind active same-repo runs. */
export async function acquireValidationLock(options: AcquireValidationLockOptions): Promise<ValidationLockHandle | null> {
  if (isValidationLockDisabled(options.env)) return null;
  const lockDir = options.lockDir ?? DEFAULT_LOCK_DIR;
  try {
    fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  } catch (err: unknown) {
    if (options.isJson !== true) console.error(`⚠️ Validation lock dir creation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const { scopeKey, normalizedDir } = resolveValidationScopeKey(options.projectDir);
  const lockPath = path.join(lockDir, `${scopeKey}.lock`);
  const staleTtlMs = options.staleTtlMs ?? DEFAULT_STALE_TTL_MS;
  const isPidAliveFn = options.isPidAliveFn ?? isPidAlive;
  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, token, kind: options.classification.kind, label: options.classification.label, cwd: normalizedDir, acquiredAt: Date.now() });
  const deadlineMs = Date.now() + (options.timeoutMs ?? 90_000);
  let loggedWait = false;

  while (Date.now() < deadlineMs) {
    try {
      fs.writeFileSync(lockPath, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return { lockPath, scopeKey, kind: options.classification.kind, release: createOwnershipRelease(lockPath, token) };
    } catch (err: unknown) {
      const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
      if (code !== 'EEXIST') {
        if (options.isJson !== true) console.error(`⚠️ Validation lock write failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      if (tryReclaimStaleLock(lockPath, staleTtlMs, isPidAliveFn)) continue;
      if (!loggedWait && options.isJson !== true) {
        loggedWait = true;
        console.error(`⏳ Waiting for active ${options.classification.kind} validation lock in ${normalizedDir}...`);
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 150));
    }
  }

  if (options.isJson !== true) console.error(`⚠️ Timed out waiting for validation lock (${options.classification.label}); proceeding fail-open.`);
  return null;
}
