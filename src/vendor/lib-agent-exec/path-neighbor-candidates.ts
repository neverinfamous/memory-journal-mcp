// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  BARREL_CANDIDATES,
  CANDIDATE_EXTENSIONS,
  CANDIDATE_EXTENSION_SET,
  DIRECTORY_SYNONYMS,
  FILE_STEM_SYNONYMS,
  altModuleExtensions,
  isDirectoryPath,
  isFilePath,
  isIgnoredEntryName,
  normalizedEntryKey,
} from './path-healer.js';

const MODIFIER_RE = /^(.+?)[._-](?:handlers?|controllers?|services?|routes?|routers?|schemas?|tools?|tests?|specs?|utils?|adapters?|creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?)\.(ts|js|tsx|jsx|mjs|cjs)$/i;
const PREFIX_RE = /^(?:creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?|finds?|search)[._-](.+?)\.(ts|js|tsx|jsx|mjs|cjs)$/i;
const CODE_EXT_RE = /\.(ts|js|tsx|jsx|mjs|cjs)$/i;

function pushFile(results: string[], candidate: string): void {
  if (isFilePath(candidate)) results.push(candidate);
}

function pushBarrelMatch(results: string[], dirPath: string, allowDirs: boolean, rejectDirectoryBarrel: boolean): void {
  if (!isDirectoryPath(dirPath)) return;
  if (allowDirs) {
    results.push(dirPath);
    return;
  }
  for (const barrel of BARREL_CANDIDATES) {
    const barrelFile = path.join(dirPath, barrel);
    if (!fs.existsSync(barrelFile)) continue;
    if (rejectDirectoryBarrel && fs.statSync(barrelFile).isDirectory()) continue;
    results.push(barrelFile);
    return;
  }
}

function pushAltStems(results: string[], dir: string, stem: string, currentExt: string, alts: readonly string[]): void {
  for (const ext of alts) {
    if (ext === currentExt) continue;
    pushFile(results, path.join(dir, `${stem}${ext}`));
  }
}

function collectModifierCandidates(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  const modifierMatch = base.match(MODIFIER_RE);
  const stem = modifierMatch?.[1];
  const ext = modifierMatch?.[2];
  if (stem === undefined || ext === undefined) return;
  const stripped = `${stem}.${ext}`;
  pushFile(results, path.join(dir, stripped));
  pushAltStems(results, dir, path.parse(stripped).name, `.${ext}`.toLowerCase(), ['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs']);
  pushBarrelMatch(results, path.join(dir, stem), allowDirs, false);
}

function collectPrefixCandidates(dir: string, base: string, results: string[]): void {
  const prefixMatch = base.match(PREFIX_RE);
  const entity = prefixMatch?.[1];
  const ext = prefixMatch?.[2];
  if (entity === undefined || ext === undefined) return;
  for (const variant of [entity, `${entity}s`, entity.replace(/s$/, '')]) {
    pushFile(results, path.join(dir, `${variant}.${ext}`));
  }
}

function pushCompoundPart(results: string[], dir: string, part: string, ext: string, allowDirs: boolean): void {
  const partDir = path.join(dir, part);
  if (isDirectoryPath(partDir)) pushBarrelMatch(results, partDir, allowDirs, true);
  pushFile(results, path.join(dir, `${part}.${ext}`));
}

function tokenPermutationKey(stem: string): string | null {
  const tokens = stem.toLowerCase().split(/[-_.]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return [...tokens].sort().join('\0');
}

function collectTokenPermutationCandidates(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  if (results.length > 0) return;
  const parsed = path.parse(base);
  const targetKey = tokenPermutationKey(parsed.name);
  if (targetKey === null) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
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
  } catch { /* ignore */ }
}

function collectCompoundCandidates(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  if (results.length > 0) return;
  const extMatch = base.match(CODE_EXT_RE);
  const ext = extMatch?.[1];
  if (extMatch === null || ext === undefined) return;
  const parts = base.slice(0, -extMatch[0].length).split(/[-_.]/);
  if (parts.length <= 1) return;
  for (const part of parts) pushCompoundPart(results, dir, part, ext, allowDirs);
}

function collectMissingExtensions(exact: string, results: string[]): void {
  for (const ext of CANDIDATE_EXTENSIONS) pushFile(results, exact + ext);
}

