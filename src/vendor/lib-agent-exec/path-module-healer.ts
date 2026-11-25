// @ts-nocheck
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertToWslPath } from './command-utils.js';
import { emitInterceptBanner } from './utils.js';
import { BARREL_CANDIDATES, CANDIDATE_EXTENSIONS, createPathProbeCache, isFilePath, logPathHeal, normalizeMntPathForHost, statPathKind, type PathProbeCache } from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';
import { resolveBuildSrcSwap } from './path-synonym.js';
import { buildNonCodeSpans, isIndexInSpans } from './quote-spans.js';

export interface HealModuleImportOptions {
  skipValidFileRewrite?: boolean;
  interpreter?: string;
  deferredLogs?: string[];
}

type NonCodeSpans = ReturnType<typeof buildNonCodeSpans>;
const JS_TS_INTERPRETERS = new Set(['node', 'nodejs', 'js', 'javascript', 'bun', 'tsx', 'ts-node', 'ts', 'typescript']);

interface ModuleHealState {
  routineRelocated: number;
  healedRequires: string[];
  healedImports: string[];
}

type HealTarget = 'windows' | 'wsl2';

function firstNonDirectoryBarrel(dirPath: string, cache?: PathProbeCache): string | null {
  for (const barrel of BARREL_CANDIDATES) {
    const barrelPath = path.join(dirPath, barrel);
    if (isFilePath(barrelPath, cache)) return barrelPath;
  }
  return null;
}

function firstExtensionFile(targetPath: string, cache?: PathProbeCache): string | null {
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = targetPath + ext;
    if (isFilePath(candidate, cache)) return candidate;
  }
  return null;
}

function resolveMissingModule(targetPath: string, cache?: PathProbeCache): string {
  const asTs = targetPath.replace(/\.([mc]?)js$/i, '.$1ts');
  const asTsx = targetPath.replace(/\.([mc]?)js$/i, '.$1tsx');
  if (isFilePath(asTs, cache)) return asTs;
  if (isFilePath(asTsx, cache)) return asTsx;
  const withExt = firstExtensionFile(targetPath, cache);
  if (withExt !== null) return withExt;
  return resolveBuildSrcSwap(targetPath, false, cache) ?? findNeighborFilePath(targetPath, false, cache) ?? targetPath;
}

