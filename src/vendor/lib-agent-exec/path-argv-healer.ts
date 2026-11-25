// @ts-nocheck
import path from 'node:path';
import type { ExecutionContext } from './interceptors/types.js';
import { findPatternExprIndex } from './command-utils.js';
import { resolveEvalExecutionTarget } from './eval-healer.js';
import {
  CANDIDATE_EXTENSIONS,
  createPathProbeCache,
  formatHealedPath,
  isDirectoryPath,
  isFilePath,
  logPathHeal,
  normalizeMntPathForHost,
  preserveQuotes,
  splitJoinedFileArg,
  statPathKind,
  WSL_DRIVE_MNT_RE,
  type PathProbeCache,
} from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';
import { resolveBuildSrcSwap, resolvePathWithDirectorySynonyms } from './path-synonym.js';
import { healEvalCodePathHallucinations } from './path-eval-healer.js';
import {
  CODE_MODULE_EXTENSIONS,
  FILE_TOOLS,
  GREP_TOOLS,
  MULTI_TARGET_FILE_TOOLS,
  SEARCH_OR_LIST,
  SEARCH_TOOLS,
  applyHeal,
  buildResolvedArgArray,
  findBarrelName,
  hasGrepRecurse,
  resolveArgForCompare,
  shiftSkipIndices,
  shouldSkipArg,
  skipBunPositionals,
  skipFlagValues,
  skipNodeTail,
} from './path-argv-utils.js';