function collectSwappedExtensions(dir: string, base: string, results: string[]): void {
  const alts = altModuleExtensions(path.extname(base).toLowerCase());
  if (alts === null) return;
  const stem = path.parse(base).name;
  for (const ext of alts) pushFile(results, path.join(dir, `${stem}${ext}`));
}

function extensionAccepted(entryName: string, base: string): boolean {
  const entryExt = path.extname(entryName).toLowerCase();
  const baseExt = path.extname(base).toLowerCase();
  if (baseExt.length === 0) return CANDIDATE_EXTENSION_SET.has(entryExt);
  if (entryExt === baseExt) return true;
  const baseIsJs = JS_MODULE_EXTS_HAS(baseExt);
  const entryIsJs = JS_MODULE_EXTS_HAS(entryExt);
  const baseIsTs = TS_MODULE_EXTS_HAS(baseExt);
  const entryIsTs = TS_MODULE_EXTS_HAS(entryExt);
  return (baseIsJs && entryIsTs) || (baseIsTs && entryIsJs);
}

function JS_MODULE_EXTS_HAS(ext: string): boolean {
  return ext === '.js' || ext === '.mjs' || ext === '.cjs';
}

function TS_MODULE_EXTS_HAS(ext: string): boolean {
  return ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts';
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

function collectNormalizedCandidates(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  if (results.length > 0) return;
  const normBase = normalizedEntryKey(base);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) considerNormalizedEntry(results, dir, entry, base, normBase, allowDirs);
  } catch { /* ignore */ }
}

function collectDirectorySynonyms(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  if (!allowDirs || results.length > 0) return;
  const synonyms = DIRECTORY_SYNONYMS[base.toLowerCase()] ?? [];
  for (const syn of synonyms) {
    const synPath = path.join(dir, syn);
    if (isDirectoryPath(synPath)) results.push(synPath);
  }
}

function pushStemSynonym(results: string[], dir: string, syn: string, ext: string): void {
  const synName = ext.length > 0 ? `${syn}${ext}` : syn;
  const synPath = path.join(dir, synName);
  if (isFilePath(synPath)) {
    results.push(synPath);
    return;
  }
  if (ext.length > 0) return;
  for (const candExt of CANDIDATE_EXTENSIONS) {
    const synExtPath = path.join(dir, `${syn}${candExt}`);
    if (!isFilePath(synExtPath)) continue;
    results.push(synExtPath);
    return;
  }
}

function collectStemSynonyms(dir: string, base: string, results: string[]): void {
  if (results.length > 0) return;
  const parsedBase = path.parse(base);
  const stemSynonyms = FILE_STEM_SYNONYMS[parsedBase.name.toLowerCase()] ?? [];
  for (const syn of stemSynonyms) pushStemSynonym(results, dir, syn, parsedBase.ext.toLowerCase());
}

function collectModularDirectory(dir: string, base: string, allowDirs: boolean, results: string[]): void {
  if (results.length > 0) return;
  const parsed = path.parse(base);
  if (parsed.ext.length === 0) return;
  pushBarrelMatch(results, path.join(dir, parsed.name), allowDirs, true);
}

export function getFileCandidates(dir: string, base: string, allowDirs = false, allowCompoundParts = true): string[] {
  if (!isDirectoryPath(dir)) return [];
  const exact = path.join(dir, base);
  if (fs.existsSync(exact) && (allowDirs || !fs.statSync(exact).isDirectory())) return [exact];
  const results: string[] = [];
  collectModifierCandidates(dir, base, allowDirs, results);
  collectPrefixCandidates(dir, base, results);
  collectTokenPermutationCandidates(dir, base, allowDirs, results);
  if (allowCompoundParts) collectCompoundCandidates(dir, base, allowDirs, results);
  if (path.extname(base).length === 0) collectMissingExtensions(exact, results);
  else collectSwappedExtensions(dir, base, results);
  collectNormalizedCandidates(dir, base, allowDirs, results);
  collectDirectorySynonyms(dir, base, allowDirs, results);
  collectStemSynonyms(dir, base, results);
  collectModularDirectory(dir, base, allowDirs, results);
  return Array.from(new Set(results));
}
