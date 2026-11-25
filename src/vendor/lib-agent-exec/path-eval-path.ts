// @ts-nocheck
import path from 'node:path';
import { convertToWslPath } from './command-utils.js';
import {
  BARREL_CANDIDATES,
  CANDIDATE_EXTENSIONS,
  altModuleExtensions,
  createPathProbeCache,
  formatHealedPath,
  isDirectoryPath,
  isFilePath,
  normalizeMntPathForHost,
  statPathKind,
  type PathProbeCache,
} from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';
import { resolveBuildSrcSwap, resolvePathWithDirectorySynonyms } from './path-synonym.js';

type HealTarget = 'windows' | 'wsl2';

interface EvalPathContext {
  rawFilePath: string;
  resolvedPath: string;
  isWslPath: boolean;
  isWindowsDrivePath: boolean;
  target: HealTarget | undefined;
  allowDirs: boolean;
  cwd: string;
  cache: PathProbeCache;
}

const EVAL_POSIX_MNT_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/i;
const EVAL_WIN_DRIVE_RE = /^[a-zA-Z]:[/\\]/;
const EVAL_TRAIL_SEP_RE = /[\\/]+$/;
const EVAL_CODE_EXT_RE = /\.(?:ts|js|tsx|jsx|mjs|cjs)$/i;
const EVAL_TRAIL_CHAR_RE = /[\\/]$/;
const EVAL_SHELL_META_RE = /[$`{}|;&<>\n\r]|\\[$()*?&!`]/;

export function isPosixSystemPath(rawPath: string): boolean {
  return rawPath.startsWith('/') && !EVAL_POSIX_MNT_RE.test(rawPath);
}

function cleanRaw(raw: string): string {
  return raw.replace(EVAL_TRAIL_SEP_RE, '');
}

function buildEvalPathContext(
  rawFilePath: string,
  cwd: string,
  target: HealTarget | undefined,
  allowDirs: boolean,
  cache: PathProbeCache,
): EvalPathContext {
  const isWslPath = target === 'wsl2' || EVAL_POSIX_MNT_RE.test(rawFilePath);
  const isWindowsDrivePath = EVAL_WIN_DRIVE_RE.test(rawFilePath);
  const wslNormalized = isWslPath ? normalizeMntPathForHost(rawFilePath) : rawFilePath;
  const resolvedPath = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
  return { rawFilePath, resolvedPath, isWslPath, isWindowsDrivePath, target, allowDirs, cwd, cache };
}

function toWslOrDisplay(absPath: string, display: string, ctx: EvalPathContext, slashSource: string): string {
  if (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || slashSource.includes('\\'))) return convertToWslPath(absPath);
  return display;
}

function healExistingEvalPath(ctx: EvalPathContext): string | null | undefined {
  if (statPathKind(ctx.resolvedPath, ctx.cache) === null) return undefined;
  if (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || ctx.rawFilePath.includes('\\'))) {
    const converted = convertToWslPath(ctx.resolvedPath);
    return converted === ctx.rawFilePath ? null : converted;
  }
  return null;
}

function firstBarrelDisplay(ctx: EvalPathContext, resolvedWithoutExt: string, withoutExt: string): string | null {
  for (const barrel of BARREL_CANDIDATES) {
    const barrelFile = path.join(resolvedWithoutExt, barrel);
    if (!isFilePath(barrelFile, ctx.cache)) continue;
    const sep = withoutExt.includes('\\') ? '\\' : '/';
    return toWslOrDisplay(barrelFile, `${withoutExt}${sep}${barrel}`, ctx, withoutExt);
  }
  return null;
}

function healEvalBarrel(ctx: EvalPathContext): string | null {
  const extMatch = ctx.rawFilePath.match(EVAL_CODE_EXT_RE);
  if (extMatch === null) return null;
  const withoutExt = ctx.rawFilePath.slice(0, -extMatch[0].length);
  if (withoutExt.length === 0 || EVAL_TRAIL_CHAR_RE.test(withoutExt)) return null;
  const normalizedWithoutExt = ctx.isWslPath ? normalizeMntPathForHost(withoutExt) : withoutExt;
  const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(ctx.cwd, normalizedWithoutExt);
  if (!isDirectoryPath(resolvedWithoutExt, ctx.cache)) return null;
  if (ctx.allowDirs) return toWslOrDisplay(resolvedWithoutExt, withoutExt, ctx, withoutExt);
  return firstBarrelDisplay(ctx, resolvedWithoutExt, withoutExt);
}