const BACKUP_TOKEN_RE = /(^|['"]|[\\/])backups(?=[\\/]|['"]|$)/i;
const DATA_BACKUP_TOKEN_RE = /(?:^|[\\/])data[\\/]backups(?=[\\/]|$)/i;
const BACKUP_REPLACE_RE = /(^|[\\/])backups(?=[\\/]|$)/i;
const MCP_CONFIG_SEP_RE = /\.gemini[\\/]mcp_config\.json/g;
const ARGV_CODE_EXT_RE = /\.(?:ts|js|tsx|jsx|mjs|cjs)$/i;
const ARGV_TRAIL_SEP_RE = /[\\/]$/;

function healEvalPayload(ctx: ExecutionContext, cwd: string): void {
  if (ctx.payload.type !== 'eval' || typeof ctx.payload.code !== 'string') return;
  const { effectiveInterpreter } = resolveEvalExecutionTarget(ctx.payload);
  const skipValidFileRewrite = ctx.payload.target !== 'wsl2'
    && ['node', 'js', 'javascript', 'tsx', 'ts-node'].includes(effectiveInterpreter.toLowerCase());
  const deferredLogs: string[] = [];
  ctx.payload.code = healEvalCodePathHallucinations(
    ctx.payload.code,
    cwd,
    ctx.payload.target,
    { skipValidFileRewrite, interpreter: effectiveInterpreter, deferredLogs },
  );
  for (const line of deferredLogs) console.error(line);
}

function healBackupPaths(args: string[], skip: ReadonlySet<number>, cwd: string, syncArgs: () => void, cache: PathProbeCache): void {
  for (let index = 0; index < args.length; index += 1) {
    if (skip.has(index)) continue;
    const arg = args[index];
    if (arg === undefined || arg.startsWith('-')) continue;
    if (!BACKUP_TOKEN_RE.test(arg)) continue;
    const raw = arg.replace(/^['"]|['"]$/g, '');
    if (DATA_BACKUP_TOKEN_RE.test(raw)) continue;
    const isWslPath = WSL_DRIVE_MNT_RE.test(raw);
    const hostRaw = isWslPath ? normalizeMntPathForHost(raw) : raw;
    const resolved = path.isAbsolute(hostRaw) ? path.normalize(hostRaw) : path.resolve(cwd, hostRaw);
    if (statPathKind(resolved, cache) !== null) continue;
    const sep = raw.includes('\\') && !isWslPath ? '\\' : '/';
    const candidateRaw = raw.replace(BACKUP_REPLACE_RE, `$1data${sep}backups`);
    const candidateHost = isWslPath ? normalizeMntPathForHost(candidateRaw) : candidateRaw;
    const candidateResolved = path.isAbsolute(candidateHost) ? path.normalize(candidateHost) : path.resolve(cwd, candidateHost);
    if (statPathKind(candidateResolved, cache) === null) continue;
    args[index] = preserveQuotes(arg, candidateRaw);
    syncArgs();
    console.error(`\n   💡 AGENT HINT: 'backups' directory was found at 'data/backups'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to data/backups.\x1b[0m`);
  }
}

function healMcpConfigPaths(args: string[], skip: ReadonlySet<number>, cwd: string, syncArgs: () => void, cache: PathProbeCache): void {
  for (let index = 0; index < args.length; index += 1) {
    if (skip.has(index)) continue;
    const arg = args[index];
    if (arg === undefined || arg.startsWith('-') || (!arg.includes('.gemini\\mcp_config.json') && !arg.includes('.gemini/mcp_config.json')) || arg.includes('antigravity-ide')) continue;
    const raw = arg.replace(/^['"]|['"]$/g, '');
    const hostRaw = normalizeMntPathForHost(raw);
    const resolved = path.isAbsolute(hostRaw) ? path.normalize(hostRaw) : path.resolve(cwd, hostRaw);
    if (statPathKind(resolved, cache) !== null) continue;
    args[index] = arg.replace(MCP_CONFIG_SEP_RE, '.gemini/antigravity-ide/mcp_config.json');
    syncArgs();
    console.error(`\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`);
  }
}

function healModularDirectory(args: string[], base: string, index: number, arg: string, rawPath: string, isWslPath: boolean, cwd: string, skip: ReadonlySet<number>, syncArgs: () => void, duplicateIndices?: Set<number>, cache?: PathProbeCache, resolvedArgs?: string[], grepHasRecurse?: boolean): { handled: boolean; needsRecurse: boolean } {
  const extMatch = rawPath.match(ARGV_CODE_EXT_RE);
  if (extMatch === null) return { handled: false, needsRecurse: false };
  const withoutExt = rawPath.slice(0, -extMatch[0].length);
  if (withoutExt.length === 0 || ARGV_TRAIL_SEP_RE.test(withoutExt)) return { handled: false, needsRecurse: false };
  const normalizedWithoutExt = isWslPath ? normalizeMntPathForHost(withoutExt) : withoutExt;
  const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(cwd, normalizedWithoutExt);
  if (!isDirectoryPath(resolvedWithoutExt, cache)) return { handled: false, needsRecurse: false };
  if (SEARCH_TOOLS.has(base)) {
    return { handled: true, needsRecurse: healSearchDirectory(args, base, index, arg, withoutExt, cwd, skip, syncArgs, duplicateIndices, resolvedArgs, grepHasRecurse) };
  }
  const foundBarrel = findBarrelName(resolvedWithoutExt, cache);
  if (foundBarrel === null) return { handled: false, needsRecurse: false };
  const sep = withoutExt.includes('\\') ? '\\' : '/';
  const healedBarrel = preserveQuotes(arg, `${withoutExt}${sep}${foundBarrel}`);
  if (applyHeal(args, index, healedBarrel, cwd, skip, resolvedArgs) === 'healed') {
    syncArgs();
    logPathHeal(`File '${arg}' not found on disk, but directory '${withoutExt}' exists with entrypoint '${foundBarrel}'.`, `Auto-correcting path to '${healedBarrel}'... (Frictionless Recovery)`);
  }
  return { handled: true, needsRecurse: false };
}

function healSearchDirectory(args: string[], base: string, index: number, arg: string, withoutExt: string, cwd: string, skip: ReadonlySet<number>, syncArgs: () => void, duplicateIndices?: Set<number>, resolvedArgs?: string[], grepHasRecurse?: boolean): boolean {
  const healedDir = preserveQuotes(arg, withoutExt);
  const outcome = applyHeal(args, index, healedDir, cwd, skip, resolvedArgs);
  if (outcome === 'healed') {
    syncArgs();
    logPathHeal(`File '${arg}' not found, but modular directory '${withoutExt}' exists.`, `Auto-correcting path to '${healedDir}'... (Frictionless Recovery)`);
    return GREP_TOOLS.has(base) && grepHasRecurse !== true;
  }
  if (outcome === 'duplicate' && duplicateIndices !== undefined) {
    duplicateIndices.add(index);
  }
  return false;
}

function healAddedExtension(args: string[], index: number, arg: string, resolved: string, hadTrailingSlash: boolean, cwd: string, isWslPath: boolean, isSearchOrListTool: boolean, skip: ReadonlySet<number>, syncArgs: () => void, duplicateIndices?: Set<number>, cache?: PathProbeCache, resolvedArgs?: string[]): 'healed' | 'blocked' | 'none' {
  const cleanResolved = resolved.replace(/[\\/]+$/, '');
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (hadTrailingSlash && !CODE_MODULE_EXTENSIONS.has(ext)) continue;
    const candidate = cleanResolved + ext;
    if (!isFilePath(candidate, cache)) continue;
    const healedArg = formatHealedPath(arg, candidate, cwd, isWslPath);
    const outcome = applyHeal(args, index, healedArg, cwd, skip, resolvedArgs);
    if (outcome !== 'healed') {
      if (outcome === 'duplicate' && isSearchOrListTool && duplicateIndices !== undefined) {
        duplicateIndices.add(index);
      }
      return 'blocked';
    }
    syncArgs();
    logPathHeal(`Path '${arg}' not found on disk, but '${healedArg}' exists.`, `Auto-correcting path to '${healedArg}'... (Frictionless Recovery)`);
    return 'healed';
  }
  return 'none';
}

function healNeighborArg(args: string[], base: string, index: number, arg: string, rawPath: string, resolved: string, hadTrailingSlash: boolean, cwd: string, isWslPath: boolean, skip: ReadonlySet<number>, syncArgs: () => void, duplicateIndices?: Set<number>, cache?: PathProbeCache, resolvedArgs?: string[], grepHasRecurse?: boolean): boolean {
  const isSearchOrListTool = SEARCH_OR_LIST.has(base);
  if (!isSearchOrListTool && !rawPath.includes('/') && !rawPath.includes('\\')) return false;
  const candidatePath = resolvePathWithDirectorySynonyms(resolved, isSearchOrListTool, cache)
    ?? resolveBuildSrcSwap(resolved, isSearchOrListTool, cache)
    ?? (hadTrailingSlash ? null : findNeighborFilePath(resolved, isSearchOrListTool, cache));
  if (candidatePath === null) return false;
  const isDir = isDirectoryPath(candidatePath, cache);
  if (hadTrailingSlash && !isDir) return false;
  const healedArg = formatHealedPath(arg, candidatePath, cwd, isWslPath);
  const outcome = applyHeal(args, index, healedArg, cwd, skip, resolvedArgs);
  if (outcome !== 'healed') {
    if (outcome === 'duplicate' && isSearchOrListTool && duplicateIndices !== undefined) {
      duplicateIndices.add(index);
    }
    return false;
  }
  syncArgs();
  const kind = isDir ? 'Directory' : 'File';
  logPathHeal(`${kind} '${arg}' not found on disk, but found at '${healedArg}'.`, `Auto-correcting path to '${healedArg}'... (Frictionless Recovery)`);
  return isDir && GREP_TOOLS.has(base) && grepHasRecurse !== true;
}

function healFileToolArgs(args: string[], base: string, cwd: string, skip: Set<number>, syncArgs: () => void, probeCache: PathProbeCache): void {
  let recurseDirArg: string | null = null;
  let pendingGrepRecurse = false;
  const isGrepTool = GREP_TOOLS.has(base);
  const grepHasRecurse = isGrepTool && hasGrepRecurse(args);
  const isSearchOrListTool = SEARCH_OR_LIST.has(base);
  const duplicateIndices = new Set<number>();
  const resolvedArgs = buildResolvedArgArray(args, cwd);
  for (let index = 0; index < args.length; index += 1) {
    if (skip.has(index)) continue;
    const arg = args[index];
    if (shouldSkipArg(arg) || arg === undefined) continue;
    const rawPath = arg.replace(/^['"]|['"]$/g, '');
    const hadTrailingSlash = ARGV_TRAIL_SEP_RE.test(rawPath);
    const isWslPath = WSL_DRIVE_MNT_RE.test(rawPath);
    const wslNormalized = isWslPath ? normalizeMntPathForHost(rawPath) : rawPath;
    const resolved = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
    const existingKind = statPathKind(resolved, probeCache);
    if (existingKind !== null) {
      if (existingKind === 'dir' && isGrepTool && !grepHasRecurse) {
        pendingGrepRecurse = true;
        recurseDirArg ??= arg;
      }
      continue;
    }
    if (MULTI_TARGET_FILE_TOOLS.has(base)) {
      const splitParts = splitJoinedFileArg(arg, cwd, probeCache);
      if (splitParts !== null) {
        args.splice(index, 1, ...splitParts);
        resolvedArgs.splice(index, 1, ...splitParts.map((part) => (part.startsWith('-') ? '' : resolveArgForCompare(part, cwd))));
        shiftSkipIndices(skip, index, splitParts.length - 1);
        syncArgs();
        logPathHeal(
          `Single argument '${arg.slice(0, 80)}${arg.length > 80 ? '...' : ''}' contains ${splitParts.length} space-separated paths.`,
          `Splitting into ${splitParts.length} individual path arguments... (Frictionless Recovery)`,
        );
        index -= 1;
        continue;
      }
    }
    const modularResult = healModularDirectory(args, base, index, arg, rawPath, isWslPath, cwd, skip, syncArgs, duplicateIndices, probeCache, resolvedArgs, grepHasRecurse);
    if (modularResult.handled) {
      if (modularResult.needsRecurse) pendingGrepRecurse = true;
      continue;
    }
    const extensionResult = healAddedExtension(args, index, arg, resolved, hadTrailingSlash, cwd, isWslPath, isSearchOrListTool, skip, syncArgs, duplicateIndices, probeCache, resolvedArgs);
    if (extensionResult !== 'none') continue;
    if (healNeighborArg(args, base, index, arg, rawPath, resolved, hadTrailingSlash, cwd, isWslPath, skip, syncArgs, duplicateIndices, probeCache, resolvedArgs, grepHasRecurse)) {
      pendingGrepRecurse = true;
    }
  }
  if (isSearchOrListTool && duplicateIndices.size > 0) {
    const sorted = [...duplicateIndices].sort((a, b) => b - a);
    const removedArgs: string[] = [];
    for (const rmIdx of sorted) {
      if (args.length <= 1) break;
      const [removed] = args.splice(rmIdx, 1);
      if (removed !== undefined) removedArgs.push(removed);
    }
    if (removedArgs.length > 0) {
      syncArgs();
      logPathHeal(
        `Search target(s) '${removedArgs.join(', ')}' do not exist on disk and resolve to sibling path(s) already present in arguments.`,
        `Removed redundant broken search path(s) so search proceeds against existing target(s)... (Frictionless Recovery)`,
      );
    }
  }
  if (pendingGrepRecurse && !hasGrepRecurse(args)) {
    args.unshift('-r');
    syncArgs();
    if (recurseDirArg !== null) {
      logPathHeal(`'grep' called on directory '${recurseDirArg}' without recursive flag.`, `Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)`);
    } else {
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
    }
  }
}

export function healPathHallucinations(ctx: ExecutionContext): void {
  const rawPayloadCwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
    ? ctx.payload.cwd.trim().replace(/^['"]|['"]$/g, '')
    : undefined;
  const payloadCwd = rawPayloadCwd !== undefined && rawPayloadCwd.length > 0 ? rawPayloadCwd : undefined;
  const isNonHostWslCwd = process.platform === 'win32'
    && payloadCwd !== undefined
    && ((payloadCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(payloadCwd)) || payloadCwd.startsWith('~'));
  const nonPosixPayloadCwd = payloadCwd !== undefined && !isNonHostWslCwd ? payloadCwd : undefined;
  const hostCtxCwd = ctx.cwd !== undefined && ctx.cwd.length > 0 &&
    !(process.platform === 'win32' && ((ctx.cwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(ctx.cwd)) || ctx.cwd.startsWith('~')))
    ? ctx.cwd
    : undefined;
  const rawCwd = nonPosixPayloadCwd ?? hostCtxCwd ?? process.cwd();
  // [INVARIANT]: cli-loader substitutes Windows process.cwd() when payload.cwd targets a WSL internal/tilde path,
  // so host-relative Win32 path probing must always be skipped whenever payload.cwd (or fallback ctx.cwd) is a non-host WSL path.
  const skipHostRelative = isNonHostWslCwd || (payloadCwd === undefined && ctx.cwd !== undefined && ctx.cwd.length > 0 && hostCtxCwd === undefined);
  const normRawCwd = normalizeMntPathForHost(rawCwd);
  const normBaseCwd = hostCtxCwd !== undefined ? normalizeMntPathForHost(hostCtxCwd) : hostCtxCwd;
  const cwd = nonPosixPayloadCwd !== undefined && normBaseCwd !== undefined
    ? path.resolve(normBaseCwd, normRawCwd)
    : path.resolve(normRawCwd);
  if (!skipHostRelative) healEvalPayload(ctx, cwd);
  else if (ctx.payload.type === 'eval' && typeof ctx.payload.code === 'string') resolveEvalExecutionTarget(ctx.payload);
  if (skipHostRelative) return;
  const { args } = ctx;
  const syncArgs = (): void => { if (ctx.payload.type === 'command') ctx.payload.args = args; };
  const rawBase = ctx.cmdBasename.toLowerCase();
  const base = rawBase.replace(/\.(?:exe|cmd)$/i, '');
  if (!FILE_TOOLS.has(rawBase) && !FILE_TOOLS.has(base)) return;
  const skip = new Set<number>();
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, args);
  if (patternIdx !== -1) skip.add(patternIdx);
  // [INVARIANT]: Values of value-taking flags (globs, types, patterns, context counts) are never paths to heal.
  skipFlagValues(base, args, skip);
  if (base === 'bun' && skipBunPositionals(args, skip)) return;
  if (base === 'node') skipNodeTail(args, skip);
  const probeCache = createPathProbeCache();
  healBackupPaths(args, skip, cwd, syncArgs, probeCache);
  healMcpConfigPaths(args, skip, cwd, syncArgs, probeCache);
  // [INVARIANT]: Never heal an arg into a duplicate of another existing arg (e.g. two copies of the same file).
  healFileToolArgs(args, base, cwd, skip, syncArgs, probeCache);
}
