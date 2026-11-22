// @ts-nocheck
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeRegistryPath,
  persistJournalEntryFile,
  readNormalizedMemoryJournalRegistry,
  resolveInProcessEntryModule,
  resolveMemoryJournalCli,
  tryCreateJournalEntryInProcess,
  type NormalizedRegistryEntry,
} from './commit-journal-bridge.js';

export {
  resolveInProcessEntryModule,
  resolveMemoryJournalCli,
  tryCreateJournalEntryInProcess,
};

export const VALID_CATEGORIES = ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'] as const;
export type CommitCategory = (typeof VALID_CATEGORIES)[number];

const VALID_CATEGORY_SET: ReadonlySet<string> = new Set(VALID_CATEGORIES);

export const TYPE_TO_CATEGORY: Record<string, CommitCategory> = {
  feat: 'Added',
  fix: 'Fixed',
  perf: 'Changed',
  refactor: 'Changed',
  remove: 'Removed',
  drop: 'Removed',
  security: 'Security',
  docs: 'Changed',
  style: 'Changed',
  test: 'Changed',
  chore: 'Changed',
};

const HISTORY_CATEGORY_REGEX = /^([A-Za-z]+):\s*([\s\S]+)$/;
const JOURNAL_PREFIX = 'journal-';

export interface CommitRelationSpec {
  targetId: number;
  relationType: string;
}

export interface CommitJournalArgs {
  impact: number;
  confidence: number;
  validation: 'passed' | 'none' | 'failed';
  journal: boolean;
  'journal-project'?: number | undefined;
  'session-id'?: string | undefined;
  tags?: string[] | undefined;
  significance?: string | undefined;
  relate?: CommitRelationSpec[] | undefined;
  category?: CommitCategory | undefined;
  'no-history': boolean;
  'no-auto-link'?: boolean | undefined;
  'dry-run-links'?: boolean | undefined;
}

export interface ResolvedJournalTarget {
  workspaceId?: string;
  projectNumber?: number;
}

export function capitalizeCategory(val: string): string {
  return val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
}

export function isValidCategory(cat: string): cat is CommitCategory {
  return VALID_CATEGORY_SET.has(cat);
}

function findLongestRegistryPathMatch(
  entries: readonly NormalizedRegistryEntry[],
  normalizedCwd: string
): { workspaceId: string; projectNumber?: number; matchLen: number } | undefined {
  let best: { workspaceId: string; projectNumber?: number; matchLen: number } | undefined;
  for (const entry of entries) {
    const isMatch =
      normalizedCwd === entry.normalizedPath ||
      normalizedCwd.startsWith(`${entry.normalizedPath}/`);
    if (isMatch && (best === undefined || entry.normalizedPath.length > best.matchLen)) {
      best = {
        workspaceId: entry.workspaceId,
        ...(entry.projectNumber !== undefined ? { projectNumber: entry.projectNumber } : {}),
        matchLen: entry.normalizedPath.length,
      };
    }
  }
  return best;
}

function findWorkspaceByProjectNumber(
  entries: readonly NormalizedRegistryEntry[],
  projectNumber: number
): string | undefined {
  for (const entry of entries) {
    if (entry.projectNumber === projectNumber) {
      return entry.workspaceId;
    }
  }
  return undefined;
}

// [INTENT]: Resolves deterministic workspace_id and project_number from memory-journal.config.json projectRegistry so commit.ts --journal never falls back to keyword-alias matching.
export function resolveJournalTarget(
  cwd: string,
  explicitProjectNumber?: number,
  configPath?: string
): ResolvedJournalTarget {
  const result: ResolvedJournalTarget = {};
  if (explicitProjectNumber !== undefined) {
    result.projectNumber = explicitProjectNumber;
  }

  const entries = readNormalizedMemoryJournalRegistry(configPath);
  if (entries === undefined) {
    return result;
  }

  const bestPathMatch = findLongestRegistryPathMatch(entries, normalizeRegistryPath(cwd));
  if (explicitProjectNumber !== undefined) {
    if (bestPathMatch !== undefined && bestPathMatch.projectNumber === explicitProjectNumber) {
      result.workspaceId = bestPathMatch.workspaceId;
    } else {
      result.workspaceId = findWorkspaceByProjectNumber(entries, explicitProjectNumber);
    }
  } else if (bestPathMatch !== undefined) {
    result.workspaceId = bestPathMatch.workspaceId;
    if (bestPathMatch.projectNumber !== undefined) {
      result.projectNumber = bestPathMatch.projectNumber;
    }
  }

  return result;
}

