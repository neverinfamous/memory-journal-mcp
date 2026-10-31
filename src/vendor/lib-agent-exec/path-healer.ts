// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExecutionContext } from './interceptors/types.js';
import { findPatternExprIndex, convertToWslPath } from './command-utils.js';

const FILE_TOOLS = new Set([
  'rg', 'rg.exe',
  'grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe',
  'cat', 'cat.exe',
  'head', 'head.exe',
  'tail', 'tail.exe',
  'wc', 'wc.exe',
  'diff', 'diff.exe',
  'cmp', 'cmp.exe',
  'eslint', 'eslint.cmd',
  'node', 'node.exe',
  'bun', 'bun.exe',
  'prettier', 'prettier.cmd',
  'sed', 'sed.exe',
  'awk', 'awk.exe',
  'ls', 'ls.exe',
  'find', 'find.exe',
  'dir', 'dir.exe',
]);

const BUN_SUBCOMMANDS = new Set([
  'test',
  'run',
  'add',
  'remove',
  'rm',
  'install',
  'i',
  'build',
  'create',
  'init',
  'upgrade',
  'update',
  'outdated',
  'link',
  'unlink',
  'pm',
  'patch',
  'x',
  'exec',
  'repl',
  'dev',
  'publish',
  'help',
]);

const BUN_PKG_SUBCOMMANDS = new Set([
  'add',
  'remove',
  'rm',
  'install',
  'i',
  'upgrade',
  'update',
  'outdated',
  'link',
  'unlink',
  'pm',
  'create',
  'init',
  'patch',
  'publish',
  'help',
]);

const CANDIDATE_EXTENSIONS = [
  '.ts',
  '.js',
  '.json',
  '.md',
  '.tsx',
  '.jsx',
  '.py',
  '.sql',
  '.yml',
  '.yaml',
  '.sh',
] as const;

const BARREL_CANDIDATES = [
  'index.ts',
  'index.js',
  'index.tsx',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  'index.json',
] as const;

export const DIRECTORY_SYNONYMS: Record<string, readonly string[]> = {
  handlers: ['tools', 'controllers', 'routes', 'schemas', 'services', 'tool', 'handler'],
  handler: ['tools', 'tool', 'controller', 'route', 'schema', 'service', 'handlers'],
  services: ['tools', 'handlers', 'controllers', 'routes', 'service', 'schemas'],
  service: ['services', 'tools', 'handlers', 'tool', 'handler', 'schema'],
  methods: ['tools', 'handlers', 'controllers', 'routes', 'schemas', 'services', 'method'],
  method: ['methods', 'tools', 'handlers', 'schema', 'service'],
  core: ['tools', 'adapters', 'lib', 'src'],
  operations: ['tools', 'services', 'handlers', 'actions', 'methods', 'schemas'],
  operation: ['tools', 'services', 'handlers', 'actions', 'methods', 'schemas', 'tool', 'handler'],
  actions: ['tools', 'operations', 'handlers', 'services'],
  action: ['tools', 'operation', 'handler', 'service'],
  tools: ['handlers', 'commands', 'plugins', 'tool', 'handler', 'operations', 'actions'],
  tool: ['tools', 'handlers', 'handler', 'commands', 'plugins', 'operation', 'action'],
  controllers: ['routes', 'handlers', 'endpoints', 'controller'],
  controller: ['controllers', 'route', 'handler', 'endpoint', 'routes'],
  routes: ['controllers', 'handlers', 'endpoints', 'route'],
  route: ['routes', 'controller', 'handler', 'endpoint', 'controllers'],
  schemas: ['types', 'models', 'schema'],
  schema: ['schemas', 'types', 'models', 'type', 'model'],
  types: ['schemas', 'interfaces', 'type'],
  type: ['types', 'schemas', 'interfaces', 'schema'],
  models: ['schemas', 'entities', 'model'],
  model: ['models', 'schemas', 'entities', 'schema'],
  tests: ['__tests__', 'test', 'spec', 'specs'],
  test: ['__tests__', 'tests', 'spec', 'specs'],
  __tests__: ['tests', 'test', 'spec'],
  specs: ['tests', 'test', 'spec', '__tests__'],
  spec: ['specs', 'tests', 'test', '__tests__'],
  docs: ['documentation', 'doc'],
  doc: ['docs', 'documentation'],
  lib: ['src', 'utils'],
  src: ['lib', 'dist', 'build'],
  dist: ['src', 'lib', 'build', 'out'],
  build: ['src', 'lib', 'dist', 'out'],
  out: ['src', 'lib', 'dist', 'build'],
  scripts: ['bin', 'tools'],
  bin: ['scripts', 'tools'],
  sqlite: ['sqlite-native'],
  'sqlite-native': ['sqlite'],
};

export const FILE_STEM_SYNONYMS: Record<string, readonly string[]> = {
  utils: ['helpers', 'util', 'helper', 'common', 'shared'],
  util: ['helpers', 'utils', 'helper', 'common', 'shared'],
  helpers: ['utils', 'helper', 'util', 'common', 'shared'],
  helper: ['helpers', 'utils', 'util', 'common', 'shared'],
  schema: ['types', 'schemas', 'type', 'models', 'model'],
  schemas: ['types', 'schema', 'type', 'models', 'model'],
  types: ['schema', 'schemas', 'type', 'interfaces'],
  type: ['types', 'schema', 'schemas', 'interfaces'],
  config: ['constants', 'configuration', 'settings', 'options'],
  constants: ['config', 'configuration', 'settings'],
  index: ['main', 'entry', 'app'],
  main: ['index', 'entry', 'app'],
  'create-table': ['tables', 'table', 'alter-table', 'schema'],
  table: ['tables', 'schema', 'create-table'],
  tables: ['table', 'schema', 'create-table'],
  'geo-spatialite': ['spatialite', 'geo'],
  spatialite: ['geo', 'geo-spatialite'],
  'execute-code': ['codemode', 'code-mode', 'execute'],
  'code-mode': ['codemode', 'execute-code', 'code'],
  codemode: ['code-mode', 'execute-code'],
  execute: ['codemode', 'execute-code'],
};

function preserveQuotes(original: string, updated: string): string {
  if (original.startsWith('"') && original.endsWith('"')) {
    return `"${updated}"`;
  }
  if (original.startsWith("'") && original.endsWith("'")) {
    return `'${updated}'`;
  }
  return updated;
}

export function isRepositoryRoot(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.agents'));
  } catch {
    return false;
  }
}

export function isFileSystemRoot(dir: string): boolean {
  return path.dirname(dir) === dir;
}