function encodePosixFileUrl(wslPath: string): string {
  return `file://${encodeURI(wslPath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

function finalizeModuleResult(targetPath: string, isWsl: boolean, isEsm: boolean, wasExactFile: boolean): { healed: string; wasExactFile: boolean } {
  if (isWsl) {
    const wslPath = convertToWslPath(targetPath);
    return { healed: isEsm ? encodePosixFileUrl(wslPath) : wslPath, wasExactFile };
  }
  if (isEsm) return { healed: pathToFileURL(targetPath).href, wasExactFile };
  return { healed: targetPath.replace(/\\/g, '/'), wasExactFile };
}

function normalizeModuleInput(rawPath: string): { normalizedInput: string; forcedWsl: boolean } {
  const trimmed = rawPath.trim();
  if (/^file:\/\/\/mnt\/[a-zA-Z](?:\/.*)?$/i.test(trimmed)) {
    const rawPosix = trimmed.slice('file://'.length);
    try {
      return { normalizedInput: decodeURIComponent(rawPosix), forcedWsl: true };
    } catch {
      return { normalizedInput: rawPosix, forcedWsl: true };
    }
  }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return { normalizedInput: fileURLToPath(trimmed), forcedWsl: false };
    } catch {
      return { normalizedInput: rawPath, forcedWsl: false };
    }
  }
  return { normalizedInput: rawPath, forcedWsl: false };
}

function healModulePathDetailed(
  rawPath: string,
  cwd: string,
  isEsm = false,
  target?: HealTarget,
  probeCache: PathProbeCache = createPathProbeCache(),
): { healed: string; wasExactFile: boolean } {
  const { normalizedInput, forcedWsl } = normalizeModuleInput(rawPath);
  const isWsl = target === 'wsl2' || forcedWsl || /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(normalizedInput);
  const wslNormalized = normalizeMntPathForHost(normalizedInput);
  const windowsCwd = normalizeMntPathForHost(cwd);
  const resolvedPath = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(windowsCwd, wslNormalized);
  let targetPath = resolvedPath;
  let wasExactFile = false;
  const kind = statPathKind(targetPath, probeCache);
  if (kind === null) {
    targetPath = resolveMissingModule(targetPath, probeCache);
  } else if (kind === 'dir') {
    targetPath = firstNonDirectoryBarrel(targetPath, probeCache) ?? targetPath;
  } else {
    wasExactFile = true;
  }
  return finalizeModuleResult(targetPath, isWsl, isEsm, wasExactFile);
}

export function healModulePath(rawPath: string, cwd: string, isEsm = false, target?: HealTarget): string {
  return healModulePathDetailed(rawPath, cwd, isEsm, target).healed;
}

function rememberModuleHeal(state: ModuleHealState, kind: 'require' | 'import', relPath: string, healed: string, wasExactFile: boolean): void {
  if (wasExactFile) {
    state.routineRelocated += 1;
    return;
  }
  const note = `'${relPath}' -> '${healed}'`;
  if (kind === 'require') state.healedRequires.push(note);
  else state.healedImports.push(note);
}

function rewrittenModule(relPath: string, healed: string, wasExactFile: boolean, skipValid: boolean, state: ModuleHealState, kind: 'require' | 'import'): string | null {
  if (skipValid && wasExactFile) return null;
  if (healed === relPath) return null;
  rememberModuleHeal(state, kind, relPath, healed, wasExactFile);
  return healed;
}

interface ModuleDetailCache {
  details: Map<string, { healed: string; wasExactFile: boolean }>;
  probeCache: PathProbeCache;
}

function cachedModuleDetail(
  cache: ModuleDetailCache,
  relPath: string,
  cwd: string,
  isEsm: boolean,
  target: HealTarget | undefined,
): { healed: string; wasExactFile: boolean } {
  const key = `${isEsm ? 'esm' : 'cjs'}\0${relPath}`;
  const cached = cache.details.get(key);
  if (cached !== undefined) return cached;
  const resolved = healModulePathDetailed(relPath, cwd, isEsm, target, cache.probeCache);
  cache.details.set(key, resolved);
  return resolved;
}

const REQUIRE_CALL_RE = /\brequire\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])(\.[^'"]+)\1((?:\s*,[^)]*)?)\)/g;

function healRequireCalls(code: string, cwd: string, target: HealTarget | undefined, skipValid: boolean, state: ModuleHealState, spans: NonCodeSpans, cache: ModuleDetailCache): string {
  REQUIRE_CALL_RE.lastIndex = 0;
  return code.replace(REQUIRE_CALL_RE, (fullMatch: string, quote: string, relPath: string, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const detailed = cachedModuleDetail(cache, relPath, cwd, false, target);
    const healed = rewrittenModule(relPath, detailed.healed, detailed.wasExactFile, skipValid, state, 'require');
    if (healed === null) return fullMatch;
    return `require(${quote}${healed}${quote})`;
  });
}

function healDynamicImports(code: string, cwd: string, target: HealTarget | undefined, skipValid: boolean, state: ModuleHealState, spans: NonCodeSpans, cache: ModuleDetailCache): string {
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  return code.replace(DYNAMIC_IMPORT_RE, (fullMatch: string, quote: string, relPath: string, extraArgs: string | undefined, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const detailed = cachedModuleDetail(cache, relPath, cwd, true, target);
    const healed = rewrittenModule(relPath, detailed.healed, detailed.wasExactFile, skipValid, state, 'import');
    if (healed === null) return fullMatch;
    return `import(${quote}${healed}${quote}${extraArgs ?? ''})`;
  });
}

const STATIC_IMPORT_REGEX = /\b(import|export)\s+((?:[\w{},*$][\w\s{},*$]{0,512}from\s+)?)(['"])(\.[^'"]+)\3/g;

function healStaticImports(code: string, cwd: string, target: HealTarget | undefined, skipValid: boolean, state: ModuleHealState, spans: NonCodeSpans, cache: ModuleDetailCache): string {
  STATIC_IMPORT_REGEX.lastIndex = 0;
  return code.replace(STATIC_IMPORT_REGEX, (fullMatch: string, keyword: string, fromPart: string, quote: string, relPath: string, offset: number) => {
    if (isIndexInSpans(spans, offset)) return fullMatch;
    const detailed = cachedModuleDetail(cache, relPath, cwd, true, target);
    const healed = rewrittenModule(relPath, detailed.healed, detailed.wasExactFile, skipValid, state, 'import');
    if (healed === null) return fullMatch;
    return `${keyword} ${fromPart}${quote}${healed}${quote}`;
  });
}

function emitModuleHealBanners(state: ModuleHealState, deferredLogs?: string[]): void {
  if (state.routineRelocated > 0) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Rewrote ${String(state.routineRelocated)} valid relative module path(s) for temporary inline script execution.`);
  }
  if (state.healedRequires.length > 0) {
    const hint = `Relative require (${state.healedRequires.join(', ')}) resolved against cwd.`;
    const action = 'Auto-correcting relative require path to absolute... (Frictionless Recovery)';
    if (deferredLogs !== undefined) deferredLogs.push(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: ${action}\x1b[0m`);
    else logPathHeal(hint, action);
  }
  if (state.healedImports.length > 0) {
    const hint = `Relative import/export (${state.healedImports.join(', ')}) resolved against cwd.`;
    const action = 'Auto-correcting relative import path to file URL... (Frictionless Recovery)';
    if (deferredLogs !== undefined) deferredLogs.push(`\n   💡 AGENT HINT: ${hint}\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: ${action}\x1b[0m`);
    else logPathHeal(hint, action);
  }
}

export function healModuleImports(code: string, cwd: string, target?: HealTarget, options?: HealModuleImportOptions): string {
  if (options?.interpreter !== undefined) {
    const baseInterp = path.basename(options.interpreter.trim().toLowerCase()).replace(/\.(?:exe|cmd|bat)$/i, '');
    if (!JS_TS_INTERPRETERS.has(baseInterp)) return code;
  }
  if (!code.includes("'.") && !code.includes('".')) return code;
  let spans = buildNonCodeSpans(code);
  const state: ModuleHealState = { routineRelocated: 0, healedRequires: [], healedImports: [] };
  const detailCache: ModuleDetailCache = { details: new Map(), probeCache: createPathProbeCache() };
  const skipValid = options?.skipValidFileRewrite === true;
  let updated = healRequireCalls(code, cwd, target, skipValid, state, spans, detailCache);
  if (updated !== code) spans = buildNonCodeSpans(updated);
  const afterDynamic = healDynamicImports(updated, cwd, target, skipValid, state, spans, detailCache);
  if (afterDynamic !== updated) spans = buildNonCodeSpans(afterDynamic);
  updated = healStaticImports(afterDynamic, cwd, target, skipValid, state, spans, detailCache);
  emitModuleHealBanners(state, options?.deferredLogs);
  return updated;
}