export function parseCategory(history: string, type: string): { category: string; entry: string } {
  const cleanHistory = history.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const categoryMatch = cleanHistory.match(HISTORY_CATEGORY_REGEX);

  if (categoryMatch !== null) {
    const matchedCat = categoryMatch[1] ?? '';
    const entryBody = (categoryMatch[2] ?? '').trim();
    const capitalizedMatch = capitalizeCategory(matchedCat);

    if (isValidCategory(capitalizedMatch)) {
      return { category: capitalizedMatch, entry: entryBody };
    }

    const lowerCat = matchedCat.toLowerCase();
    const mapped = Object.hasOwn(TYPE_TO_CATEGORY, lowerCat) ? TYPE_TO_CATEGORY[lowerCat] : undefined;
    if (mapped !== undefined) {
      console.warn(`⚠️ AUTONOMOUS HEALING: Invalid history category '${matchedCat}' mapped to '${mapped}'.`);
      return { category: mapped, entry: entryBody };
    }

    console.warn(`⚠️ AUTONOMOUS HEALING: Unrecognized history category '${matchedCat}'. Falling back to default category.`);
    const fallbackCategory = Object.hasOwn(TYPE_TO_CATEGORY, type) ? TYPE_TO_CATEGORY[type] : 'Changed';
    return { category: fallbackCategory, entry: entryBody };
  }

  const category = Object.hasOwn(TYPE_TO_CATEGORY, type) ? TYPE_TO_CATEGORY[type] : 'Changed';
  return { category, entry: cleanHistory.trim() };
}

export function generateHistoryEntry(
  args: CommitJournalArgs,
  type: string,
  historyContent: string,
  cwd?: string,
  resolvedTarget?: ResolvedJournalTarget
): string {
  const parsedCategory = parseCategory(historyContent, type);
  const category = args.category ?? parsedCategory.category;

  let entry = parsedCategory.entry;

  if (entry.length > 0) {
    entry = entry
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim() === '' ? '\u200B' : line)
      .join('\n')
      .replace(/\n/g, '\n  ');
  }

  let body = `\n\nHistory-Category: ${category}`;

  if (entry.length > 0 || !args['no-history']) {
    body += `\nHistory-Entry: ${entry}`;
  }

  if (args.significance !== undefined && args.significance.length > 0) {
    body += `\nHistory-Significance: ${args.significance}`;
  }
  body += `\nHistory-Impact: ${args.impact}`;
  body += `\nHistory-Confidence: ${args.confidence}`;
  body += `\nHistory-Validation: ${args.validation}`;
  if (args.journal) {
    body += `\nHistory-Journal: true`;
    const journalProject =
      args['journal-project'] ??
      (resolvedTarget !== undefined
        ? resolvedTarget.projectNumber
        : cwd !== undefined
          ? resolveJournalTarget(cwd).projectNumber
          : undefined);
    if (journalProject !== undefined) {
      body += `\nHistory-Journal-Project: ${journalProject}`;
    }
  }

  return body;
}