export function findNeighborFilePath(resolved: string, allowDirectories = false): string | null {
  const filename = path.basename(resolved);
  if (!filename || filename === '.' || filename === '..') return null;

  const parentDir = path.dirname(resolved);
  const grandparentDir = path.dirname(parentDir);
  const greatGrandparentDir = path.dirname(grandparentDir);

  const parentIsRoot = isFileSystemRoot(parentDir) || isRepositoryRoot(parentDir);
  const grandparentIsRoot = isFileSystemRoot(grandparentDir) || isRepositoryRoot(grandparentDir);

  const getFileCandidates = (dir: string, base: string, allowDirs = false): string[] => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

    const exact = path.join(dir, base);
    if (fs.existsSync(exact) && (allowDirs || !fs.statSync(exact).isDirectory())) {
      return [exact];
    }

    const results: string[] = [];

    // Compound extension / modifier stripping: e.g. admin.handlers.ts -> admin.ts or admin directory
    // Supports dot, hyphen, or underscore separators: admin.handlers.ts, tables-create.ts, native-adapter.ts
    const modifierMatch = base.match(/^(.+?)[._-](?:handlers?|controllers?|services?|routes?|routers?|schemas?|tools?|tests?|specs?|utils?|adapters?|creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?)\.(ts|js|tsx|jsx|mjs|cjs)$/i);
    if (modifierMatch !== null && modifierMatch[1] !== undefined && modifierMatch[2] !== undefined) {
      const stripped = `${modifierMatch[1]}.${modifierMatch[2]}`;
      const strippedPath = path.join(dir, stripped);
      if (fs.existsSync(strippedPath) && !fs.statSync(strippedPath).isDirectory()) {
        results.push(strippedPath);
      }
      // Also check interchangeable TS/JS extensions for the stripped name
      const strippedParsed = path.parse(stripped);
      const altExts = ['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs'];
      for (const ext of altExts) {
        if (ext === `.${modifierMatch[2]}`.toLowerCase()) continue;
        const altStrippedPath = path.join(dir, `${strippedParsed.name}${ext}`);
        if (fs.existsSync(altStrippedPath) && !fs.statSync(altStrippedPath).isDirectory()) {
          results.push(altStrippedPath);
        }
      }
      const barrelDir = path.join(dir, modifierMatch[1]);
      if (fs.existsSync(barrelDir) && fs.statSync(barrelDir).isDirectory()) {
        if (allowDirs) {
          results.push(barrelDir);
        } else {
          for (const barrel of BARREL_CANDIDATES) {
            const barrelFile = path.join(barrelDir, barrel);
            if (fs.existsSync(barrelFile)) {
              results.push(barrelFile);
              break;
            }
          }
        }
      }
    }

    // Prefix modifier / action stripping: e.g. create-table.ts -> table.ts, tables.ts
    const prefixMatch = base.match(/^(?:creates?|drops?|updates?|deletes?|gets?|lists?|reads?|writes?|adds?|removes?|finds?|search)[._-](.+?)\.(ts|js|tsx|jsx|mjs|cjs)$/i);
    if (prefixMatch !== null && prefixMatch[1] !== undefined && prefixMatch[2] !== undefined) {
      const entity = prefixMatch[1];
      const ext = prefixMatch[2];
      for (const variant of [entity, `${entity}s`, entity.replace(/s$/, '')]) {
        const variantPath = path.join(dir, `${variant}.${ext}`);
        if (fs.existsSync(variantPath) && !fs.statSync(variantPath).isDirectory()) {
          results.push(variantPath);
        }
      }
    }

    // Compound split: e.g. geo-spatialite.ts -> spatialite directory or geo directory
    const extMatch = base.match(/\.(ts|js|tsx|jsx|mjs|cjs)$/i);
    if (extMatch !== null && extMatch[1] !== undefined) {
      const stemWithoutExt = base.slice(0, -extMatch[0].length);
      const parts = stemWithoutExt.split(/[-_.]/);
      if (parts.length > 1) {
        for (const part of parts) {
          const partDir = path.join(dir, part);
          if (fs.existsSync(partDir) && fs.statSync(partDir).isDirectory()) {
            if (allowDirs) {
              results.push(partDir);
            } else {
              for (const barrel of BARREL_CANDIDATES) {
                const bPath = path.join(partDir, barrel);
                if (fs.existsSync(bPath) && !fs.statSync(bPath).isDirectory()) {
                  results.push(bPath);
                  break;
                }
              }
            }
          }
          const partFile = path.join(dir, `${part}.${extMatch[1]}`);
          if (fs.existsSync(partFile) && !fs.statSync(partFile).isDirectory()) {
            results.push(partFile);
          }
        }
      }
    }

    if (!path.extname(base)) {
      for (const ext of CANDIDATE_EXTENSIONS) {
        const withExt = exact + ext;
        if (fs.existsSync(withExt) && !fs.statSync(withExt).isDirectory()) {
          results.push(withExt);
        }
      }
    } else {
      // Interchangeable TS/JS extensions (e.g. formatting.js -> formatting.ts, index.ts -> index.js)
      const baseExt = path.extname(base).toLowerCase();
      if (['.js', '.mjs', '.cjs'].includes(baseExt)) {
        const altExts = ['.ts', '.tsx', '.mts', '.cts'];
        for (const ext of altExts) {
          const altPath = path.join(dir, `${path.parse(base).name}${ext}`);
          if (fs.existsSync(altPath) && !fs.statSync(altPath).isDirectory()) {
            results.push(altPath);
          }
        }
      } else if (['.ts', '.mts', '.cts', '.tsx'].includes(baseExt)) {
        const altExts = ['.js', '.mjs', '.cjs'];
        for (const ext of altExts) {
          const altPath = path.join(dir, `${path.parse(base).name}${ext}`);
          if (fs.existsSync(altPath) && !fs.statSync(altPath).isDirectory()) {
            results.push(altPath);
          }
        }
      }
    }

    // Normalized matching (ignoring hyphens and underscores, e.g. code-mode -> codemode.ts)
    if (results.length === 0) {
      const normBase = base.toLowerCase().replace(/[-_]/g, '');
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const entryNorm = entry.name.toLowerCase().replace(/[-_]/g, '');
          const entryParsed = path.parse(entry.name).name.toLowerCase().replace(/[-_]/g, '');
          if (entryNorm === normBase || entryParsed === normBase) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (allowDirs) results.push(entryPath);
            } else {
              const entryExt = path.extname(entry.name).toLowerCase();
              const baseExt = path.extname(base).toLowerCase();
              if (baseExt.length > 0) {
                const isTsJsInterchangeable =
                  (['.js', '.mjs', '.cjs'].includes(baseExt) && ['.ts', '.tsx', '.mts', '.cts'].includes(entryExt)) ||
                  (['.ts', '.tsx', '.mts', '.cts'].includes(baseExt) && ['.js', '.mjs', '.cjs'].includes(entryExt));
                if (entryExt === baseExt || isTsJsInterchangeable) results.push(entryPath);
              } else if (CANDIDATE_EXTENSIONS.includes(entryExt as (typeof CANDIDATE_EXTENSIONS)[number])) {
                results.push(entryPath);
              }
            }
          }
        }
      } catch { /* ignore */ }
    }

    // Directory synonym matching (e.g. handlers -> tools, controllers -> routes, schemas -> types)
    if (allowDirs && results.length === 0) {
      const lowerBase = base.toLowerCase();
      const synonyms = DIRECTORY_SYNONYMS[lowerBase] ?? [];
      for (const syn of synonyms) {
        const synPath = path.join(dir, syn);
        if (fs.existsSync(synPath) && fs.statSync(synPath).isDirectory()) {
          results.push(synPath);
        }
      }
    }

    // File stem synonym matching (e.g. utils.ts -> helpers.ts, schema.ts -> types.ts, config.ts -> constants.ts)
    if (results.length === 0) {
      const parsedBase = path.parse(base);
      const stem = parsedBase.name.toLowerCase();
      const ext = parsedBase.ext.toLowerCase();
      const stemSynonyms = FILE_STEM_SYNONYMS[stem] ?? [];
      for (const syn of stemSynonyms) {
        const synName = ext ? `${syn}${ext}` : syn;
        const synPath = path.join(dir, synName);
        if (fs.existsSync(synPath) && !fs.statSync(synPath).isDirectory()) {
          results.push(synPath);
        } else if (!ext) {
          for (const candExt of CANDIDATE_EXTENSIONS) {
            const synExtPath = path.join(dir, `${syn}${candExt}`);
            if (fs.existsSync(synExtPath) && !fs.statSync(synExtPath).isDirectory()) {
              results.push(synExtPath);
              break;
            }
          }
        }
      }
    }

    // Modular directory check: base has an extension (e.g. schema.ts) but a directory named schema exists
    if (results.length === 0) {
      const parsed = path.parse(base);
      if (parsed.ext) {
        const dirCandidate = path.join(dir, parsed.name);
        if (fs.existsSync(dirCandidate) && fs.statSync(dirCandidate).isDirectory()) {
          if (allowDirs) {
            results.push(dirCandidate);
          } else {
            for (const barrel of BARREL_CANDIDATES) {
              const bPath = path.join(dirCandidate, barrel);
              if (fs.existsSync(bPath) && !fs.statSync(bPath).isDirectory()) {
                results.push(bPath);
                break;
              }
            }
          }
        }
      }
    }

    return Array.from(new Set(results));
  };

  // 0. If parentDir exists, check parentDir directly:
  // e.g., agent requested handlers -> parentDir contains directory synonym 'tools' (when allowDirectories is true)
  // or hyphen/underscore mismatch e.g. code-mode -> codemode
  if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
    const directCandidates = getFileCandidates(parentDir, filename, allowDirectories);
    if (directCandidates.length === 1 && directCandidates[0] !== undefined) {
      return directCandidates[0];
    }
  }

  // 1. Check parent directory of parentDir (grandparent):
  // e.g., agent requested tools/text/fts.ts -> tools/fts.ts exists
  if (!parentIsRoot && fs.existsSync(grandparentDir) && fs.statSync(grandparentDir).isDirectory()) {
    const candidates = getFileCandidates(grandparentDir, filename, allowDirectories);
    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  // 2. If parentDir exists, check direct subdirectories of parentDir:
  // e.g., agent requested tools/fts-rebuild.ts -> tools/text/fts-rebuild.ts exists
  if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
    try {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      const matches: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          const subDir = path.join(parentDir, entry.name);
          const candidates = getFileCandidates(subDir, filename, allowDirectories);
          matches.push(...candidates);
        }
      }
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        const fileBase = path.parse(filename).name.toLowerCase();
        let preferred = matches.filter(m => {
          const dirName = path.basename(path.dirname(m)).toLowerCase();
          return dirName === fileBase || dirName === `${fileBase}s` || dirName.startsWith(fileBase) || fileBase.startsWith(dirName);
        });
        if (preferred.length === 0) {
          preferred = matches.filter(m => {
            const dirName = path.basename(path.dirname(m)).toLowerCase();
            return ['tools', 'src', 'handlers', 'lib'].includes(dirName);
          });
        }
        if (preferred.length === 1 && preferred[0] !== undefined) {
          return preferred[0];
        }
      }
    } catch { /* ignore */ }
  }

  // 3. If parentDir does NOT exist, check submodule-to-file fallback or sibling directories in grandparentDir:
  // e.g., agent requested tools/codemode/execute.ts -> tools/codemode.ts exists
  // e.g., agent requested adapters/sqlite/handlers/schema.ts -> adapters/sqlite/schemas/schema.ts exists
  if (!parentIsRoot && !fs.existsSync(parentDir) && fs.existsSync(grandparentDir) && fs.statSync(grandparentDir).isDirectory()) {
    // 3a. Submodule-to-file fallback (agent hallucinated sub-directory for a single-file module)
    const parentBase = path.basename(parentDir);
    const ext = path.extname(filename);
    const targetFile = ext ? `${parentBase}${ext}` : parentBase;
    const parentFileCandidates = getFileCandidates(grandparentDir, targetFile, false);
    if (parentFileCandidates.length === 1 && parentFileCandidates[0] !== undefined) {
      return parentFileCandidates[0];
    }
    if (!ext) {
      for (const trialExt of ['.ts', '.js', '.mjs', '.tsx', '.jsx', '.json']) {
        const trialCandidates = getFileCandidates(grandparentDir, `${parentBase}${trialExt}`, false);
        if (trialCandidates.length === 1 && trialCandidates[0] !== undefined) {
          return trialCandidates[0];
        }
      }
    }

    try {
      const entries = fs.readdirSync(grandparentDir, { withFileTypes: true });
      const matches: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          const siblingDir = path.join(grandparentDir, entry.name);
          const candidates = getFileCandidates(siblingDir, filename, allowDirectories);
          matches.push(...candidates);
        }
      }
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1) {
        const fileBase = path.parse(filename).name.toLowerCase();
        let preferred = matches.filter(m => {
          const dirName = path.basename(path.dirname(m)).toLowerCase();
          return dirName === fileBase || dirName === `${fileBase}s` || dirName.startsWith(fileBase) || fileBase.startsWith(dirName);
        });
        if (preferred.length === 0) {
          preferred = matches.filter(m => {
            const dirName = path.basename(path.dirname(m)).toLowerCase();
            return ['tools', 'src', 'handlers', 'lib'].includes(dirName);
          });
        }
        if (preferred.length === 1 && preferred[0] !== undefined) {
          return preferred[0];
        }
      }
    } catch { /* ignore */ }
  }

  // 4. Check sibling trees in great-grandparent directory:
  // e.g., agent requested src/adapters/sqlite-native/tools/fts.ts -> src/adapters/sqlite/tools/fts.ts exists
  if (!parentIsRoot && !grandparentIsRoot && fs.existsSync(greatGrandparentDir) && fs.statSync(greatGrandparentDir).isDirectory()) {
    try {
      const relFromGrandparent = path.relative(grandparentDir, resolved);
      const entries = fs.readdirSync(greatGrandparentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          const siblingModuleDir = path.join(greatGrandparentDir, entry.name);
          if (siblingModuleDir.toLowerCase() === grandparentDir.toLowerCase()) continue;

          // 4a. Exact relative subtree check
          const exactSubtree = path.join(siblingModuleDir, relFromGrandparent);
          if (fs.existsSync(exactSubtree) && (allowDirectories || !fs.statSync(exactSubtree).isDirectory())) {
            return exactSubtree;
          }

          // 4b. Subfolder with same parent name
          const subDir = path.join(siblingModuleDir, path.basename(parentDir));
          if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
            const subCandidates = getFileCandidates(subDir, filename, allowDirectories);
            if (subCandidates.length === 1 && subCandidates[0] !== undefined) {
              return subCandidates[0];
            }
            try {
              const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
              for (const subEntry of subEntries) {
                if (subEntry.isDirectory() && !subEntry.name.startsWith('.') && subEntry.name !== 'node_modules' && subEntry.name !== 'dist') {
                  const nestedDir = path.join(subDir, subEntry.name);
                  const nestedCandidates = getFileCandidates(nestedDir, filename, allowDirectories);
                  if (nestedCandidates.length === 1 && nestedCandidates[0] !== undefined) {
                    return nestedCandidates[0];
                  }
                }
              }
            } catch { /* ignore */ }
          }

          // 4c. Direct file candidates in sibling module
          const directCandidates = getFileCandidates(siblingModuleDir, filename, allowDirectories);
          if (directCandidates.length === 1) {
            return directCandidates[0];
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 5. Shallow recursive scan (depth <= 2) for matching files/directories in parentDir or grandparentDir
  const searchRoots = [parentDir, (!parentIsRoot ? grandparentDir : null)]
    .filter((d): d is string => d !== null && fs.existsSync(d) && fs.statSync(d).isDirectory());
  for (const root of searchRoots) {
    try {
      const matches: string[] = [];
      const normTarget = filename.toLowerCase().replace(/[-_]/g, '');
      const scan = (dir: string, depth: number) => {
        if (depth > 2) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'skills') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const entryNorm = entry.name.toLowerCase().replace(/[-_]/g, '');
            if (allowDirectories && (entry.name.toLowerCase() === filename.toLowerCase() || entryNorm === normTarget)) {
              matches.push(fullPath);
            }
            scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const baseNoExt = path.parse(entry.name).name.toLowerCase().replace(/[-_]/g, '');
            const targetNoExt = path.parse(filename).name.toLowerCase().replace(/[-_]/g, '');
            const targetExt = path.extname(filename);
            const matchesStem = targetExt.length > 0 && baseNoExt === targetNoExt;
            const matchesExt = targetExt.length === 0 && CANDIDATE_EXTENSIONS.some(ext => entry.name.toLowerCase() === `${filename.toLowerCase()}${ext}`);
            if (entry.name.toLowerCase() === filename.toLowerCase() || matchesStem || matchesExt) {
              matches.push(fullPath);
            }
          }
        }
      };
      scan(root, 0);
      if (matches.length === 1) {
        return matches[0];
      }
    } catch { /* ignore */ }
  }

  return null;
}

