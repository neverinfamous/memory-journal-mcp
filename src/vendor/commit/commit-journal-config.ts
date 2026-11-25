// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { redactSensitiveText } from './commit-security.js';

const FORBIDDEN_REGISTRY_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '*',
]);

const projectRegistryEntrySchema = z.object({
  path: z.string().trim().min(1),
  project_number: z
    .number()
    .int()
    .positive()
    .refine((n) => Number.isSafeInteger(n))
    .optional(),
});

export type ProjectRegistryEntry = z.infer<typeof projectRegistryEntrySchema>;
export type ProjectRegistry = Record<string, ProjectRegistryEntry>;

export interface NormalizedRegistryEntry {
  workspaceId: string;
  normalizedPath: string;
  projectNumber?: number;
}

interface CachedConfigEntry {
  mtimeMs: number;
  size: number;
  projectRegistry: ProjectRegistry | undefined;
  normalizedEntries: readonly NormalizedRegistryEntry[] | undefined;
}

const MAX_CONFIG_CACHE_ENTRIES = 16;
const configCache = new Map<string, CachedConfigEntry>();
const WIN32_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;

export function normalizeRegistryPath(targetPath: string): string {
  const isWinSyntax = process.platform === 'win32' || WIN32_DRIVE_PATH_RE.test(targetPath);
  const resolved = WIN32_DRIVE_PATH_RE.test(targetPath)
    ? path.win32.resolve(targetPath)
    : path.resolve(targetPath);
  const slashed = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  return isWinSyntax ? slashed.toLowerCase() : slashed;
}

export function getDefaultConfigPath(): string {
  const envConfig = process.env['MEMORY_JOURNAL_CONFIG'];
  if (envConfig !== undefined && envConfig.trim().length > 0) {
    return path.resolve(envConfig.trim());
  }
  return path.join(os.homedir(), '.gemini', 'config', 'memory-journal.config.json');
}

function sanitizeProjectRegistry(raw: unknown, configPath: string): ProjectRegistry | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    console.warn(`⚠️ Ignoring malformed projectRegistry in ${configPath}: expected a JSON object.`);
    return undefined;
  }
  const clean: ProjectRegistry = {};
  Object.setPrototypeOf(clean, null);
  const skippedKeys: string[] = [];
  for (const [workspaceId, value] of Object.entries(raw)) {
    if (workspaceId.trim().length === 0 || FORBIDDEN_REGISTRY_KEYS.has(workspaceId)) {
      skippedKeys.push(workspaceId);
      continue;
    }
    const parsed = projectRegistryEntrySchema.safeParse(value);
    if (parsed.success) {
      clean[workspaceId] = parsed.data;
    } else {
      skippedKeys.push(workspaceId);
    }
  }
  if (skippedKeys.length > 0) {
    console.warn(`⚠️ Skipped malformed projectRegistry entry(s) in ${configPath}: ${skippedKeys.join(', ')}`);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function readCachedConfigEntry(configPath?: string): CachedConfigEntry | undefined {
  const effectiveConfigPath =
    configPath !== undefined && configPath.length > 0
      ? path.resolve(configPath)
      : getDefaultConfigPath();

  const stats = fs.statSync(effectiveConfigPath, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile()) {
    configCache.delete(effectiveConfigPath);
    return undefined;
  }

  const cached = configCache.get(effectiveConfigPath);
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached;
  }

  try {
    const rawContent = fs.readFileSync(effectiveConfigPath, 'utf-8');
    const cleanContent = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;
    const parsedJson: unknown = JSON.parse(cleanContent);
    const rawRegistry =
      parsedJson !== null && typeof parsedJson === 'object' && !Array.isArray(parsedJson) && 'projectRegistry' in parsedJson
        ? parsedJson.projectRegistry
        : undefined;
    const projectRegistry = sanitizeProjectRegistry(rawRegistry, effectiveConfigPath);
    const normalizedEntries =
      projectRegistry !== undefined
        ? Object.entries(projectRegistry).map(([workspaceId, entry]) => ({
            workspaceId,
            normalizedPath: normalizeRegistryPath(entry.path),
            ...(entry.project_number !== undefined ? { projectNumber: entry.project_number } : {}),
          }))
        : undefined;
    if (configCache.size >= MAX_CONFIG_CACHE_ENTRIES && !configCache.has(effectiveConfigPath)) {
      const oldestKey = configCache.keys().next().value;
      if (oldestKey !== undefined) {
        configCache.delete(oldestKey);
      }
    }
    const entry: CachedConfigEntry = {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      projectRegistry,
      normalizedEntries,
    };
    configCache.set(effectiveConfigPath, entry);
    return entry;
  } catch (err: unknown) {
    configCache.delete(effectiveConfigPath);
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `⚠️ Failed to parse memory-journal config at ${effectiveConfigPath}: ${redactSensitiveText(rawMsg)}`
    );
    return undefined;
  }
}

/**
 * [INTENT]: Memoized config loader keyed by `(effectiveConfigPath, mtimeMs, size)` so a single
 * commit does not repeatedly read, JSON.parse, and Zod-validate `memory-journal.config.json`.
 */
export function readMemoryJournalRegistry(configPath?: string): ProjectRegistry | undefined {
  return readCachedConfigEntry(configPath)?.projectRegistry;
}

export function readNormalizedMemoryJournalRegistry(
  configPath?: string
): readonly NormalizedRegistryEntry[] | undefined {
  return readCachedConfigEntry(configPath)?.normalizedEntries;
}