export function extractCommittedFiles(sha: string, cwd: string, limit = 25): string[] {
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || fs.statSync(cwd, { throwIfNoEntry: false }) === undefined) {
    return [];
  }
  try {
    const out = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '-z', sha],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
    return out
      .split('\0')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function buildCommitJournalContent(
  sha: string,
  header: string,
  args: CommitJournalArgs,
  historyContent: string,
  cwd: string,
  configPath?: string,
  committedFiles?: readonly string[],
  resolvedTarget?: ResolvedJournalTarget
): string {
  const resolved = resolvedTarget ?? resolveJournalTarget(cwd, args['journal-project'], configPath);
  const mergedTags = Array.from(new Set(['commit-narrative', ...(args.tags ?? [])]));
  const changedFiles =
    committedFiles !== undefined && committedFiles.length > 0
      ? committedFiles.slice(0, 25)
      : extractCommittedFiles(sha, cwd);
  const frontmatterLines = [
    '---',
    'type: "technical_note"',
    `tags: ${JSON.stringify(mergedTags)}`,
  ];

  if (resolved.workspaceId !== undefined && resolved.workspaceId.length > 0) {
    frontmatterLines.push(`workspace_id: ${JSON.stringify(resolved.workspaceId)}`);
  }
  if (resolved.projectNumber !== undefined) {
    frontmatterLines.push(`project: ${resolved.projectNumber}`);
  }
  if (args['session-id'] !== undefined && args['session-id'].length > 0) {
    frontmatterLines.push(`session_id: ${JSON.stringify(args['session-id'])}`);
  }
  if (args.significance !== undefined && args.significance.length > 0) {
    frontmatterLines.push(`significance_type: ${JSON.stringify(args.significance)}`);
  }
  if (args.relate !== undefined && args.relate.length > 0) {
    frontmatterLines.push(`relationships: ${JSON.stringify(args.relate)}`);
  }
  if (changedFiles.length > 0) {
    frontmatterLines.push(`anchors: ${JSON.stringify(changedFiles)}`);
  }

  frontmatterLines.push(`impact: ${args.impact}`);
  frontmatterLines.push(`trust: ${args.confidence}`);
  frontmatterLines.push(`validation_status: "${args.validation}"`);
  if (args['no-auto-link'] !== true) {
    frontmatterLines.push('auto_link: true');
  }

  frontmatterLines.push('auto_context:');
  frontmatterLines.push('  type: "session-commits"');
  frontmatterLines.push(`  commits: [${JSON.stringify(sha)}]`);
  frontmatterLines.push('---');

  const journalBody = historyContent.trim().length > 0 ? historyContent : header;
  return `${frontmatterLines.join('\n')}\n${journalBody}\n\nCommit: ${sha}`;
}

export async function createJournalEntry(
  sha: string,
  header: string,
  args: CommitJournalArgs,
  historyContent: string,
  cwd: string,
  registerTempFile: (filepath: string) => void,
  cleanupTempFile: (filepath: string) => void,
  formatError: (error: unknown) => string,
  committedFiles?: readonly string[],
  resolvedTarget?: ResolvedJournalTarget
): Promise<void> {
  if (!args.journal) {
    const ignoredFlags: string[] = [];
    if (args['dry-run-links'] === true) ignoredFlags.push('--dry-run-links');
    if (args.relate !== undefined && args.relate.length > 0) ignoredFlags.push('--relate');
    if (args.tags !== undefined && args.tags.length > 0) ignoredFlags.push('--tags');
    if (args['session-id'] !== undefined && args['session-id'].length > 0) ignoredFlags.push('--session-id');
    if (args['no-auto-link'] === true) ignoredFlags.push('--no-auto-link');
    if (ignoredFlags.length > 0) {
      console.warn(
        `⚠️ AUTONOMOUS HEALING: Journal-only flag(s) (${ignoredFlags.join(', ')}) ignored without --journal. Pass --journal to record a journal entry.`
      );
    }
    return;
  }

  console.log(`\n📓 Creating automated journal entry for ${sha}...`);
  try {
    const journalContent = buildCommitJournalContent(
      sha,
      header,
      args,
      historyContent,
      cwd,
      undefined,
      committedFiles,
      resolvedTarget
    );
    const journalFile = path.join(os.tmpdir(), `${JOURNAL_PREFIX}${sha.slice(0, 12)}-${crypto.randomUUID()}.md`);
    registerTempFile(journalFile);
    fs.writeFileSync(journalFile, journalContent, { mode: 0o600 });

    try {
      await persistJournalEntryFile(journalFile, cwd, args['dry-run-links']);
    } finally {
      cleanupTempFile(journalFile);
    }
  } catch (e: unknown) {
    console.error(`\n⚠️ Failed to create journal entry: ${formatError(e)}`);
  }
}