export function resolvePathWithDirectorySynonyms(resolvedPath: string, allowDirectories = false): string | null {
  if (fs.existsSync(resolvedPath)) {
    if (allowDirectories || !fs.statSync(resolvedPath).isDirectory()) {
      return resolvedPath;
    }
  }

  const parsed = path.parse(resolvedPath);
  const root = parsed.root;
  const relativeFromRoot = resolvedPath.slice(root.length);
  const segments = relativeFromRoot.split(/[\\/]/).filter(Boolean);

  let current = root;
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg === undefined) break;
    const nextPath = path.join(current, seg);
    if (fs.existsSync(nextPath)) {
      current = nextPath;
    } else {
      const synonyms = DIRECTORY_SYNONYMS[seg.toLowerCase()] ?? [];
      const remainingSegments = segments.slice(idx + 1);
      // Pass 1: exact path existence across all directory synonyms first
      for (const syn of synonyms) {
        const candidateBase = path.join(current, syn);
        if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isDirectory()) {
          if (remainingSegments.length === 0) {
            if (allowDirectories) return candidateBase;
          } else {
            const candidateFull = path.join(candidateBase, ...remainingSegments);
            if (fs.existsSync(candidateFull) && (allowDirectories || !fs.statSync(candidateFull).isDirectory())) {
              return candidateFull;
            }
          }
        }
      }
      // Pass 2: nested synonym resolution or neighbor/barrel fallback
      for (const syn of synonyms) {
        const candidateBase = path.join(current, syn);
        if (fs.existsSync(candidateBase) && fs.statSync(candidateBase).isDirectory() && remainingSegments.length > 0) {
          const candidateFull = path.join(candidateBase, ...remainingSegments);
          const nested = resolvePathWithDirectorySynonyms(candidateFull, allowDirectories);
          if (nested !== null) return nested;
          const neighbor = findNeighborFilePath(candidateFull, allowDirectories);
          if (neighbor !== null) return neighbor;
        }
      }
      break;
    }
  }

  return null;
}

