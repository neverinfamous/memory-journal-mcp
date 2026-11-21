// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEnvironment, IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import type { ExecPayload } from './schema.js';
import { convertToWindowsPath } from './command-utils.js';
import { customInterceptors } from './command-builder.js';
import type { ExecutionContext } from './interceptors/types.js';

export function isPathContainedInRoot(candidatePath: string, rootPath: string): boolean {
  try {
    const realRootRaw = fs.realpathSync(path.resolve(rootPath));
    const realCandidateRaw = fs.realpathSync(path.resolve(candidatePath));
    const realRoot = process.platform === 'win32' ? realRootRaw.toLowerCase() : realRootRaw;
    const realCandidate = process.platform === 'win32' ? realCandidateRaw.toLowerCase() : realCandidateRaw;
    const rel = path.relative(realRoot, realCandidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function registerPluginExports(plugin: unknown): void {
  if (plugin === null || typeof plugin !== 'object') return;
  const mod = plugin as { default?: unknown; interceptors?: unknown };
  for (const candidate of [mod.interceptors, mod.default]) {
    if (typeof candidate === 'function') {
      customInterceptors.push(candidate as (ctx: ExecutionContext) => void);
      continue;
    }
    if (!Array.isArray(candidate)) continue;
    for (const fn of candidate) {
      if (typeof fn === 'function') customInterceptors.push(fn as (ctx: ExecutionContext) => void);
    }
  }
}

export async function loadWorkspacePlugins(
  pluginPaths: readonly string[],
  allowedRoots: readonly string[],
  onContainmentError: (absPluginPath: string) => never,
): Promise<void> {
  for (const pluginPath of pluginPaths) {
    const absPluginPath = path.resolve(pluginPath);
    if (!allowedRoots.some((root) => isPathContainedInRoot(absPluginPath, root))) {
      onContainmentError(absPluginPath);
    }
    try {
      const plugin: unknown = await import(pathToFileURL(absPluginPath).href);
      registerPluginExports(plugin);
    } catch (err) {
      console.error(`❌ Error: Failed to load plugin at ${pluginPath}`);
      console.error(err instanceof Error ? err.message : String(err));
    }
  }
}

export function parseTimeoutOverride(cliTimeout: string | number | undefined): number | undefined {
  if (cliTimeout === undefined) return undefined;
  if (typeof cliTimeout === 'string' && cliTimeout.trim() === '') return undefined;
  const numTimeout = Number(cliTimeout);
  if (!Number.isFinite(numTimeout) || numTimeout < 0) return undefined;
  return numTimeout;
}

export function resolveAndValidateCwd(payload: ExecPayload, onInvalidCwd: (cwd: string) => never): string {
  if (payload.cwd !== undefined && typeof payload.cwd === 'string') {
    const unquotedCwd = payload.cwd.trim().replace(/^['"]|['"]$/g, '');
    if (/^\/?mnt\/[a-zA-Z](?:\/.*)?$/i.test(unquotedCwd)) {
      const converted = convertToWindowsPath(unquotedCwd);
      console.error(`\n   💡 AGENT HINT: Provided cwd '${payload.cwd}' is a WSL mount path.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-converting WSL cwd to Windows path... (Frictionless Recovery)\x1b[0m`);
      payload.cwd = converted;
    }
  }

  const isWslTarget = payload.target === 'wsl2';
  const isPosixInternalCwd = isWslTarget && payload.cwd !== undefined && typeof payload.cwd === 'string' &&
    (payload.cwd.startsWith('/') || payload.cwd.startsWith('~'));
  const cwd = payload.cwd !== undefined && payload.cwd.length > 0
    ? (isPosixInternalCwd ? process.cwd() : path.resolve(payload.cwd))
    : process.cwd();

  if (!isPosixInternalCwd && cwd.length < 260) {
    try {
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        onInvalidCwd(cwd);
      }
    } catch {
      onInvalidCwd(cwd);
    }
  }
  return cwd;
}

export function mergeFinalEnvironment(
  payloadEnv: ExecPayload['env'],
  envOverrides: Record<string, string> | undefined,
): Record<string, string | undefined> {
  const finalEnv = { ...buildEnvironment(payloadEnv) };
  if (!envOverrides) return finalEnv;

  const explicitKeys = new Set(
    Object.entries(payloadEnv ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k]) => (process.platform === 'win32' ? k.toUpperCase() : k))
  );

  for (const [k, v] of Object.entries(envOverrides)) {
    const normalized = process.platform === 'win32' ? k.toUpperCase() : k;
    const isExplicitPayload = explicitKeys.has(normalized) && !IMMUTABLE_ENV_OVERRIDES.has(k.toUpperCase());
    if (isExplicitPayload && k.toUpperCase() !== 'NODE_OPTIONS') {
      continue;
    }
    let targetKey = k;
    if (process.platform === 'win32') {
      const existingKey = Object.keys(finalEnv).find(key => key.toUpperCase() === k.toUpperCase());
      if (existingKey) targetKey = existingKey;
    }
    finalEnv[targetKey] = v;
  }
  return finalEnv;
}
