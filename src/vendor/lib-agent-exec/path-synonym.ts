// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_TO_SRC_SWAPS, DIRECTORY_SYNONYMS, isDirectoryPath } from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';

const BUILD_OUTPUT_DIRS: ReadonlySet<string> = new Set(['dist', 'build', 'out']);

function exactSynonymHit(current: string, syn: string, remaining: string[], allowDirectories: boolean): string | null {
  const candidateBase = path.join(current, syn);
  if (!isDirectoryPath(candidateBase)) return null;
  if (remaining.length === 0) return allowDirectories ? candidateBase : null;
  const candidateFull = path.join(candidateBase, ...remaining);
  if (fs.existsSync(candidateFull) && (allowDirectories || !fs.statSync(candidateFull).isDirectory())) return candidateFull;
  return null;
}

function nestedSynonymHit(current: string, syn: string, remaining: string[], allowDirectories: boolean): string | null {
  if (remaining.length === 0) return null;
  const candidateBase = path.join(current, syn);
  if (!isDirectoryPath(candidateBase)) return null;
  const candidateFull = path.join(candidateBase, ...remaining);
  return resolvePathWithDirectorySynonyms(candidateFull, allowDirectories)
    ?? findNeighborFilePath(candidateFull, allowDirectories);
}

function resolveSegmentSynonyms(current: string, synonyms: readonly string[], remaining: string[], allowDirectories: boolean): string | null {
  for (const syn of synonyms) {
    const exact = exactSynonymHit(current, syn, remaining, allowDirectories);
    if (exact !== null) return exact;
  }
  for (const syn of synonyms) {
    const nested = nestedSynonymHit(current, syn, remaining, allowDirectories);
    if (nested !== null) return nested;
  }
  return null;
}

export function resolvePathWithDirectorySynonyms(resolvedPath: string, allowDirectories = false): string | null {
  if (fs.existsSync(resolvedPath) && (allowDirectories || !fs.statSync(resolvedPath).isDirectory())) return resolvedPath;
  const root = path.parse(resolvedPath).root;
  const segments = resolvedPath.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (let idx = 0; idx < segments.length; idx += 1) {
    const seg = segments[idx];
    if (seg === undefined) break;
    const nextPath = path.join(current, seg);
    if (fs.existsSync(nextPath)) {
      current = nextPath;
      continue;
    }
    const hit = resolveSegmentSynonyms(current, DIRECTORY_SYNONYMS[seg.toLowerCase()] ?? [], segments.slice(idx + 1), allowDirectories);
    if (hit !== null) return hit;
    break;
  }
  return null;
}

function firstSwapHit(resolvedPath: string, regex: RegExp, from: string, toList: readonly string[], sep1: string, sep2: string, allowDirectories: boolean): string | null {
  for (const to of toList) {
    const swapped = resolvedPath.replace(regex, `${sep1}${to}${sep2}`);
    if (fs.existsSync(swapped) && (allowDirectories || !fs.statSync(swapped).isDirectory())) return swapped;
    if (from.toLowerCase() === 'src' && BUILD_OUTPUT_DIRS.has(to.toLowerCase())) continue;
    const neighbor = findNeighborFilePath(swapped, allowDirectories);
    if (neighbor !== null) return neighbor;
  }
  return null;
}

export function resolveBuildSrcSwap(resolvedPath: string, allowDirectories = false): string | null {
  for (const [from, toList] of Object.entries(BUILD_TO_SRC_SWAPS)) {
    const regex = new RegExp(`([\\\\/])${from}([\\\\/])`, 'i');
    const matchResult = resolvedPath.match(regex);
    const sep1 = matchResult?.[1];
    const sep2 = matchResult?.[2];
    if (sep1 === undefined || sep2 === undefined) continue;
    const hit = firstSwapHit(resolvedPath, regex, from, toList, sep1, sep2, allowDirectories);
    if (hit !== null) return hit;
  }
  return null;
}
