// @ts-nocheck
import path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  BARREL_CANDIDATES,
  CANDIDATE_EXTENSIONS,
  CANDIDATE_EXTENSION_SET,
  DIRECTORY_SYNONYMS,
  FILE_STEM_SYNONYMS,
  JS_MODULE_EXTS,
  TS_MODULE_EXTS,
  altModuleExtensions,
  cachedReaddirSync,
  isDirectoryPath,
  isFilePath,
  isIgnoredEntryName,
  normalizedEntryKey,
  statPathKind,
  type PathProbeCache,
} from './path-healer.js';

const MODIFIER_RE = /^(.+?)[._-](?:handlers?|controllers?|services?|routes?|routers?|schemas?|tools?|tests?|specs?|utils?|adapters?|creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?)\.(ts|js|tsx|jsx|mjs|cjs)$/i;
const PREFIX_RE = /^(?:creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?|finds?|search)[._-](.+?)\.(ts|js|tsx|jsx|mjs|cjs)$/i;
const CODE_EXT_RE = /\.(ts|js|tsx|jsx|mjs|cjs)$/i;
const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|js|tsx|jsx|mjs|cjs)$/i;

type ChildKindProbe = (name: string) => 'file' | 'dir' | null;

function createDirProbe(dir: string, getEntries: () => readonly Dirent[] | null, cache?: PathProbeCache): ChildKindProbe {
  let entryMap: Map<string, Dirent> | null | undefined;
  return (name: string): 'file' | 'dir' | null => {
    if (entryMap === undefined) {
      const entries = getEntries();
      if (entries === null) {
        entryMap = null;
      } else {
        entryMap = new Map();
        for (const entry of entries) {
          const key = process.platform === 'win32' ? entry.name.toLowerCase() : entry.name;
          entryMap.set(key, entry);
        }
      }
    }
    if (entryMap === null) return statPathKind(path.join(dir, name), cache);
    const lookupKey = process.platform === 'win32' ? name.toLowerCase() : name;
    const hit = entryMap.get(lookupKey);
    if (hit === undefined) return null;
    if (hit.isFile()) return 'file';
    if (hit.isDirectory()) return 'dir';
    return statPathKind(path.join(dir, name), cache);
  };
}

function pushFile(results: string[], candidate: string, probeChild?: ChildKindProbe, childName?: string, cache?: PathProbeCache): void {
  if (probeChild !== undefined && childName !== undefined) {
    if (probeChild(childName) === 'file') results.push(candidate);
    return;
  }
  if (isFilePath(candidate, cache)) results.push(candidate);
}

function pushBarrelMatch(results: string[], dirPath: string, allowDirs: boolean, rejectDirectoryBarrel: boolean, cache?: PathProbeCache, dirConfirmed = false): void {
  if (!dirConfirmed && !isDirectoryPath(dirPath, cache)) return;
  if (allowDirs) {
    results.push(dirPath);
    return;
  }
  const entries = cachedReaddirSync(dirPath, cache);
  if (entries !== null) {
    const entryMap = new Map<string, Dirent>();
    for (const entry of entries) {
      entryMap.set(process.platform === 'win32' ? entry.name.toLowerCase() : entry.name, entry);
    }
    for (const barrel of BARREL_CANDIDATES) {
      const key = process.platform === 'win32' ? barrel.toLowerCase() : barrel;
      const hit = entryMap.get(key);
      if (hit === undefined) continue;
      const kind = hit.isFile() ? 'file' : (hit.isDirectory() ? 'dir' : statPathKind(path.join(dirPath, barrel), cache));
      if (kind === 'file' || (!rejectDirectoryBarrel && kind === 'dir')) {
        results.push(path.join(dirPath, barrel));
        return;
      }
    }
    return;
  }
  for (const barrel of BARREL_CANDIDATES) {
    const barrelFile = path.join(dirPath, barrel);
    const kind = statPathKind(barrelFile, cache);
    if (kind === 'file' || (!rejectDirectoryBarrel && kind === 'dir')) {
      results.push(barrelFile);
      return;
    }
  }
}

function pushAltStems(results: string[], dir: string, stem: string, currentExt: string, alts: readonly string[], probeChild: ChildKindProbe): void {
  for (const ext of alts) {
    if (ext === currentExt) continue;
    const name = `${stem}${ext}`;
    pushFile(results, path.join(dir, name), probeChild, name);
  }
}

