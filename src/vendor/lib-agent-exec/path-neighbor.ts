// @ts-nocheck
import os from 'node:os';
import path from 'node:path';
import {
  CANDIDATE_EXTENSIONS,
  cachedReaddirSync,
  isDirectoryPath,
  isFileSystemRoot,
  isIgnoredEntryName,
  isRepositoryRoot,
  normalizedEntryKey,
  statPathKind,
  type PathProbeCache,
} from './path-healer.js';
import { extensionAccepted, getFileCandidates } from './path-neighbor-candidates.js';

const PREFERRED_DIRS: ReadonlySet<string> = new Set(['tools', 'src', 'handlers', 'lib']);
const TRIAL_EXTS = ['.ts', '.js', '.mjs', '.tsx', '.jsx', '.json'] as const;
const GENERIC_CROSS_MODULE_STEMS: ReadonlySet<string> = new Set([
  'index', 'types', 'type', 'schema', 'schemas', 'utils', 'util', 'helpers', 'helper',
  'config', 'constants', 'common', 'shared', 'errors', 'error', 'models', 'model',
  'interfaces', 'interface', 'adapter', 'client', 'server', 'main', 'app', 'core',
  'base', 'test', 'tests', 'spec', 'specs',
]);

function uniqueCandidate(candidates: string[]): string | null {
  if (candidates.length === 1 && candidates[0] !== undefined) return candidates[0];
  return null;
}

function directoryMatchesStem(matchPath: string, fileBase: string): boolean {
  const dirName = path.basename(path.dirname(matchPath)).toLowerCase();
  return dirName === fileBase || dirName === `${fileBase}s` || dirName.startsWith(fileBase) || fileBase.startsWith(dirName);
}

function pickUniqueMatch(matches: string[], filename: string): string | null {
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length < 2) return null;
  const fileBase = path.parse(filename).name.toLowerCase();
  let preferred = matches.filter((matchPath) => directoryMatchesStem(matchPath, fileBase));
  if (preferred.length === 0) {
    preferred = matches.filter((matchPath) => PREFERRED_DIRS.has(path.basename(path.dirname(matchPath)).toLowerCase()));
  }
  if (preferred.length === 1 && preferred[0] !== undefined) return preferred[0];
  return null;
}

function collectChildMatches(rootDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string[] {
  const matches: string[] = [];
  const entries = cachedReaddirSync(rootDir, cache);
  if (entries === null) return matches;
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredEntryName(entry.name)) continue;
    matches.push(...getFileCandidates(path.join(rootDir, entry.name), filename, allowDirectories, true, undefined, true, cache));
  }
  return matches;
}

function matchInParent(parentDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (!isDirectoryPath(parentDir, cache)) return null;
  return uniqueCandidate(getFileCandidates(parentDir, filename, allowDirectories, true, undefined, true, cache));
}

function matchInGrandparent(parentIsRoot: boolean, grandparentDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (parentIsRoot || !isDirectoryPath(grandparentDir, cache)) return null;
  return uniqueCandidate(getFileCandidates(grandparentDir, filename, allowDirectories, true, undefined, true, cache));
}

function matchInParentSubdirs(parentDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (isFileSystemRoot(parentDir) || isTempRoot(parentDir) || !isDirectoryPath(parentDir, cache)) return null;
  return pickUniqueMatch(collectChildMatches(parentDir, filename, allowDirectories, cache), filename);
}

function matchCollapsedModule(grandparentDir: string, parentDir: string, filename: string, cache?: PathProbeCache): string | null {
  const parentBase = path.basename(parentDir);
  const ext = path.extname(filename);
  const targetFile = ext.length > 0 ? `${parentBase}${ext}` : parentBase;
  const preRead = cachedReaddirSync(grandparentDir, cache) ?? undefined;
  const parentFile = uniqueCandidate(getFileCandidates(grandparentDir, targetFile, false, true, preRead, true, cache));
  if (parentFile !== null) return parentFile;
  if (ext.length > 0) return null;
  for (const trialExt of TRIAL_EXTS) {
    const trial = uniqueCandidate(getFileCandidates(grandparentDir, `${parentBase}${trialExt}`, false, true, preRead, true, cache));
    if (trial !== null) return trial;
  }
  return null;
}

function matchMissingParent(parentIsRoot: boolean, parentDir: string, grandparentDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (parentIsRoot || statPathKind(parentDir, cache) !== null || !isDirectoryPath(grandparentDir, cache)) return null;
  const collapsed = matchCollapsedModule(grandparentDir, parentDir, filename, cache);
  if (collapsed !== null) return collapsed;
  return pickUniqueMatch(collectChildMatches(grandparentDir, filename, allowDirectories, cache), filename);
}

