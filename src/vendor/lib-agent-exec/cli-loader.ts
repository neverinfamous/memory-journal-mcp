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
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !rel.startsWith('../') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function registerPluginExports(plugin: unknown): void {
  if (plugin === null || typeof plugin !== 'object') return;
  const interceptorsExport = 'interceptors' in plugin ? plugin.interceptors : undefined;
  const defaultExport = 'default' in plugin ? plugin.default : undefined;
  for (const candidate of [interceptorsExport, defaultExport]) {
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
  onLoadError?: (absPluginPath: string, err: unknown) => never,
): Promise<void> {
  for (const pluginPath of pluginPaths) {
    const absPluginPath = path.resolve(pluginPath);
    if (!allowedRoots.some((root) => isPathContainedInRoot(absPluginPath, root))) {
      onContainmentError(absPluginPath);
    }
    try {
      const plugin: unknown = await import(pathToFileURL(absPluginPath).href);
      registerPluginExports(plugin);
    } catch (err: unknown) {
      if (onLoadError) {
        onLoadError(absPluginPath, err);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const CLI_VALUE_FLAGS = new Set([
  '-p', '--payload', '--base64', '--payloadPath', '-t', '--target',
  '--cwd', '--timeout', '--timeoutMs', '--interceptors', '--plugin',
]);

export function hasTopLevelCliFlag(
  argv: readonly string[],
  predicate: (token: string) => boolean,
): boolean {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined || tok === '--') break;
    if (predicate(tok)) return true;
    if (CLI_VALUE_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    if (tok.startsWith('-')) continue;
    break;
  }
  return false;
}

export function findFirstTopLevelPositionalIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (tok === '--') return i + 1 < argv.length ? i + 1 : -1;
    if (CLI_VALUE_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    if (tok.startsWith('-')) continue;
    return i;
  }
  return -1;
}

export function splitRawCommandInvocation(rawArgv: readonly string[]): {
  flagArgs: string[];
  rawPositionals: string[] | null;
} {
  for (let i = 0; i < rawArgv.length; i++) {
    const tok = rawArgv[i];
    if (tok === undefined) continue;
    if (tok === '--') {
      return {
        flagArgs: rawArgv.slice(0, i),
        rawPositionals: rawArgv.slice(i + 1),
      };
    }
    if (CLI_VALUE_FLAGS.has(tok)) {
      i += 1;
      continue;
    }
    if (tok.startsWith('-')) continue;
    break;
  }
  const firstPosIdx = findFirstTopLevelPositionalIndex(rawArgv);
  if (firstPosIdx === -1) return { flagArgs: [...rawArgv], rawPositionals: null };
  const firstPos = (rawArgv[firstPosIdx] ?? '').trim();
  const isJsonOrFile =
    firstPos.startsWith('{') ||
    firstPos.startsWith("'{") ||
    firstPos.startsWith('"{') ||
    firstPos.startsWith("'{\\") ||
    firstPos.startsWith('base64:') ||
    firstPos.startsWith('```') ||
    path.extname(firstPos).toLowerCase() === '.json';
  const hasExplicitSourceFlag = rawArgv.slice(0, firstPosIdx).some((tok) =>
    ['-p', '--payload', '--base64', '--payloadPath'].includes(tok) ||
    tok.startsWith('--payload=') ||
    tok.startsWith('--base64=') ||
    tok.startsWith('--payloadPath=')
  );
  if (!isJsonOrFile && !hasExplicitSourceFlag) {
    return {
      flagArgs: rawArgv.slice(0, firstPosIdx),
      rawPositionals: rawArgv.slice(firstPosIdx),
    };
  }
  return { flagArgs: [...rawArgv], rawPositionals: null };
}

export function parseTimeoutOverride(cliTimeout: string | number | undefined): number | undefined {
  if (cliTimeout === undefined) return undefined;
  let numTimeout: number;
  if (typeof cliTimeout === 'number') {
    numTimeout = cliTimeout;
  } else {
    const trimmed = cliTimeout.trim();
    if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) return undefined;
    numTimeout = Number(trimmed);
  }
  if (!Number.isSafeInteger(numTimeout) || numTimeout < 0) return undefined;
  return Math.min(numTimeout, MAX_TIMEOUT_MS);
}

export function resolveAndValidateCwd(payload: ExecPayload, onInvalidCwd: (cwd: string) => never): string {
  if (payload.cwd !== undefined && typeof payload.cwd === 'string') {
    const unquotedCwd = payload.cwd.trim().replace(/^['"]|['"]$/g, '');
    if (process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/.*)?$/i.test(unquotedCwd)) {
      const origCwd = payload.cwd;
      const converted = convertToWindowsPath(unquotedCwd);
      payload.cwd = converted;
      console.error(`\n   💡 AGENT HINT: Provided cwd '${origCwd}' is a WSL mount path.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-converting WSL cwd to Windows path... (Frictionless Recovery)\x1b[0m`);
    }
  }

  const isWslTarget = payload.target === 'wsl2';
  const trimmedCwd = typeof payload.cwd === 'string' ? payload.cwd.trim().replace(/^['"]|['"]$/g, '') : undefined;
  const isPosixInternalCwd = isWslTarget && trimmedCwd !== undefined && trimmedCwd.length > 0 &&
    ((trimmedCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(trimmedCwd)) || trimmedCwd.startsWith('~'));
  const cwd = trimmedCwd !== undefined && trimmedCwd.length > 0
    ? (isPosixInternalCwd ? process.cwd() : path.resolve(trimmedCwd))
    : process.cwd();

  if (!isPosixInternalCwd && cwd.length < 260) {
    try {
      const st = fs.statSync(cwd, { throwIfNoEntry: false });
      if (st === undefined || !st.isDirectory()) {
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
    if (isExplicitPayload && k.toUpperCase() !== 'NODE_OPTIONS' && k.toUpperCase() !== 'NODE_PATH') {
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
