// @ts-nocheck
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const VALID_CATEGORIES = ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'] as const;
export type CommitCategory = (typeof VALID_CATEGORIES)[number];

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

const projectRegistryEntrySchema = z.object({
  path: z.string().min(1),
  project_number: z.number().int().positive(),
});

const memoryJournalConfigSchema = z.object({
  projectRegistry: z.record(z.string(), projectRegistryEntrySchema).optional(),
});

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
  return VALID_CATEGORIES.some((c) => c === cat);
}

function normalizeRegistryPath(targetPath: string): string {
  return path.resolve(targetPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function getDefaultConfigPath(): string {
  const envConfig = process.env['MEMORY_JOURNAL_CONFIG'];
  if (envConfig !== undefined && envConfig.trim().length > 0) {
    return path.resolve(envConfig.trim());
  }
  return path.join(os.homedir(), '.gemini', 'config', 'memory-journal.config.json');
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

  const effectiveConfigPath = configPath !== undefined && configPath.length > 0
    ? configPath
    : getDefaultConfigPath();

  if (!fs.existsSync(effectiveConfigPath)) {
    return result;
  }

  try {
    const rawContent = fs.readFileSync(effectiveConfigPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedConfig = memoryJournalConfigSchema.safeParse(parsedJson);
    if (!parsedConfig.success || parsedConfig.data.projectRegistry === undefined) {
      return result;
    }

    const registry = parsedConfig.data.projectRegistry;
    const normalizedCwd = normalizeRegistryPath(cwd);

    let bestPathMatch: { workspaceId: string; projectNumber: number; matchLen: number } | undefined;
    for (const [workspaceName, entry] of Object.entries(registry)) {
      const normalizedEntryPath = normalizeRegistryPath(entry.path);
      const isMatch =
        normalizedCwd === normalizedEntryPath ||
        normalizedCwd.startsWith(`${normalizedEntryPath}/`);
      if (isMatch && (bestPathMatch === undefined || normalizedEntryPath.length > bestPathMatch.matchLen)) {
        bestPathMatch = {
          workspaceId: workspaceName,
          projectNumber: entry.project_number,
          matchLen: normalizedEntryPath.length,
        };
      }
    }

    if (explicitProjectNumber !== undefined) {
      if (bestPathMatch !== undefined && bestPathMatch.projectNumber === explicitProjectNumber) {
        result.workspaceId = bestPathMatch.workspaceId;
      } else {
        for (const [workspaceName, entry] of Object.entries(registry)) {
          if (entry.project_number === explicitProjectNumber) {
            result.workspaceId = workspaceName;
            break;
          }
        }
        if (result.workspaceId === undefined && bestPathMatch !== undefined) {
          result.workspaceId = bestPathMatch.workspaceId;
        }
      }
    } else if (bestPathMatch !== undefined) {
      result.workspaceId = bestPathMatch.workspaceId;
      result.projectNumber = bestPathMatch.projectNumber;
    }
  } catch {
    // Non-fatal: fall back to explicit CLI flags if config file cannot be parsed
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

    const mapped = TYPE_TO_CATEGORY[matchedCat.toLowerCase()];
    if (mapped !== undefined) {
      console.warn(`⚠️ AUTONOMOUS HEALING: Invalid history category '${matchedCat}' mapped to '${mapped}'.`);
      return { category: mapped, entry: entryBody };
    }

    console.warn(`⚠️ AUTONOMOUS HEALING: Unrecognized history category '${matchedCat}'. Falling back to default category.`);
    return { category: TYPE_TO_CATEGORY[type] ?? 'Changed', entry: entryBody };
  }

  const category = TYPE_TO_CATEGORY[type] ?? 'Changed';
  return { category, entry: cleanHistory.trim() };
}

export function generateHistoryEntry(
  args: CommitJournalArgs,
  type: string,
  historyContent: string,
  cwd?: string
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
      (cwd !== undefined ? resolveJournalTarget(cwd).projectNumber : undefined);
    if (journalProject !== undefined) {
      body += `\nHistory-Journal-Project: ${journalProject}`;
    }
  }

  return body;
}

export function extractCommittedFiles(sha: string, cwd: string, limit = 25): string[] {
  if (!/^[0-9a-f]{7,40}$/i.test(sha) || !fs.existsSync(cwd)) {
    return [];
  }
  try {
    const out = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', sha],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out
      .split(/\r?\n/)
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
  configPath?: string
): string {
  const resolved = resolveJournalTarget(cwd, args['journal-project'], configPath);
  const mergedTags = Array.from(new Set(['commit-narrative', ...(args.tags ?? [])]));
  const changedFiles = extractCommittedFiles(sha, cwd);
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
  frontmatterLines.push(`  commits: ["${sha}"]`);
  frontmatterLines.push('---');

  const journalBody = historyContent.length > 0 ? historyContent : header;
  return `${frontmatterLines.join('\n')}\n${journalBody}\n\nCommit: ${sha}`;
}

const packageJsonNameSchema = z.object({
  name: z.string().optional(),
});

const MEMORY_JOURNAL_PACKAGE_NAMES = new Set([
  'memory-journal-mcp',
  '@neverinfamous/memory-journal-mcp',
]);

function isMemoryJournalPackageDir(dirPath: string): boolean {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  try {
    const rawContent = fs.readFileSync(pkgPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedPkg = packageJsonNameSchema.safeParse(parsedJson);
    return (
      parsedPkg.success &&
      parsedPkg.data.name !== undefined &&
      MEMORY_JOURNAL_PACKAGE_NAMES.has(parsedPkg.data.name)
    );
  } catch {
    return false;
  }
}

function resolveRegistryMemoryJournalCli(configPath?: string): string | null {
  const effectiveConfigPath =
    configPath !== undefined && configPath.length > 0
      ? configPath
      : getDefaultConfigPath();
  if (!fs.existsSync(effectiveConfigPath)) {
    return null;
  }
  try {
    const rawContent = fs.readFileSync(effectiveConfigPath, 'utf-8');
    const parsedJson: unknown = JSON.parse(rawContent);
    const parsedConfig = memoryJournalConfigSchema.safeParse(parsedJson);
    const mjEntry = parsedConfig.success
      ? parsedConfig.data.projectRegistry?.['memory-journal-mcp']
      : undefined;
    if (mjEntry === undefined) {
      return null;
    }
    const mjDir = path.resolve(mjEntry.path);
    const cliPath = path.join(mjDir, 'dist', 'cli.js');
    if (isMemoryJournalPackageDir(mjDir) && fs.existsSync(cliPath)) {
      return cliPath;
    }
  } catch {
    // Non-fatal: continue to remaining CLI resolution candidates
  }
  return null;
}

export function resolveMemoryJournalCli(
  cwd: string,
  configPath?: string
): { command: string; prefixArgs: string[] } {
  const candidates: string[] = [];

  if (isMemoryJournalPackageDir(cwd)) {
    candidates.push(path.join(cwd, 'dist', 'cli.js'));
  }

  const siblingMjDir = path.resolve(cwd, '..', 'memory-journal-mcp');
  if (isMemoryJournalPackageDir(siblingMjDir)) {
    candidates.push(path.join(siblingMjDir, 'dist', 'cli.js'));
  }

  const registryCli = resolveRegistryMemoryJournalCli(configPath);
  if (registryCli !== null) {
    candidates.push(registryCli);
  }

  const appData = process.env['APPDATA'];
  if (appData !== undefined && appData.length > 0) {
    candidates.push(path.join(appData, 'npm', 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js'));
  }

  const rawPath = process.env['PATH'] ?? '';
  for (const dir of rawPath.split(path.delimiter)) {
    if (dir.length === 0) continue;
    candidates.push(path.join(dir, 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js'));
    candidates.push(path.join(path.dirname(dir), 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js'));
    candidates.push(path.join(path.dirname(dir), 'lib', 'node_modules', 'memory-journal-mcp', 'dist', 'cli.js'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { command: 'node', prefixArgs: [candidate] };
    }
  }

  return { command: 'memory-journal-mcp', prefixArgs: [] };
}

export function createJournalEntry(
  sha: string,
  header: string,
  args: CommitJournalArgs,
  historyContent: string,
  cwd: string,
  registerTempFile: (filepath: string) => void,
  cleanupTempFile: (filepath: string) => void,
  formatError: (error: unknown) => string
): void {
  if (!args.journal) {
    return;
  }

  console.log(`\n📓 Creating automated journal entry for ${sha}...`);
  try {
    const journalContent = buildCommitJournalContent(sha, header, args, historyContent, cwd);
    const journalFile = path.join(os.tmpdir(), `${JOURNAL_PREFIX}${sha}.md`);
    registerTempFile(journalFile);
    fs.writeFileSync(journalFile, journalContent, { mode: 0o600 });

    try {
      const resolvedCli = resolveMemoryJournalCli(cwd);
      const cliArgs = [...resolvedCli.prefixArgs, 'entry', 'create', '--file', journalFile];
      if (args['dry-run-links'] === true) {
        cliArgs.push('--dry-run-links');
      }
      execFileSync(resolvedCli.command, cliArgs, {
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        cwd,
      });
    } finally {
      cleanupTempFile(journalFile);
    }
  } catch (e: unknown) {
    console.error(`\n⚠️ Failed to create journal entry: ${formatError(e)}`);
  }
}
