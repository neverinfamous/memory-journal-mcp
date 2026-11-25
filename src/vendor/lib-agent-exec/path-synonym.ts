// @ts-nocheck
import path from 'node:path';
import { BUILD_TO_SRC_SWAPS, DIRECTORY_SYNONYMS, isDirectoryPath, statPathKind, type PathProbeCache } from './path-healer.js';
import { findNeighborFilePath } from './path-neighbor.js';

const BUILD_OUTPUT_DIRS: ReadonlySet<string> = new Set(['dist', 'build', 'out']);

function isExistingAllowed(targetPath: string, allowDirectories: boolean, cache?: PathProbeCache): boolean {
  const kind = statPathKind(targetPath, cache);
  return kind === 'file' || (allowDirectories && kind === 'dir');
}

function exactSynonymHit(current: string, syn: string, remaining: string[], allowDirectories: boolean, cache?: PathProbeCache): { baseIsDir: boolean; hit: string | null } {
  const candidateBase = path.join(current, syn);
  if (!isDirectoryPath(candidateBase, cache)) return { baseIsDir: false, hit: null };
  if (remaining.length === 0) return { baseIsDir: true, hit: allowDirectories ? candidateBase : null };
  const candidateFull = path.join(candidateBase, ...remaining);
  return { baseIsDir: true, hit: isExistingAllowed(candidateFull, allowDirectories, cache) ? candidateFull : null };
}

function nestedSynonymHit(current: string, syn: string, remaining: string[], allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (remaining.length === 0) return null;
  const candidateFull = path.join(current, syn, ...remaining);
  return resolvePathWithDirectorySynonyms(candidateFull, allowDirectories, cache)
    ?? findNeighborFilePath(candidateFull, allowDirectories, cache);
}

function resolveSegmentSynonyms(current: string, synonyms: readonly string[], remaining: string[], allowDirectories: boolean, cache?: PathProbeCache): string | null {
  const validSynDirs: string[] = [];
  for (const syn of synonyms) {
    const exact = exactSynonymHit(current, syn, remaining, allowDirectories, cache);
    if (exact.hit !== null) return exact.hit;
    if (exact.baseIsDir) validSynDirs.push(syn);
  }
  for (const syn of validSynDirs) {
    const nested = nestedSynonymHit(current, syn, remaining, allowDirectories, cache);
    if (nested !== null) return nested;
  }
  return null;
}

export function resolvePathWithDirectorySynonyms(resolvedPath: string, allowDirectories = false, cache?: PathProbeCache): string | null {
  if (isExistingAllowed(resolvedPath, allowDirectories, cache)) return resolvedPath;
  const root = path.parse(resolvedPath).root;
  const segments = resolvedPath.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (let idx = 0; idx < segments.length; idx += 1) {
    const seg = segments[idx];
    if (seg === undefined) break;
    const nextPath = path.join(current, seg);
    if (statPathKind(nextPath, cache) !== null) {
      current = nextPath;
      continue;
    }
    const lowerSeg = seg.toLowerCase();
    const synonyms = Object.hasOwn(DIRECTORY_SYNONYMS, lowerSeg) ? DIRECTORY_SYNONYMS[lowerSeg] ?? [] : [];
    const hit = resolveSegmentSynonyms(current, synonyms, segments.slice(idx + 1), allowDirectories, cache);
    if (hit !== null) return hit;
    break;
  }
  return null;
}

const COMPILED_JS_EXT_RE = /\.(?:js|mjs|cjs)$/i;

function firstSwapHit(resolvedPath: string, regex: RegExp, from: string, toList: readonly string[], sep1: string, sep2: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  const isSrcToBuild = from.toLowerCase() === 'src';
  for (const to of toList) {
    const swapped = resolvedPath.replace(regex, `${sep1}${to}${sep2}`);
    if (isSrcToBuild && BUILD_OUTPUT_DIRS.has(to.toLowerCase())) {
      // [INVARIANT]: Never hijack missing src/ directories or TS source files to compiled dist/build/out output.
      if (!allowDirectories && COMPILED_JS_EXT_RE.test(resolvedPath) && statPathKind(swapped, cache) === 'file') return swapped;
      continue;
    }
    if (isExistingAllowed(swapped, allowDirectories, cache)) return swapped;
    if (isDirectoryPath(path.dirname(swapped), cache)) {
      const neighbor = findNeighborFilePath(swapped, allowDirectories, cache);
      if (neighbor !== null) return neighbor;
    }
  }
  return null;
}

let cachedBuildSwapRegexes: ReadonlyArray<[string, readonly string[], RegExp]> | null = null;

function getBuildSwapRegexes(): ReadonlyArray<[string, readonly string[], RegExp]> {
  if (cachedBuildSwapRegexes === null) {
    cachedBuildSwapRegexes = Object.entries(BUILD_TO_SRC_SWAPS).map(
      ([from, toList]) => [from, toList, new RegExp(`([\\\\/])${from}([\\\\/])`, 'i')],
    );
  }
  return cachedBuildSwapRegexes;
}

export function resolveBuildSrcSwap(resolvedPath: string, allowDirectories = false, cache?: PathProbeCache): string | null {
  for (const [from, toList, regex] of getBuildSwapRegexes()) {
    const matchResult = resolvedPath.match(regex);
    const sep1 = matchResult?.[1];
    const sep2 = matchResult?.[2];
    if (sep1 === undefined || sep2 === undefined) continue;
    const hit = firstSwapHit(resolvedPath, regex, from, toList, sep1, sep2, allowDirectories, cache);
    if (hit !== null) return hit;
  }
  return null;
}
