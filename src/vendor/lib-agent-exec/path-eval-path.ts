// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWslPath } from './command-utils.js';
import {
  BARREL_CANDIDATES,
  CANDIDATE_EXTENSIONS,
  altModuleExtensions,
  formatHealedPath,
  isDirectoryPath,
  isFilePath,
  normalizeMntPath,
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
}

export function isPosixSystemPath(rawPath: string): boolean {
  return rawPath.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawPath);
}

function cleanRaw(raw: string): string {
  return raw.replace(/[\\/]+$/, '');
}

function buildEvalPathContext(rawFilePath: string, cwd: string, target: HealTarget | undefined, allowDirs: boolean): EvalPathContext {
  const isWslPath = target === 'wsl2' || rawFilePath.startsWith('/mnt/');
  const isWindowsDrivePath = /^[a-zA-Z]:[/\\]/.test(rawFilePath);
  const wslNormalized = isWslPath ? normalizeMntPath(rawFilePath) : rawFilePath;
  const resolvedPath = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
  return { rawFilePath, resolvedPath, isWslPath, isWindowsDrivePath, target, allowDirs, cwd };
}

function toWslOrDisplay(absPath: string, display: string, ctx: EvalPathContext, slashSource: string): string {
  if (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || slashSource.includes('\\'))) return convertToWslPath(absPath);
  return display;
}

function healExistingEvalPath(ctx: EvalPathContext): string | null | undefined {
  if (!fs.existsSync(ctx.resolvedPath)) return undefined;
  if (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || ctx.rawFilePath.includes('\\'))) return convertToWslPath(ctx.resolvedPath);
  return null;
}

function firstBarrelDisplay(ctx: EvalPathContext, resolvedWithoutExt: string, withoutExt: string): string | null {
  for (const barrel of BARREL_CANDIDATES) {
    const barrelFile = path.join(resolvedWithoutExt, barrel);
    if (!fs.existsSync(barrelFile)) continue;
    const sep = withoutExt.includes('\\') ? '\\' : '/';
    return toWslOrDisplay(barrelFile, `${withoutExt}${sep}${barrel}`, ctx, withoutExt);
  }
  return null;
}

function healEvalBarrel(ctx: EvalPathContext): string | null {
  const extMatch = ctx.rawFilePath.match(/\.(?:ts|js|tsx|jsx|mjs|cjs)$/i);
  if (extMatch === null) return null;
  const withoutExt = ctx.rawFilePath.slice(0, -extMatch[0].length);
  if (withoutExt.length === 0 || /[\\/]$/.test(withoutExt)) return null;
  const normalizedWithoutExt = ctx.isWslPath ? normalizeMntPath(withoutExt) : withoutExt;
  const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(ctx.cwd, normalizedWithoutExt);
  if (!isDirectoryPath(resolvedWithoutExt)) return null;
  if (ctx.allowDirs) return toWslOrDisplay(resolvedWithoutExt, withoutExt, ctx, withoutExt);
  return firstBarrelDisplay(ctx, resolvedWithoutExt, withoutExt);
}

function healEvalAddedExtension(ctx: EvalPathContext): string | null {
  const clean = cleanRaw(ctx.rawFilePath);
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = ctx.resolvedPath + ext;
    if (!isFilePath(candidate)) continue;
    return toWslOrDisplay(candidate, `${clean}${ext}`, ctx, clean);
  }
  return null;
}

function healEvalSwappedExtension(ctx: EvalPathContext): string | null {
  const clean = cleanRaw(ctx.rawFilePath);
  const baseExt = path.extname(ctx.rawFilePath).toLowerCase();
  const alts = altModuleExtensions(baseExt);
  if (alts === null) return null;
  for (const altExt of alts) {
    const candidate = ctx.resolvedPath.slice(0, -baseExt.length) + altExt;
    if (!isFilePath(candidate)) continue;
    return toWslOrDisplay(candidate, clean.slice(0, -baseExt.length) + altExt, ctx, clean);
  }
  return null;
}

function healEvalNeighbor(ctx: EvalPathContext): string | null {
  const clean = cleanRaw(ctx.rawFilePath);
  if (!clean.includes('/') && !clean.includes('\\')) return null;
  const neighborFile = resolvePathWithDirectorySynonyms(ctx.resolvedPath, ctx.allowDirs)
    ?? resolveBuildSrcSwap(ctx.resolvedPath, ctx.allowDirs)
    ?? findNeighborFilePath(ctx.resolvedPath, ctx.allowDirs);
  if (neighborFile === null) return null;
  const asWsl = ctx.rawFilePath.startsWith('/mnt/')
    || (ctx.target === 'wsl2' && (ctx.isWindowsDrivePath || ctx.rawFilePath.includes('\\')));
  return formatHealedPath(ctx.rawFilePath, neighborFile, ctx.cwd, asWsl);
}

function healEvalWslFallback(ctx: EvalPathContext): string | null {
  if (ctx.target === 'wsl2' && ctx.isWindowsDrivePath && !/[$`{}|;&<>\n\r]|\\[$()*?&!`]/.test(ctx.rawFilePath)) {
    return convertToWslPath(ctx.resolvedPath);
  }
  return null;
}

export function healSingleEvalPath(filePath: string, allowDirs: boolean, cwd: string, target?: HealTarget): string | null {
  const rawFilePath = filePath.replace(/^['"]|['"]$/g, '');
  if (
    rawFilePath.length === 0 ||
    rawFilePath.startsWith('-') ||
    rawFilePath.startsWith('~') ||
    rawFilePath.includes('$') ||
    rawFilePath.includes('*') ||
    rawFilePath.includes('?') ||
    isPosixSystemPath(rawFilePath)
  ) {
    return null;
  }
  const ctx = buildEvalPathContext(rawFilePath, cwd, target, allowDirs);
  const existing = healExistingEvalPath(ctx);
  if (existing !== undefined) return existing;
  return healEvalBarrel(ctx)
    ?? healEvalAddedExtension(ctx)
    ?? healEvalSwappedExtension(ctx)
    ?? healEvalNeighbor(ctx)
    ?? healEvalWslFallback(ctx);
}