export function formatHealedPath(originalArg: string, candidatePath: string, cwd: string, isWslPath: boolean): string {
  const rawPath = originalArg.replace(/^['"]|['"]$/g, '');
  let formatted: string;
  if (isWslPath) {
    formatted = convertToWslPath(candidatePath);
  } else if (path.isAbsolute(rawPath)) {
    formatted = candidatePath;
    if (rawPath.includes('/') && !rawPath.includes('\\')) {
      formatted = formatted.replace(/\\/g, '/');
    }
  } else {
    // Relative path
    formatted = path.relative(cwd, candidatePath);
    if (rawPath.includes('/') || !rawPath.includes('\\')) {
      formatted = formatted.replace(/\\/g, '/');
    }
  }
  return preserveQuotes(originalArg, formatted);
}

export const BUILD_TO_SRC_SWAPS: Record<string, readonly string[]> = {
  dist: ['src', 'lib', 'build', 'out'],
  build: ['src', 'lib', 'dist', 'out'],
  out: ['src', 'lib', 'dist', 'build'],
  src: ['dist', 'build', 'out', 'lib'],
};

export function resolveBuildSrcSwap(resolvedPath: string, allowDirectories = false): string | null {
  for (const [from, toList] of Object.entries(BUILD_TO_SRC_SWAPS)) {
    const regex = new RegExp(`([\\\\/])${from}([\\\\/])`, 'i');
    const matchResult = resolvedPath.match(regex);
    if (matchResult !== null && matchResult[1] !== undefined && matchResult[2] !== undefined) {
      const sep1 = matchResult[1];
      const sep2 = matchResult[2];
      for (const to of toList) {
        const swapped = resolvedPath.replace(regex, `${sep1}${to}${sep2}`);
        if (fs.existsSync(swapped) && (allowDirectories || !fs.statSync(swapped).isDirectory())) {
          return swapped;
        }
        const neighbor = findNeighborFilePath(swapped, allowDirectories);
        if (neighbor !== null) {
          return neighbor;
        }
      }
    }
  }
  return null;
}

export function healModulePath(
  rawPath: string,
  cwd: string,
  isEsm: boolean = false,
  target?: 'windows' | 'wsl2'
): string {
  const isWsl = target === 'wsl2' || rawPath.startsWith('/mnt/');
  const wslNormalized = rawPath.startsWith('/mnt/')
    ? rawPath.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_: string, drive: string, rest: string) => `${drive.toUpperCase()}:/${rest}`)
    : rawPath;
  const windowsCwd = cwd.startsWith('/mnt/')
    ? cwd.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_: string, drive: string, rest: string) => `${drive.toUpperCase()}:/${rest}`)
    : cwd;

  const resolvedPath = path.isAbsolute(wslNormalized)
    ? path.normalize(wslNormalized)
    : path.resolve(windowsCwd, wslNormalized);

  let targetPath = resolvedPath;

  if (!fs.existsSync(targetPath)) {
    // 1. If path ends in .js / .mjs / .cjs, but .ts / .tsx exists on disk (common in TS ESM)
    const asTs = targetPath.replace(/\.([mc]?)js$/i, '.$1ts');
    const asTsx = targetPath.replace(/\.([mc]?)js$/i, '.$1tsx');
    if (fs.existsSync(asTs) && !fs.statSync(asTs).isDirectory()) {
      targetPath = asTs;
    } else if (fs.existsSync(asTsx) && !fs.statSync(asTsx).isDirectory()) {
      targetPath = asTsx;
    } else if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      // 2. Barrel directory candidate
      for (const barrel of BARREL_CANDIDATES) {
        const barrelPath = path.join(targetPath, barrel);
        if (fs.existsSync(barrelPath) && !fs.statSync(barrelPath).isDirectory()) {
          targetPath = barrelPath;
          break;
        }
      }
    } else {
      // 3. Missing extension candidate
      let foundExt = false;
      for (const ext of CANDIDATE_EXTENSIONS) {
        const candidate = targetPath + ext;
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          targetPath = candidate;
          foundExt = true;
          break;
        }
      }
      // 4. Neighbor file search
      if (!foundExt) {
        const neighbor = resolveBuildSrcSwap(targetPath, false) ?? findNeighborFilePath(targetPath);
        if (neighbor !== null) {
          targetPath = neighbor;
        }
      }
    }
  }

  if (isWsl) {
    const wslPath = convertToWslPath(targetPath);
    return isEsm ? `file://${wslPath}` : wslPath;
  }

  if (isEsm) {
    return pathToFileURL(targetPath).href;
  }

  return targetPath.replace(/\\/g, '/');
}

