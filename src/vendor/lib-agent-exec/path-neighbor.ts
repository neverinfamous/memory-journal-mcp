// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {
  CANDIDATE_EXTENSIONS,
  isDirectoryPath,
  isFilePath,
  isFileSystemRoot,
  isIgnoredEntryName,
  isRepositoryRoot,
  normalizedEntryKey,
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

function collectChildMatches(rootDir: string, filename: string, allowDirectories: boolean): string[] {
  const matches: string[] = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredEntryName(entry.name)) continue;
    matches.push(...getFileCandidates(path.join(rootDir, entry.name), filename, allowDirectories));
  }
  return matches;
}

function matchInParent(parentDir: string, filename: string, allowDirectories: boolean): string | null {
  if (!isDirectoryPath(parentDir)) return null;
  return uniqueCandidate(getFileCandidates(parentDir, filename, allowDirectories));
}

function matchInGrandparent(parentIsRoot: boolean, grandparentDir: string, filename: string, allowDirectories: boolean): string | null {
  if (parentIsRoot || !isDirectoryPath(grandparentDir)) return null;
  return uniqueCandidate(getFileCandidates(grandparentDir, filename, allowDirectories));
}

function matchInParentSubdirs(parentDir: string, filename: string, allowDirectories: boolean): string | null {
  if (!isDirectoryPath(parentDir)) return null;
  try {
    return pickUniqueMatch(collectChildMatches(parentDir, filename, allowDirectories), filename);
  } catch { /* ignore */ }
  return null;
}

function matchCollapsedModule(grandparentDir: string, parentDir: string, filename: string): string | null {
  const parentBase = path.basename(parentDir);
  const ext = path.extname(filename);
  const targetFile = ext.length > 0 ? `${parentBase}${ext}` : parentBase;
  const parentFile = uniqueCandidate(getFileCandidates(grandparentDir, targetFile, false));
  if (parentFile !== null) return parentFile;
  if (ext.length > 0) return null;
  for (const trialExt of TRIAL_EXTS) {
    const trial = uniqueCandidate(getFileCandidates(grandparentDir, `${parentBase}${trialExt}`, false));
    if (trial !== null) return trial;
  }
  return null;
}

function matchMissingParent(parentIsRoot: boolean, parentDir: string, grandparentDir: string, filename: string, allowDirectories: boolean): string | null {
  if (parentIsRoot || fs.existsSync(parentDir) || !isDirectoryPath(grandparentDir)) return null;
  const collapsed = matchCollapsedModule(grandparentDir, parentDir, filename);
  if (collapsed !== null) return collapsed;
  try {
    return pickUniqueMatch(collectChildMatches(grandparentDir, filename, allowDirectories), filename);
  } catch { /* ignore */ }
  return null;
}

function existingAllowedPath(candidate: string, allowDirectories: boolean): string | null {
  if (isFilePath(candidate) || (allowDirectories && isDirectoryPath(candidate))) return candidate;
  return null;
}

function matchNestedSubdir(subDir: string, filename: string, allowDirectories: boolean): string | null {
  try {
    const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory() || isIgnoredEntryName(subEntry.name)) continue;
      const nested = uniqueCandidate(getFileCandidates(path.join(subDir, subEntry.name), filename, allowDirectories));
      if (nested !== null) return nested;
    }
  } catch { /* ignore */ }
  return null;
}

function matchSiblingSubtree(siblingModuleDir: string, parentDir: string, filename: string, relFromGrandparent: string, allowDirectories: boolean): string | null {
  const exactSubtree = existingAllowedPath(path.join(siblingModuleDir, relFromGrandparent), allowDirectories);
  if (exactSubtree !== null) return exactSubtree;
  const subDir = path.join(siblingModuleDir, path.basename(parentDir));
  if (!isDirectoryPath(subDir)) return null;
  const subCandidate = uniqueCandidate(getFileCandidates(subDir, filename, allowDirectories));
  if (subCandidate !== null) return subCandidate;
  return matchNestedSubdir(subDir, filename, allowDirectories);
}

function matchSiblingDirect(siblingModuleDir: string, filename: string, allowDirectories: boolean): string | null {
  // [INVARIANT]: Never drop parentDir context to hijack generic basenames or lossy single-word splits into unrelated sibling modules.
  const stem = path.parse(filename).name.toLowerCase();
  if (GENERIC_CROSS_MODULE_STEMS.has(stem)) return null;
  return uniqueCandidate(getFileCandidates(siblingModuleDir, filename, allowDirectories, false));
}