function collectModifierCandidates(dir: string, base: string, allowDirs: boolean, results: string[], probeChild: ChildKindProbe, cache?: PathProbeCache): void {
  // [INVARIANT]: Never strip `.test` / `.spec` from a test filename to hijack it onto a production source file.
  if (TEST_FILE_RE.test(base)) return;
  const modifierMatch = base.match(MODIFIER_RE);
  const stem = modifierMatch?.[1];
  const ext = modifierMatch?.[2];
  if (stem === undefined || ext === undefined) return;
  const stripped = `${stem}.${ext}`;
  pushFile(results, path.join(dir, stripped), probeChild, stripped);
  pushAltStems(results, dir, path.parse(stripped).name, `.${ext}`.toLowerCase(), ['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs'], probeChild);
  if (probeChild(stem) === 'dir') pushBarrelMatch(results, path.join(dir, stem), allowDirs, false, cache, true);
}

function collectPrefixCandidates(dir: string, base: string, results: string[], probeChild: ChildKindProbe): void {
  const prefixMatch = base.match(PREFIX_RE);
  const entity = prefixMatch?.[1];
  const ext = prefixMatch?.[2];
  if (entity === undefined || ext === undefined) return;
  for (const variant of [entity, `${entity}s`, entity.replace(/s$/, '')]) {
    const name = `${variant}.${ext}`;
    pushFile(results, path.join(dir, name), probeChild, name);
  }
}

function pushCompoundPart(results: string[], dir: string, part: string, ext: string, allowDirs: boolean, probeChild: ChildKindProbe, cache?: PathProbeCache): void {
  if (probeChild(part) === 'dir') pushBarrelMatch(results, path.join(dir, part), allowDirs, true, cache, true);
  const name = `${part}.${ext}`;
  pushFile(results, path.join(dir, name), probeChild, name);
}

function tokenPermutationKey(stem: string): string | null {
  const tokens = stem.toLowerCase().split(/[-_.]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return [...tokens].sort().join('\0');
}

function collectTokenPermutationCandidates(dir: string, base: string, allowDirs: boolean, results: string[], getEntries: () => readonly Dirent[] | null): void {
  if (results.length > 0) return;
  const parsed = path.parse(base);
  const targetKey = tokenPermutationKey(parsed.name);
  if (targetKey === null) return;
  const entries = getEntries();
  if (entries === null) return;
  for (const entry of entries) {
    if (isIgnoredEntryName(entry.name)) continue;
    if (entry.isDirectory()) {
      if (allowDirs && parsed.ext.length === 0 && tokenPermutationKey(entry.name) === targetKey) {
        results.push(path.join(dir, entry.name));
      }
      continue;
    }
    if (!entry.isFile() || !extensionAccepted(entry.name, base)) continue;
    if (tokenPermutationKey(path.parse(entry.name).name) === targetKey) {
      results.push(path.join(dir, entry.name));
    }
  }
}

function collectCompoundCandidates(dir: string, base: string, allowDirs: boolean, results: string[], probeChild: ChildKindProbe, cache?: PathProbeCache): void {
  if (results.length > 0 || /\s/.test(base) || TEST_FILE_RE.test(base)) return;
  const extMatch = base.match(CODE_EXT_RE);
  const ext = extMatch?.[1];
  if (extMatch === null || ext === undefined) return;
  const parts = base.slice(0, -extMatch[0].length).split(/[-_.]/);
  if (parts.length <= 1) return;
  for (const part of parts) pushCompoundPart(results, dir, part, ext, allowDirs, probeChild, cache);
}

function collectMissingExtensions(dir: string, base: string, results: string[], probeChild: ChildKindProbe): void {
  for (const ext of CANDIDATE_EXTENSIONS) {
    const name = `${base}${ext}`;
    pushFile(results, path.join(dir, name), probeChild, name);
  }
}

function collectSwappedExtensions(dir: string, base: string, results: string[], probeChild: ChildKindProbe): void {
  const alts = altModuleExtensions(path.extname(base).toLowerCase());
  if (alts === null) return;
  const stem = path.parse(base).name;
  for (const ext of alts) {
    const name = `${stem}${ext}`;
    pushFile(results, path.join(dir, name), probeChild, name);
  }
}

export function extensionAccepted(entryName: string, base: string): boolean {
  const entryExt = path.extname(entryName).toLowerCase();
  const baseExt = path.extname(base).toLowerCase();
  if (baseExt.length === 0) return CANDIDATE_EXTENSION_SET.has(entryExt);
  if (entryExt === baseExt) return true;
  const baseIsJs = JS_MODULE_EXTS.has(baseExt);
  const entryIsJs = JS_MODULE_EXTS.has(entryExt);
  const baseIsTs = TS_MODULE_EXTS.has(baseExt);
  const entryIsTs = TS_MODULE_EXTS.has(entryExt);
  return (baseIsJs && entryIsTs) || (baseIsTs && entryIsJs);
}

function namesMatchNormalized(entryName: string, normBase: string): boolean {
  const entryNorm = normalizedEntryKey(entryName);
  const entryParsed = normalizedEntryKey(path.parse(entryName).name);
  return entryNorm === normBase || entryParsed === normBase;
}

function considerNormalizedEntry(results: string[], dir: string, entry: Dirent, base: string, normBase: string, allowDirs: boolean): void {
  if (isIgnoredEntryName(entry.name)) return;
  if (!namesMatchNormalized(entry.name, normBase)) return;
  const entryPath = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    if (allowDirs) results.push(entryPath);
    return;
  }
  if (extensionAccepted(entry.name, base)) results.push(entryPath);
}

