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

function isUnknownArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

function registerPluginExports(plugin: unknown): void {
  if (plugin === null || typeof plugin !== 'object') return;
  const interceptorsExport = 'interceptors' in plugin ? plugin.interceptors : undefined;
  const defaultExport = 'default' in plugin ? plugin.default : undefined;
  const seen = new Set<unknown>();
  const registerFn = (fn: unknown): void => {
    if (typeof fn !== 'function' || seen.has(fn)) return;
    seen.add(fn);
    customInterceptors.push((ctx: ExecutionContext) => { Reflect.apply(fn, undefined, [ctx]); });
  };
  for (const candidate of [interceptorsExport, defaultExport]) {
    if (typeof candidate === 'function') {
      registerFn(candidate);
      continue;
    }
    if (!isUnknownArray(candidate)) continue;
    for (const fn of candidate) {
      registerFn(fn);
    }
  }
}

export async function loadWorkspacePlugins(
  pluginPaths: readonly string[],
  allowedRoots: readonly string[],
  onContainmentError: (absPluginPath: string) => never,
  onLoadError?: (absPluginPath: string, err: unknown) => never,
): Promise<void> {
  await pluginPaths.reduce<Promise<void>>(async (prevPromise, pluginPath) => {
    await prevPromise;
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
  }, Promise.resolve());
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const CLI_VALUE_FLAGS = new Set([
  '-p', '--payload', '--base64', '--payloadPath', '-t', '--target',
  '--cwd', '--timeout', '--timeoutMs', '--interceptors', '--plugin',
]);
const CLI_SHORT_VALUE_FLAGS = new Set(['p', 't']);

function inspectCliFlagToken(tok: string): { consumesNext: boolean; attachesPayload: boolean } {
  if (tok === '--' || !tok.startsWith('-') || tok.length <= 1) return { consumesNext: false, attachesPayload: false };
  if (tok.startsWith('--')) {
    const attachesPayload = tok === '--payload' || tok === '--base64' || tok === '--payloadPath' ||
      tok.startsWith('--payload=') || tok.startsWith('--base64=') || tok.startsWith('--payloadPath=');
    return { consumesNext: CLI_VALUE_FLAGS.has(tok), attachesPayload };
  }
  let attachesPayload = false;
  for (let j = 1; j < tok.length; j++) {
    const ch = tok[j] ?? '';
    if (CLI_SHORT_VALUE_FLAGS.has(ch)) {
      if (ch === 'p') attachesPayload = true;
      return { consumesNext: j === tok.length - 1, attachesPayload };
    }
  }
  return { consumesNext: false, attachesPayload };
}

function normalizeShortVersionCluster(tok: string): string {
  if (tok === '-V') return '-v';
  if (!tok.startsWith('-') || tok.startsWith('--')) return tok;
  let stopIdx = tok.length;
  for (let j = 1; j < tok.length; j++) {
    if (CLI_SHORT_VALUE_FLAGS.has(tok[j] ?? '')) { stopIdx = j; break; }
  }
  const head = tok.slice(0, stopIdx);
  return head.includes('V') ? `${head.replace(/V/g, 'v')}${tok.slice(stopIdx)}` : tok;
}

export function hasTopLevelCliFlag(
  argv: readonly string[],
  predicate: (token: string) => boolean,
): boolean {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined || tok === '--') break;
    if (predicate(tok)) return true;
    if (inspectCliFlagToken(tok).consumesNext) {
      i += 1;
      continue;
    }
    if (tok.startsWith('-')) continue;
    break;
  }
  return false;
}

export function normalizeTopLevelVersionArg(argv: readonly string[]): string[] {
  const out = [...argv];
  for (let i = 0; i < out.length; i++) {
    const tok = out[i];
    if (tok === undefined || tok === '--') break;
    const normalized = normalizeShortVersionCluster(tok);
    if (normalized !== tok) out[i] = normalized;
    if (inspectCliFlagToken(tok).consumesNext) { i += 1; continue; }
    if (!tok.startsWith('-')) break;
  }
  return out;
}

export function findFirstTopLevelPositionalIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (tok === '--') return i + 1 < argv.length ? i + 1 : -1;
    if (inspectCliFlagToken(tok).consumesNext) {
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
  let firstPosIdx = -1;
  let hasExplicitSourceFlag = false;
  for (let i = 0; i < rawArgv.length; i++) {
    const tok = rawArgv[i];
    if (tok === undefined) continue;
    if (tok === '--') {
      return { flagArgs: rawArgv.slice(0, i), rawPositionals: rawArgv.slice(i + 1) };
    }
    const flagInfo = inspectCliFlagToken(tok);
    if (flagInfo.attachesPayload) hasExplicitSourceFlag = true;
    if (flagInfo.consumesNext) {
      i += 1;
      continue;
    }
    if (tok.startsWith('-')) continue;
    firstPosIdx = i;
    break;
  }
  if (firstPosIdx === -1) return { flagArgs: [...rawArgv], rawPositionals: null };
  const firstPos = (rawArgv[firstPosIdx] ?? '').trim();
  const isJsonOrFile =
    /^['"]?\s*(?:\{|```)/.test(firstPos) ||
    firstPos.startsWith('base64:') ||
    path.extname(firstPos).toLowerCase() === '.json';
  if (!isJsonOrFile && !hasExplicitSourceFlag) {
    return { flagArgs: rawArgv.slice(0, firstPosIdx), rawPositionals: rawArgv.slice(firstPosIdx) };
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
    const unquotedCwd = payload.cwd.trim().replace(/^['"]|['"]$/g, '').trim();
    if (process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/.*)?$/i.test(unquotedCwd)) {
      const origCwd = payload.cwd;
      const converted = convertToWindowsPath(unquotedCwd);
      payload.cwd = converted;
      console.error(`\n   💡 AGENT HINT: Provided cwd '${origCwd}' is a WSL mount path.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-converting WSL cwd to Windows path... (Frictionless Recovery)\x1b[0m`);
    }
  }

  const isWslTarget = payload.target === 'wsl2';
  const trimmedCwd = typeof payload.cwd === 'string' ? payload.cwd.trim().replace(/^['"]|['"]$/g, '').trim() : undefined;
  if (typeof payload.cwd === 'string' && trimmedCwd !== undefined && trimmedCwd.length === 0) {
    onInvalidCwd(payload.cwd);
  }
  if (trimmedCwd !== undefined && trimmedCwd !== payload.cwd) {
    payload.cwd = trimmedCwd;
  }
  const isPosixInternalCwd = isWslTarget && trimmedCwd !== undefined && trimmedCwd.length > 0 &&
    ((trimmedCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(trimmedCwd)) || trimmedCwd.startsWith('~'));
  const cwd = trimmedCwd !== undefined && trimmedCwd.length > 0
    ? (isPosixInternalCwd ? process.cwd() : path.resolve(trimmedCwd))
    : process.cwd();

  if (!isPosixInternalCwd) {
    try {
      const st = fs.statSync(cwd, { throwIfNoEntry: false });
      if (st === undefined || !st.isDirectory()) {
        onInvalidCwd(cwd);
      }
    } catch {
      onInvalidCwd(cwd);
    }
  }
  if (!isPosixInternalCwd && trimmedCwd !== undefined && trimmedCwd.length > 0) {
    payload.cwd = cwd;
  }
  return cwd;
}

export function mergeFinalEnvironment(
  payloadEnv: ExecPayload['env'],
  envOverrides: Record<string, string> | undefined,
): Record<string, string | undefined> {
  const finalEnv: Record<string, string | undefined> = {};
  Object.setPrototypeOf(finalEnv, null);
  Object.assign(finalEnv, buildEnvironment(payloadEnv));
  if (!envOverrides) return finalEnv;

  const explicitKeys = new Set(
    Object.entries(payloadEnv ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k]) => (process.platform === 'win32' ? k.toUpperCase() : k))
  );

  let upperKeyMap: Map<string, string> | undefined;
  if (process.platform === 'win32') {
    upperKeyMap = new Map<string, string>();
    for (const key of Object.keys(finalEnv)) {
      upperKeyMap.set(key.toUpperCase(), key);
    }
  }

  for (const [k, v] of Object.entries(envOverrides)) {
    const normalized = process.platform === 'win32' ? k.toUpperCase() : k;
    const isExplicitPayload = explicitKeys.has(normalized) && !IMMUTABLE_ENV_OVERRIDES.has(k.toUpperCase());
    if (isExplicitPayload && k.toUpperCase() !== 'NODE_OPTIONS' && k.toUpperCase() !== 'NODE_PATH') {
      continue;
    }
    let targetKey = k;
    if (upperKeyMap !== undefined) {
      const existingKey = upperKeyMap.get(normalized);
      if (existingKey !== undefined) {
        targetKey = existingKey;
      } else {
        upperKeyMap.set(normalized, k);
      }
    }
    finalEnv[targetKey] = v;
  }
  return finalEnv;
}