function existingAllowedPath(candidate: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  const kind = statPathKind(candidate, cache);
  if (kind === 'file' || (allowDirectories && kind === 'dir')) return candidate;
  return null;
}

function matchNestedSubdir(subDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  return pickUniqueMatch(collectChildMatches(subDir, filename, allowDirectories, cache), filename);
}

function matchSiblingSubtree(siblingModuleDir: string, parentDir: string, filename: string, relFromGrandparent: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  const exactSubtree = existingAllowedPath(path.join(siblingModuleDir, relFromGrandparent), allowDirectories, cache);
  if (exactSubtree !== null) return exactSubtree;
  const subDir = path.join(siblingModuleDir, path.basename(parentDir));
  if (!isDirectoryPath(subDir, cache)) return null;
  const subCandidate = uniqueCandidate(getFileCandidates(subDir, filename, allowDirectories, true, undefined, true, cache));
  if (subCandidate !== null) return subCandidate;
  return matchNestedSubdir(subDir, filename, allowDirectories, cache);
}

function matchSiblingDirect(siblingModuleDir: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  // [INVARIANT]: Never drop parentDir context to hijack generic basenames or lossy single-word splits into unrelated sibling modules.
  const stem = path.parse(filename).name.toLowerCase();
  if (GENERIC_CROSS_MODULE_STEMS.has(stem)) return null;
  return uniqueCandidate(getFileCandidates(siblingModuleDir, filename, allowDirectories, false, undefined, true, cache));
}

function matchGreatGrandparent(parentIsRoot: boolean, grandparentIsRoot: boolean, grandparentDir: string, greatGrandparentDir: string, resolved: string, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  if (parentIsRoot || grandparentIsRoot || isFileSystemRoot(greatGrandparentDir) || isRepositoryRoot(greatGrandparentDir, cache) || !isDirectoryPath(greatGrandparentDir, cache)) {
    return null;
  }
  if (isIgnoredEntryName(path.basename(grandparentDir), true) || isIgnoredEntryName(path.basename(greatGrandparentDir), true)) {
    return null;
  }
  const entries = cachedReaddirSync(greatGrandparentDir, cache);
  if (entries === null) return null;
  const relFromGrandparent = path.relative(grandparentDir, resolved);
  const parentDir = parentDirFrom(resolved);
  const subtreeMatches: string[] = [];
  const directMatches: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredEntryName(entry.name, true)) continue;
    const siblingModuleDir = path.join(greatGrandparentDir, entry.name);
    const isSameParent = process.platform === 'win32'
      ? siblingModuleDir.toLowerCase() === grandparentDir.toLowerCase()
      : siblingModuleDir === grandparentDir;
    if (isSameParent) continue;
    const subtreeFound = matchSiblingSubtree(siblingModuleDir, parentDir, filename, relFromGrandparent, allowDirectories, cache);
    if (subtreeFound !== null) {
      subtreeMatches.push(subtreeFound);
      continue;
    }
    const directFound = matchSiblingDirect(siblingModuleDir, filename, allowDirectories, cache);
    if (directFound !== null) directMatches.push(directFound);
  }
  return uniqueCandidate(subtreeMatches) ?? uniqueCandidate(directMatches);
}

function parentDirFrom(resolved: string): string {
  return path.dirname(resolved);
}

interface ShallowTargetMeta {
  filename: string;
  normTarget: string;
  targetNoExt: string;
  targetExt: string;
  loweredFile: string;
  candidateLowerNames: ReadonlySet<string>;
}

function buildShallowTargetMeta(filename: string): ShallowTargetMeta {
  const loweredFile = filename.toLowerCase();
  const targetExt = path.extname(filename);
  const candidateLowerNames = new Set<string>();
  if (targetExt.length === 0) {
    for (const ext of CANDIDATE_EXTENSIONS) candidateLowerNames.add(`${loweredFile}${ext}`);
  }
  return {
    filename,
    normTarget: normalizedEntryKey(filename),
    targetNoExt: normalizedEntryKey(path.parse(filename).name),
    targetExt,
    loweredFile,
    candidateLowerNames,
  };
}

function pushShallowFile(matches: string[], fullPath: string, entryName: string, meta: ShallowTargetMeta): void {
  const loweredName = entryName.toLowerCase();
  if (loweredName === meta.loweredFile || (meta.targetExt.length === 0 && meta.candidateLowerNames.has(loweredName))) {
    matches.push(fullPath);
    return;
  }
  if (meta.targetExt.length > 0 && normalizedEntryKey(path.parse(entryName).name) === meta.targetNoExt && extensionAccepted(entryName, meta.filename)) {
    matches.push(fullPath);
  }
}