export function healModuleImports(
  code: string,
  cwd: string,
  target?: 'windows' | 'wsl2'
): string {
  let updatedCode = code;

  // 1. require('./...') or require("../...")
  const requireRegex = /\brequire\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g;
  updatedCode = updatedCode.replace(requireRegex, (fullMatch, quote, relPath) => {
    const healed = healModulePath(relPath, cwd, false, target);
    if (healed !== relPath) {
      console.error(`\n   💡 AGENT HINT: Relative require '${relPath}' in script/eval resolved against cwd to '${healed}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting relative require path to absolute... (Frictionless Recovery)\x1b[0m`);
      return `require(${quote}${healed}${quote})`;
    }
    return fullMatch;
  });

  // 2. Dynamic import('./...') or import("../...")
  const dynamicImportRegex = /\bimport\s*\(\s*(['"])(\.[^'"]+)\1((?:\s*,[^)]*)?)\)/g;
  updatedCode = updatedCode.replace(dynamicImportRegex, (fullMatch, quote, relPath, extraArgs) => {
    const healed = healModulePath(relPath, cwd, true, target);
    if (healed !== relPath) {
      console.error(`\n   💡 AGENT HINT: Relative dynamic import '${relPath}' in script/eval resolved against cwd to '${healed}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting relative import path to file URL... (Frictionless Recovery)\x1b[0m`);
      return `import(${quote}${healed}${quote}${extraArgs ?? ''})`;
    }
    return fullMatch;
  });

  // 3. Static import ... from './...' or export ... from './...' or import './...'
  const staticImportRegex = /\b(import|export)\s+((?:[\w\s{},*]+from\s+)?)(['"])(\.[^'"]+)\3/g;
  updatedCode = updatedCode.replace(staticImportRegex, (fullMatch, keyword, fromPart, quote, relPath) => {
    const healed = healModulePath(relPath, cwd, true, target);
    if (healed !== relPath) {
      console.error(`\n   💡 AGENT HINT: Relative import/export '${relPath}' in script/eval resolved against cwd to '${healed}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting relative import path to file URL... (Frictionless Recovery)\x1b[0m`);
      return `${keyword} ${fromPart}${quote}${healed}${quote}`;
    }
    return fullMatch;
  });

  return updatedCode;
}

export function healEvalCodePathHallucinations(
  code: string,
  cwd: string,
  target?: 'windows' | 'wsl2'
): string {
  let updatedCode = code;

  // 1. .gemini/mcp_config.json path hallucination
  if (updatedCode.includes('.gemini/mcp_config.json') || updatedCode.includes('.gemini\\mcp_config.json')) {
    if (!updatedCode.includes('antigravity-ide') && !updatedCode.includes('.gemini/config')) {
      console.error(`\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path in eval code to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`);
      updatedCode = updatedCode.replace(/\.gemini[\\/]mcp_config\.json/g, '.gemini/antigravity-ide/mcp_config.json');
    }
  }

  // 2. Heal relative module imports and requires
  updatedCode = healModuleImports(updatedCode, cwd, target);

  // Helper to heal a single path in eval code
  const healSinglePath = (
    filePath: string,
    allowDirs: boolean
  ): string | null => {
    if (filePath.startsWith('-') || filePath.startsWith('$')) return null;

    const rawFilePath = filePath.replace(/^['"]|['"]$/g, '');
    if (rawFilePath.includes('*') || rawFilePath.includes('?')) return null;
    if (/^\/(?:proc|sys|dev|etc|tmp|var|usr|bin|sbin|root|home)(?:[/\\]|$)/.test(rawFilePath)) return null;

    const isWslPath = target === 'wsl2' || rawFilePath.startsWith('/mnt/');
    const isWindowsDrivePath = /^[a-zA-Z]:[/\\]/.test(rawFilePath);
    const wslNormalized = isWslPath
      ? rawFilePath.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_: string, drive: string, rest: string) => `${drive.toUpperCase()}:/${rest}`)
      : rawFilePath;
    const resolvedPath = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);

    if (fs.existsSync(resolvedPath)) {
      if (target === 'wsl2' && (isWindowsDrivePath || rawFilePath.includes('\\'))) {
        return convertToWslPath(resolvedPath);
      }
      return null;
    }

    // Modular directory / barrel entrypoint check (if path without extension is a directory)
    const extMatch = rawFilePath.match(/\.(?:ts|js|tsx|jsx|mjs|cjs)$/i);
    if (extMatch !== null) {
      const withoutExt = rawFilePath.slice(0, -extMatch[0].length);
      const normalizedWithoutExt = isWslPath
        ? withoutExt.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_: string, drive: string, rest: string) => `${drive.toUpperCase()}:/${rest}`)
        : withoutExt;
      const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(cwd, normalizedWithoutExt);
      if (fs.existsSync(resolvedWithoutExt) && fs.statSync(resolvedWithoutExt).isDirectory()) {
        if (allowDirs) {
          return target === 'wsl2' && (isWindowsDrivePath || withoutExt.includes('\\')) ? convertToWslPath(resolvedWithoutExt) : withoutExt;
        }
        for (const barrel of BARREL_CANDIDATES) {
          const bCandidate = path.join(resolvedWithoutExt, barrel);
          if (fs.existsSync(bCandidate)) {
            const sep = withoutExt.includes('\\') ? '\\' : '/';
            const bPath = `${withoutExt}${sep}${barrel}`;
            return target === 'wsl2' && (isWindowsDrivePath || withoutExt.includes('\\')) ? convertToWslPath(bCandidate) : bPath;
          }
        }
      }
    }

    // Missing candidate extensions
    const cleanRawFilePath = rawFilePath.replace(/[\\/]+$/, '');
    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = resolvedPath + ext;
      if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
        const withExt = `${cleanRawFilePath}${ext}`;
        return target === 'wsl2' && (isWindowsDrivePath || cleanRawFilePath.includes('\\')) ? convertToWslPath(candidate) : withExt;
      }
    }

    // Interchangeable TS/JS extensions (e.g. admin.js -> admin.ts)
    const baseExt = path.extname(rawFilePath).toLowerCase();
    if (['.js', '.mjs', '.cjs'].includes(baseExt)) {
      for (const altExt of ['.ts', '.tsx', '.mts', '.cts']) {
        const candidate = resolvedPath.slice(0, -baseExt.length) + altExt;
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          const withExt = cleanRawFilePath.slice(0, -baseExt.length) + altExt;
          return target === 'wsl2' && (isWindowsDrivePath || cleanRawFilePath.includes('\\')) ? convertToWslPath(candidate) : withExt;
        }
      }
    } else if (['.ts', '.mts', '.cts', '.tsx'].includes(baseExt)) {
      for (const altExt of ['.js', '.mjs', '.cjs']) {
        const candidate = resolvedPath.slice(0, -baseExt.length) + altExt;
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
          const withExt = cleanRawFilePath.slice(0, -baseExt.length) + altExt;
          return target === 'wsl2' && (isWindowsDrivePath || cleanRawFilePath.includes('\\')) ? convertToWslPath(candidate) : withExt;
        }
      }
    }

    // Neighbor directory & directory synonym search
    if (cleanRawFilePath.includes('/') || cleanRawFilePath.includes('\\')) {
      const neighborFile = resolvePathWithDirectorySynonyms(resolvedPath, allowDirs) ?? resolveBuildSrcSwap(resolvedPath, allowDirs) ?? findNeighborFilePath(resolvedPath, allowDirs);
      if (neighborFile !== null) {
        return formatHealedPath(rawFilePath, neighborFile, cwd, rawFilePath.startsWith('/mnt/') || (target === 'wsl2' && isWindowsDrivePath));
      }
    }

    if (target === 'wsl2' && (isWindowsDrivePath || rawFilePath.includes('\\'))) {
      return convertToWslPath(resolvedPath);
    }

    return null;
  };

  // 3a. Heal file inspection, listing, and file management commands in eval code (cat, head, tail, wc, ls, dir, rm, cp, mv, touch, mkdir, chmod, diff)
  const fileInspectionRegex = /(?:^|(?<=[;&|\n]))\s*(cat|head|tail|wc|ls|dir|rm|cp|mv|touch|mkdir|chmod|diff)\b([^;&|\n]*)/gi;
  updatedCode = updatedCode.replace(fileInspectionRegex, (fullMatch, cmdWord, restArgs) => {
    const isDirTool = ['ls', 'dir', 'rm', 'cp', 'mv', 'mkdir', 'chmod'].includes(cmdWord.toLowerCase());
    const tokenRegex = /([^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`|\s+)/g;
    const tokens = restArgs.match(tokenRegex) ?? [];
    let modified = false;

    const healedTokens = tokens.map((token: string) => {
      const trimmed = token.trim();
      if (!trimmed || trimmed.startsWith('-')) return token;
      const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '').replace(/[\\/]+$/, '');
      if (isDirTool && !cleanPath.includes('/') && !cleanPath.includes('\\') && !cleanPath.includes('.')) {
        return token;
      }
      const healed = healSinglePath(trimmed, isDirTool);
      if (healed !== null && healed !== trimmed) {
        const isBarrel = /(?:^|[/\\])index\.[jt]sx?$/i.test(healed) && !/(?:^|[/\\])index\.[jt]sx?$/i.test(trimmed);
        console.error(
          isBarrel
            ? `\n   💡 AGENT HINT: Path '${trimmed}' in eval code not found on disk, but barrel '${healed}' exists.`
            : `\n   💡 AGENT HINT: Path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`
        );
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting eval command to '${cmdWord} ... ${healed}'... (Frictionless Recovery)\x1b[0m`);
        modified = true;
        const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
        return `${quote}${healed}${quote}`;
      }
      return token;
    });

    if (modified) {
      return `${cmdWord}${healedTokens.join('')}`;
    }
    return fullMatch;
  });

  // 3b. Heal search tools with pattern and target path in eval code (rg, grep, egrep, fgrep)
  const searchMatchRegex = /\b(grep|egrep|fgrep|rg)\s+((?:-[^\s"'`;&|]+\s+)*)(?:(-e\s+(?:"[^"]*"|'[^']*'|[^\s]+)\s+)|(?:("[^"]*"|'[^']*'|[^\s]+)\s+))([^\s"'`;&|]+)/g;
  updatedCode = updatedCode.replace(searchMatchRegex, (fullMatch, cmdWord, flagsPart, optE, optPattern, targetPath) => {
    const patternPart = (optE ?? optPattern ?? '').trim();
    const cleanTargetPath = targetPath.replace(/[\\/]+$/, '');
    if (!path.extname(cleanTargetPath) && !cleanTargetPath.includes('/') && !cleanTargetPath.includes('\\')) {
      return fullMatch;
    }
    const healed = healSinglePath(targetPath, true);
    if (healed !== null) {
      console.error(`\n   💡 AGENT HINT: Search path '${targetPath}' in eval code not found on disk, but found at '${healed}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting search path in eval command to '${healed}'... (Frictionless Recovery)\x1b[0m`);
      return `${cmdWord} ${flagsPart}${patternPart} ${healed}`;
    }
    return fullMatch;
  });

  // 3c. Heal PowerShell cmdlets in eval code (Get-Content, gc, type, Get-ChildItem, gci)
  const psCmdletRegex = /\b(Get-Content|gc|type|Get-ChildItem|gci)\s+((?:-[^\s"'`;&|]+\s+)*)([^\s"'`;&|]+)/gi;
  updatedCode = updatedCode.replace(psCmdletRegex, (fullMatch, cmdlet, flagsPart, filePath) => {
    const allowDirs = /Get-ChildItem|gci/i.test(cmdlet);
    const healed = healSinglePath(filePath, allowDirs);
    if (healed !== null) {
      console.error(`\n   💡 AGENT HINT: Path '${filePath}' in eval code not found on disk, but found at '${healed}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting eval command to '${cmdlet} ${flagsPart}${healed}'... (Frictionless Recovery)\x1b[0m`);
      return `${cmdlet} ${flagsPart}${healed}`;
    }
    return fullMatch;
  });

  // 3d. Heal runner commands in eval code (bun, node, tsx, ts-node, python, python3)
  const runnerRegex = /(?:^|(?<=[;&|\n]))\s*(bun|node|tsx|ts-node|python|python3)\b([^;&|\n]*)/gi;
  updatedCode = updatedCode.replace(runnerRegex, (fullMatch, runnerCmd, restArgs) => {
    const tokenRegex = /([^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`|\s+)/g;
    const tokens = restArgs.match(tokenRegex) ?? [];
    let modified = false;

    const healedTokens = tokens.map((token: string) => {
      const trimmed = token.trim();
      if (!trimmed || trimmed.startsWith('-')) return token;
      const cleanPath = trimmed.replace(/^['"`]|['"`]$/g, '');
      const isSubcommand = ['run', 'test', 'exec', 'x', 'dev', 'start', 'build'].includes(cleanPath.toLowerCase());
      if (isSubcommand) return token;

      const isPathLike = cleanPath.includes('/') || cleanPath.includes('\\') || /\.(?:ts|js|mjs|cjs|py|json)$/i.test(cleanPath);
      if (!isPathLike) return token;

      const healed = healSinglePath(trimmed, false);
      if (healed !== null && healed !== trimmed) {
        console.error(`\n   💡 AGENT HINT: Script path '${trimmed}' in eval code not found on disk, but found at '${healed}'.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting eval command to '${runnerCmd} ... ${healed}'... (Frictionless Recovery)\x1b[0m`);
        modified = true;
        const quote = token.startsWith('"') ? '"' : (token.startsWith("'") ? "'" : '');
        return `${quote}${healed}${quote}`;
      }
      return token;
    });

    if (modified) {
      return `${runnerCmd}${healedTokens.join('')}`;
    }
    return fullMatch;
  });

  // 3d. Heal -Path parameter in PowerShell eval code (e.g. Get-ChildItem -Path C:/.../handlers)
  if (target !== 'wsl2' && !/(?:^|(?<=[;&|\n]))\s*find\b/i.test(updatedCode)) {
    const pathFlagRegex = /(-Path\s+)(?:"([^"]+)"|'([^']+)'|([^\s"'`;|]+))/gi;
    updatedCode = updatedCode.replace(pathFlagRegex, (fullMatch, flagPrefix, qDouble, qSingle, unquoted) => {
      const rawPath = qDouble ?? qSingle ?? unquoted ?? '';
      if (!rawPath || rawPath.includes('*') || rawPath.includes('?') || /^\/(?:proc|sys|dev|etc|tmp|var|usr|bin|sbin|root|home)(?:[/\\]|$)/.test(rawPath)) {
        return fullMatch;
      }
      const healed = healSinglePath(rawPath, true);
      if (healed !== null) {
        console.error(`\n   💡 AGENT HINT: -Path '${rawPath}' in eval code not found on disk, but found at '${healed}'.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting -Path in eval command to '${healed}'... (Frictionless Recovery)\x1b[0m`);
        const quote = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
        return `${flagPrefix}${quote}${healed}${quote}`;
      }
      return fullMatch;
    });
  }

  return updatedCode;
}

export function healPathHallucinations(ctx: ExecutionContext): void {
  const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
    ? path.resolve(ctx.payload.cwd)
    : process.cwd();

  if (ctx.payload.type === 'eval' && typeof ctx.payload.code === 'string') {
    ctx.payload.code = healEvalCodePathHallucinations(ctx.payload.code, cwd, ctx.payload.target);
  }

  const { args } = ctx;

  // 1. memory-journal-mcp backups path hallucination
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== undefined && (arg.includes('memory-journal-mcp\\backups') || arg.includes('memory-journal-mcp/backups'))) {
      console.error(`\n   💡 AGENT HINT: 'backups' directory is located at 'data/backups', not the repository root.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to data/backups.\x1b[0m`);
      args[i] = arg.replace(/memory-journal-mcp[\\/]backups/g, 'memory-journal-mcp\\data\\backups');
    }
  }

  // 2. .gemini/mcp_config.json path hallucination
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== undefined && (arg.includes('.gemini\\mcp_config.json') || arg.includes('.gemini/mcp_config.json')) && !arg.includes('antigravity-ide')) {
      console.error(`\n   💡 AGENT HINT: 'mcp_config.json' is located in '.gemini/antigravity-ide/mcp_config.json', not directly under '.gemini'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to .gemini/antigravity-ide/mcp_config.json... (Frictionless Recovery)\x1b[0m`);
      args[i] = arg.replace(/\.gemini[\\/]mcp_config\.json/g, '.gemini/antigravity-ide/mcp_config.json');
    }
  }

  // 3. Missing file extension healing for file inspection and search tools
  const base = ctx.cmdBasename.toLowerCase();
  if (!FILE_TOOLS.has(base)) {
    return;
  }

  const patternIdx = findPatternExprIndex(ctx.cmdBasename, args);
  const skipIndices = new Set<number>();
  if (patternIdx !== -1) {
    skipIndices.add(patternIdx);
  }

  if (base === 'bun' || base === 'bun.exe') {
    const firstPositionalIdx = args.findIndex(a => !a.startsWith('-'));
    if (firstPositionalIdx !== -1) {
      const firstPositional = args[firstPositionalIdx];
      const subcommand = firstPositional.toLowerCase();
      if (BUN_PKG_SUBCOMMANDS.has(subcommand)) {
        return;
      }
      if (BUN_SUBCOMMANDS.has(subcommand)) {
        skipIndices.add(firstPositionalIdx);
        if (subcommand === 'run') {
          const scriptIdx = args.findIndex((a, idx) => idx > firstPositionalIdx && !a.startsWith('-'));
          if (scriptIdx !== -1) {
            const scriptArg = args[scriptIdx];
            const RUNNERS = new Set(['tsx', 'ts-node', 'node', 'bun', 'deno', 'nodemon']);
            if (RUNNERS.has(scriptArg.toLowerCase())) {
              skipIndices.add(scriptIdx);
              // The next positional after runner is the script to run (e.g. tsx src/cli.ts)
              const runnerTargetIdx = args.findIndex((a, idx) => idx > scriptIdx && !a.startsWith('-'));
              if (runnerTargetIdx !== -1) {
                // All arguments after the runner's target script are script parameters (e.g. 'start')
                for (let s = runnerTargetIdx + 1; s < args.length; s++) {
                  skipIndices.add(s);
                }
              }
            } else if (!scriptArg.includes('/') && !scriptArg.includes('\\') && !path.extname(scriptArg)) {
              // It's a package.json script (e.g. bun run build, bun run start, bun run test:unit)
              skipIndices.add(scriptIdx);
              for (let s = scriptIdx + 1; s < args.length; s++) {
                skipIndices.add(s);
              }
            } else {
              // Direct script file (e.g. bun run ./scripts/dev.ts arg1)
              for (let s = scriptIdx + 1; s < args.length; s++) {
                skipIndices.add(s);
              }
            }
          }
        }
      } else {
        const ext = path.extname(firstPositional).toLowerCase();
        if (['.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx'].includes(ext) || firstPositional.includes('/') || firstPositional.includes('\\')) {
          for (let s = firstPositionalIdx + 1; s < args.length; s++) {
            skipIndices.add(s);
          }
        }
      }
    }
  }

  if (base === 'node' || base === 'node.exe') {
    const scriptIdx = args.findIndex(a => !a.startsWith('-'));
    if (scriptIdx !== -1) {
      for (let s = scriptIdx + 1; s < args.length; s++) {
        skipIndices.add(s);
      }
    }
  }

  for (let i = 0; i < args.length; i++) {
    if (skipIndices.has(i)) continue;
    const arg = args[i];
    const isWslPath = arg.startsWith('/mnt/');
    const trimmedArg = arg.trim();
    if (
      arg === undefined ||
      arg.length === 0 ||
      arg.startsWith('-') ||
      (arg.startsWith('/') && !isWslPath) ||
      arg.includes('*') ||
      arg.includes('?') ||
      arg.includes('://') ||
      trimmedArg.startsWith('{') ||
      trimmedArg.startsWith('base64:') ||
      trimmedArg.includes('\n') ||
      ((trimmedArg.startsWith('"') || trimmedArg.startsWith("'")) && trimmedArg.includes('{') && trimmedArg.includes('}')) ||
      /"(?:type|command|args|interpreter|code)"\s*:/.test(trimmedArg)
    ) {
      continue;
    }

    const rawPath = arg.replace(/^['"]|['"]$/g, '');
    const wslNormalized = isWslPath
      ? rawPath.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_, drive, rest) => `${drive.toUpperCase()}:/${rest}`)
      : rawPath;
    const resolved = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);

    // If file or directory already exists on disk
    if (fs.existsSync(resolved)) {
      if (fs.statSync(resolved).isDirectory() && ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'].includes(base)) {
        const hasRecurse = args.some(a => a === '-r' || a === '-R' || a === '--recursive' || (a.startsWith('-') && !a.startsWith('--') && (a.includes('r') || a.includes('R'))));
        if (!hasRecurse) {
          console.error(`\n   💡 AGENT HINT: 'grep' called on directory '${arg}' without recursive flag.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
          args.unshift('-r');
        }
      }
      continue;
    }

    // 3a. Check if path ends with code extension, but a directory without extension exists (modularized/refactored directory)
    const extMatch = rawPath.match(/\.(?:ts|js|tsx|jsx|mjs|cjs)$/i);
    if (extMatch !== null) {
      const withoutExt = rawPath.slice(0, -extMatch[0].length);
      const normalizedWithoutExt = isWslPath
        ? withoutExt.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_, drive, rest) => `${drive.toUpperCase()}:/${rest}`)
        : withoutExt;
      const resolvedWithoutExt = path.isAbsolute(normalizedWithoutExt) ? path.normalize(normalizedWithoutExt) : path.resolve(cwd, normalizedWithoutExt);
      if (fs.existsSync(resolvedWithoutExt) && fs.statSync(resolvedWithoutExt).isDirectory()) {
        const isSearchTool = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe'].includes(base);
        if (isSearchTool) {
          const healedDir = preserveQuotes(arg, withoutExt);
          console.error(`\n   💡 AGENT HINT: File '${arg}' not found, but modular directory '${withoutExt}' exists.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to '${healedDir}'... (Frictionless Recovery)\x1b[0m`);
          args[i] = healedDir;
          if (['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'].includes(base)) {
            const hasRecurse = args.some(a => a === '-r' || a === '-R' || a === '--recursive' || (a.startsWith('-') && !a.startsWith('--') && (a.includes('r') || a.includes('R'))));
            if (!hasRecurse) {
              console.error(`\n   💡 AGENT HINT: 'grep' called on directory '${withoutExt}' without recursive flag.`);
              console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-r' to search directory recursively... (Frictionless Recovery)\x1b[0m`);
              args.unshift('-r');
            }
          }
          continue;
        }

        // File inspection/runtime tools: check for barrel entrypoint (index.ts, index.js, etc.)
        let foundBarrel: string | null = null;
        for (const barrel of BARREL_CANDIDATES) {
          if (fs.existsSync(path.join(resolvedWithoutExt, barrel))) {
            foundBarrel = barrel;
            break;
          }
        }

        if (foundBarrel !== null) {
          const sep = withoutExt.includes('\\') ? '\\' : '/';
          const barrelPath = `${withoutExt}${sep}${foundBarrel}`;
          const healedBarrel = preserveQuotes(arg, barrelPath);
          console.error(`\n   💡 AGENT HINT: File '${arg}' not found on disk, but directory '${withoutExt}' exists with entrypoint '${foundBarrel}'.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to '${healedBarrel}'... (Frictionless Recovery)\x1b[0m`);
          args[i] = healedBarrel;
          continue;
        }
      }
    }

    // 3b. Check candidate extensions
    let extensionHealed = false;
    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
        const healedArg = formatHealedPath(arg, candidate, cwd, isWslPath);
        console.error(`\n   💡 AGENT HINT: Path '${arg}' not found on disk, but '${healedArg}' exists.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to '${healedArg}'... (Frictionless Recovery)\x1b[0m`);
        args[i] = healedArg;
        extensionHealed = true;
        break;
      }
    }
    if (extensionHealed) {
      continue;
    }

    // 3c. Check directory synonyms and neighbor directories
    const isSearchOrListTool = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'rg', 'rg.exe', 'ls', 'ls.exe', 'dir', 'dir.exe', 'find', 'find.exe'].includes(base);
    if (!isSearchOrListTool && !rawPath.includes('/') && !rawPath.includes('\\')) {
      continue;
    }
    const candidatePath = resolvePathWithDirectorySynonyms(resolved, isSearchOrListTool) ?? resolveBuildSrcSwap(resolved, isSearchOrListTool) ?? findNeighborFilePath(resolved, isSearchOrListTool);
    if (candidatePath !== null) {
      const healedArg = formatHealedPath(arg, candidatePath, cwd, isWslPath);
      const isDir = fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory();
      console.error(`\n   💡 AGENT HINT: ${isDir ? 'Directory' : 'File'} '${arg}' not found on disk, but found at '${healedArg}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-correcting path to '${healedArg}'... (Frictionless Recovery)\x1b[0m`);
      args[i] = healedArg;
      if (isDir && ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'].includes(base)) {
        const hasRecurse = args.some(a => a === '-r' || a === '-R' || a === '--recursive' || (a.startsWith('-') && !a.startsWith('--') && (a.includes('r') || a.includes('R'))));
        if (!hasRecurse) {
          args.unshift('-r');
        }
      }
      continue;
    }
  }
}