function collectNormalizedCandidates(dir: string, base: string, allowDirs: boolean, results: string[], getEntries: () => readonly Dirent[] | null): void {
  if (results.length > 0) return;
  const entries = getEntries();
  if (entries === null) return;
  const normBase = normalizedEntryKey(base);
  for (const entry of entries) considerNormalizedEntry(results, dir, entry, base, normBase, allowDirs);
}

function collectDirectorySynonyms(dir: string, base: string, allowDirs: boolean, results: string[], probeChild: ChildKindProbe): void {
  if (!allowDirs || results.length > 0) return;
  const dirKey = base.toLowerCase();
  const synonyms = Object.hasOwn(DIRECTORY_SYNONYMS, dirKey) ? (DIRECTORY_SYNONYMS[dirKey] ?? []) : [];
  for (const syn of synonyms) {
    if (probeChild(syn) === 'dir') results.push(path.join(dir, syn));
  }
}

function pushStemSynonym(results: string[], dir: string, syn: string, ext: string, probeChild: ChildKindProbe): void {
  const synName = ext.length > 0 ? `${syn}${ext}` : syn;
  if (probeChild(synName) === 'file') {
    results.push(path.join(dir, synName));
    return;
  }
  if (ext.length > 0) return;
  for (const candExt of CANDIDATE_EXTENSIONS) {
    const extName = `${syn}${candExt}`;
    if (probeChild(extName) !== 'file') continue;
    results.push(path.join(dir, extName));
    return;
  }
}

function collectStemSynonyms(dir: string, base: string, results: string[], probeChild: ChildKindProbe): void {
  if (results.length > 0) return;
  const parsedBase = path.parse(base);
  const stemKey = parsedBase.name.toLowerCase();
  const stemSynonyms = Object.hasOwn(FILE_STEM_SYNONYMS, stemKey) ? (FILE_STEM_SYNONYMS[stemKey] ?? []) : [];
  for (const syn of stemSynonyms) pushStemSynonym(results, dir, syn, parsedBase.ext.toLowerCase(), probeChild);
}

function collectModularDirectory(dir: string, base: string, allowDirs: boolean, results: string[], probeChild: ChildKindProbe, cache?: PathProbeCache): void {
  if (results.length > 0) return;
  const parsed = path.parse(base);
  if (parsed.ext.length === 0) return;
  if (probeChild(parsed.name) === 'dir') pushBarrelMatch(results, path.join(dir, parsed.name), allowDirs, true, cache, true);
}

export function getFileCandidates(dir: string, base: string, allowDirs = false, allowCompoundParts = true, preReadEntries?: readonly Dirent[], dirConfirmed = false, cache?: PathProbeCache): string[] {
  if (!dirConfirmed && !isDirectoryPath(dir, cache)) return [];
  const exact = path.join(dir, base);
  let cachedEntries: readonly Dirent[] | null | undefined = preReadEntries;
  const getEntries = (): readonly Dirent[] | null => {
    if (cachedEntries !== undefined) return cachedEntries;
    cachedEntries = cachedReaddirSync(dir, cache);
    return cachedEntries;
  };
  const probeChild = createDirProbe(dir, getEntries, cache);
  const exactKind = preReadEntries !== undefined ? probeChild(base) : statPathKind(exact, cache);
  if (exactKind === 'file' || (allowDirs && exactKind === 'dir')) return [exact];
  const results: string[] = [];
  collectModifierCandidates(dir, base, allowDirs, results, probeChild, cache);
  collectPrefixCandidates(dir, base, results, probeChild);
  collectTokenPermutationCandidates(dir, base, allowDirs, results, getEntries);
  if (allowCompoundParts) collectCompoundCandidates(dir, base, allowDirs, results, probeChild, cache);
  if (path.extname(base).length === 0) collectMissingExtensions(dir, base, results, probeChild);
  else collectSwappedExtensions(dir, base, results, probeChild);
  collectNormalizedCandidates(dir, base, allowDirs, results, getEntries);
  collectDirectorySynonyms(dir, base, allowDirs, results, probeChild);
  collectStemSynonyms(dir, base, results, probeChild);
  collectModularDirectory(dir, base, allowDirs, results, probeChild, cache);
  return Array.from(new Set(results));
}