function scanShallow(dir: string, depth: number, meta: ShallowTargetMeta, allowDirectories: boolean, matches: string[], cache?: PathProbeCache, skipDir?: string): void {
  if (depth > 2 || matches.length > 1) return;
  const entries = cachedReaddirSync(dir, cache);
  if (entries === null) return;
  const skipNorm = skipDir !== undefined ? (process.platform === 'win32' ? skipDir.toLowerCase() : skipDir) : undefined;
  for (const entry of entries) {
    if (matches.length > 1) return;
    if (isIgnoredEntryName(entry.name, true)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipNorm !== undefined && (process.platform === 'win32' ? fullPath.toLowerCase() : fullPath) === skipNorm) {
        continue;
      }
      if (allowDirectories && (entry.name.toLowerCase() === meta.loweredFile || normalizedEntryKey(entry.name) === meta.normTarget)) {
        matches.push(fullPath);
        if (matches.length > 1) return;
      }
      scanShallow(fullPath, depth + 1, meta, allowDirectories, matches, cache);
      continue;
    }
    if (entry.isFile()) pushShallowFile(matches, fullPath, entry.name, meta);
  }
}

const RESOLVED_TMP_ROOT = path.resolve(os.tmpdir());
const RESOLVED_TMP_ROOT_KEY = process.platform === 'win32' ? RESOLVED_TMP_ROOT.toLowerCase() : RESOLVED_TMP_ROOT;

function isTempRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return (process.platform === 'win32' ? resolved.toLowerCase() : resolved) === RESOLVED_TMP_ROOT_KEY;
}

function isBoundaryRoot(dir: string, cache?: PathProbeCache): boolean {
  return isFileSystemRoot(dir) || isRepositoryRoot(dir, cache) || isTempRoot(dir);
}

function shallowSearchRoots(parentDir: string, grandparentDir: string, parentIsRoot: boolean, grandparentIsRoot: boolean, cache?: PathProbeCache): string[] {
  // [INVARIANT]: Never climb out of a top-level directory (e.g., src/) across the repository root into sibling trees (e.g., test-server/).
  const pending = [parentDir, parentIsRoot || grandparentIsRoot ? null : grandparentDir];
  return pending.filter((dir): dir is string => dir !== null && !isFileSystemRoot(dir) && !isTempRoot(dir) && !isIgnoredEntryName(path.basename(dir), true) && isDirectoryPath(dir, cache));
}

function matchShallowScan(parentDir: string, grandparentDir: string, parentIsRoot: boolean, grandparentIsRoot: boolean, filename: string, allowDirectories: boolean, cache?: PathProbeCache): string | null {
  const roots = shallowSearchRoots(parentDir, grandparentDir, parentIsRoot, grandparentIsRoot, cache);
  const scannedParent = roots.includes(parentDir);
  const meta = buildShallowTargetMeta(filename);
  for (const root of roots) {
    const matches: string[] = [];
    const skipDir = scannedParent && root === grandparentDir ? parentDir : undefined;
    scanShallow(root, 0, meta, allowDirectories, matches, cache, skipDir);
    if (matches.length === 1) return matches[0] ?? null;
  }
  return null;
}

export function findNeighborFilePath(resolved: string, allowDirectories = false, cache?: PathProbeCache): string | null {
  const filename = path.basename(resolved);
  if (filename.length === 0 || filename === '.' || filename === '..') return null;
  const parentDir = path.dirname(resolved);
  const grandparentDir = path.dirname(parentDir);
  const greatGrandparentDir = path.dirname(grandparentDir);
  const parentIsRoot = isBoundaryRoot(parentDir, cache);
  const grandparentIsRoot = isBoundaryRoot(grandparentDir, cache);
  return matchInParent(parentDir, filename, allowDirectories, cache)
    ?? matchInGrandparent(parentIsRoot, grandparentDir, filename, allowDirectories, cache)
    ?? matchInParentSubdirs(parentDir, filename, allowDirectories, cache)
    ?? matchMissingParent(parentIsRoot, parentDir, grandparentDir, filename, allowDirectories, cache)
    ?? (isTempRoot(greatGrandparentDir) ? null : matchGreatGrandparent(parentIsRoot, grandparentIsRoot, grandparentDir, greatGrandparentDir, resolved, filename, allowDirectories, cache))
    ?? matchShallowScan(parentDir, grandparentDir, parentIsRoot, grandparentIsRoot, filename, allowDirectories, cache);
}