function healEvalAddedExtension(ctx: EvalPathContext): string | null {
  if (ctx.allowDirs && EVAL_TRAIL_CHAR_RE.test(ctx.rawFilePath)) return null;
  const clean = cleanRaw(ctx.rawFilePath);
  const cleanResolved = ctx.resolvedPath.replace(EVAL_TRAIL_SEP_RE, '');
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = cleanResolved + ext;
    if (!isFilePath(candidate, ctx.cache)) continue;
    return toWslOrDisplay(candidate, `${clean}${ext}`, ctx, clean);
  }
  return null;
}

function healEvalSwappedExtension(ctx: EvalPathContext): string | null {
  if (EVAL_TRAIL_CHAR_RE.test(ctx.rawFilePath)) return null;
  const clean = cleanRaw(ctx.rawFilePath);
  const baseExt = path.extname(ctx.rawFilePath).toLowerCase();
  const alts = altModuleExtensions(baseExt);
  if (alts === null) return null;
  for (const altExt of alts) {
    const candidate = ctx.resolvedPath.slice(0, -baseExt.length) + altExt;
    if (!isFilePath(candidate, ctx.cache)) continue;
    return toWslOrDisplay(candidate, clean.slice(0, -baseExt.length) + altExt, ctx, clean);
  }
  return null;
}

function healEvalNeighbor(ctx: EvalPathContext): string | null {
  const clean = cleanRaw(ctx.rawFilePath);
  if (!clean.includes('/') && !clean.includes('\\')) return null;
  const neighborFile = resolvePathWithDirectorySynonyms(ctx.resolvedPath, ctx.allowDirs, ctx.cache)
    ?? resolveBuildSrcSwap(ctx.resolvedPath, ctx.allowDirs, ctx.cache)
    ?? findNeighborFilePath(ctx.resolvedPath, ctx.allowDirs, ctx.cache);
  if (neighborFile === null) return null;
  if (EVAL_TRAIL_CHAR_RE.test(ctx.rawFilePath) && !isDirectoryPath(neighborFile, ctx.cache)) return null;
  const asWsl = EVAL_POSIX_MNT_RE.test(ctx.rawFilePath)
    || (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || ctx.rawFilePath.includes('\\')));
  return formatHealedPath(ctx.rawFilePath, neighborFile, ctx.cwd, asWsl);
}

function healEvalWslFallback(ctx: EvalPathContext): string | null {
  if (ctx.target === 'wsl2' && ctx.isWindowsDrivePath && !EVAL_SHELL_META_RE.test(ctx.rawFilePath)) {
    return convertToWslPath(ctx.resolvedPath);
  }
  return null;
}

export interface EvalPathHealResult {
  healed: string;
  normalizedOnly: boolean;
}

export function healSingleEvalPathResult(filePath: string, allowDirs: boolean, cwd: string, target?: HealTarget, preCache?: PathProbeCache): EvalPathHealResult | null {
  const rawFilePath = filePath.replace(/^['"]|['"]$/g, '');
  if (
    rawFilePath.length === 0 ||
    rawFilePath.startsWith('-') ||
    rawFilePath.startsWith('~') ||
    rawFilePath.includes('://') ||
    rawFilePath.includes('$') ||
    rawFilePath.includes('*') ||
    rawFilePath.includes('?') ||
    isPosixSystemPath(rawFilePath)
  ) {
    return null;
  }
  const cache = preCache ?? createPathProbeCache();
  const ctx = buildEvalPathContext(rawFilePath, cwd, target, allowDirs, cache);
  const existing = healExistingEvalPath(ctx);
  if (existing !== undefined) {
    return existing === null ? null : { healed: existing, normalizedOnly: true };
  }
  const healed = healEvalBarrel(ctx)
    ?? healEvalAddedExtension(ctx)
    ?? healEvalSwappedExtension(ctx)
    ?? healEvalNeighbor(ctx)
    ?? healEvalWslFallback(ctx);
  return healed === null ? null : { healed, normalizedOnly: false };
}

export function healSingleEvalPath(filePath: string, allowDirs: boolean, cwd: string, target?: HealTarget, preCache?: PathProbeCache): string | null {
  return healSingleEvalPathResult(filePath, allowDirs, cwd, target, preCache)?.healed ?? null;
}