function matchGreatGrandparent(parentIsRoot: boolean, grandparentIsRoot: boolean, grandparentDir: string, greatGrandparentDir: string, resolved: string, filename: string, allowDirectories: boolean): string | null {
  if (parentIsRoot || grandparentIsRoot || !isDirectoryPath(greatGrandparentDir)) return null;
  try {
    const relFromGrandparent = path.relative(grandparentDir, resolved);
    const parentDir = parentDirFrom(resolved);
    const entries = fs.readdirSync(greatGrandparentDir, { withFileTypes: true });
    const subtreeMatches: string[] = [];
    const directMatches: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredEntryName(entry.name)) continue;
      const siblingModuleDir = path.join(greatGrandparentDir, entry.name);
      if (siblingModuleDir.toLowerCase() === grandparentDir.toLowerCase()) continue;
      const subtreeFound = matchSiblingSubtree(siblingModuleDir, parentDir, filename, relFromGrandparent, allowDirectories);
      if (subtreeFound !== null) {
        subtreeMatches.push(subtreeFound);
        continue;
      }
      const directFound = matchSiblingDirect(siblingModuleDir, filename, allowDirectories);
      if (directFound !== null) directMatches.push(directFound);
    }
    return uniqueCandidate(subtreeMatches) ?? uniqueCandidate(directMatches);
  } catch { /* ignore */ }
  return null;
}

function parentDirFrom(resolved: string): string {
  return path.dirname(resolved);
}

function pushShallowFile(matches: string[], fullPath: string, entryName: string, filename: string): void {
  const baseNoExt = normalizedEntryKey(path.parse(entryName).name);
  const targetNoExt = normalizedEntryKey(path.parse(filename).name);
  const targetExt = path.extname(filename);
  const matchesStem = targetExt.length > 0 && baseNoExt === targetNoExt && extensionAccepted(entryName, filename);
  const loweredName = entryName.toLowerCase();
  const loweredFile = filename.toLowerCase();
  const matchesExt = targetExt.length === 0 && CANDIDATE_EXTENSIONS.some((ext) => loweredName === `${loweredFile}${ext}`);
  if (loweredName === loweredFile || matchesStem || matchesExt) matches.push(fullPath);
}

function scanShallow(dir: string, depth: number, filename: string, normTarget: string, allowDirectories: boolean, matches: string[]): void {
  if (depth > 2) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (isIgnoredEntryName(entry.name, true)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const entryNorm = normalizedEntryKey(entry.name);
      if (allowDirectories && (entry.name.toLowerCase() === filename.toLowerCase() || entryNorm === normTarget)) {
        matches.push(fullPath);
      }
      scanShallow(fullPath, depth + 1, filename, normTarget, allowDirectories, matches);
      continue;
    }
    if (entry.isFile()) pushShallowFile(matches, fullPath, entry.name, filename);
  }
}

function shallowSearchRoots(parentDir: string, grandparentDir: string, parentIsRoot: boolean, grandparentIsRoot: boolean): string[] {
  // [INVARIANT]: Never climb out of a top-level directory (e.g., src/) across the repository root into sibling trees (e.g., test-server/).
  const pending = [parentDir, parentIsRoot || grandparentIsRoot ? null : grandparentDir];
  return pending.filter((dir): dir is string => dir !== null && isDirectoryPath(dir));
}

function matchShallowScan(parentDir: string, grandparentDir: string, parentIsRoot: boolean, grandparentIsRoot: boolean, filename: string, allowDirectories: boolean): string | null {
  const roots = shallowSearchRoots(parentDir, grandparentDir, parentIsRoot, grandparentIsRoot);
  for (const root of roots) {
    try {
      const matches: string[] = [];
      scanShallow(root, 0, filename, normalizedEntryKey(filename), allowDirectories, matches);
      if (matches.length === 1) return matches[0] ?? null;
    } catch { /* ignore */ }
  }
  return null;
}

export function findNeighborFilePath(resolved: string, allowDirectories = false): string | null {
  const filename = path.basename(resolved);
  if (filename.length === 0 || filename === '.' || filename === '..') return null;
  const parentDir = path.dirname(resolved);
  const grandparentDir = path.dirname(parentDir);
  const greatGrandparentDir = path.dirname(grandparentDir);
  const parentIsRoot = isFileSystemRoot(parentDir) || isRepositoryRoot(parentDir);
  const grandparentIsRoot = isFileSystemRoot(grandparentDir) || isRepositoryRoot(grandparentDir);
  return matchInParent(parentDir, filename, allowDirectories)
    ?? matchInGrandparent(parentIsRoot, grandparentDir, filename, allowDirectories)
    ?? matchInParentSubdirs(parentDir, filename, allowDirectories)
    ?? matchMissingParent(parentIsRoot, parentDir, grandparentDir, filename, allowDirectories)
    ?? matchGreatGrandparent(parentIsRoot, grandparentIsRoot, grandparentDir, greatGrandparentDir, resolved, filename, allowDirectories)
    ?? matchShallowScan(parentDir, grandparentDir, parentIsRoot, grandparentIsRoot, filename, allowDirectories);
}
