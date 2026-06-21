
import { getGitTagRange, streamGitRecords, cleanupProcesses, buildGitBaseArgs, RECORD_SEPARATOR, FIELD_SEPARATOR } from '../vendor/lib-git-history/git-runner.js';
import { parseGitRecord, processBatch, type RawCommitBatchItem } from '../vendor/lib-git-history/parser.js';
import type { CliArgs } from '../vendor/lib-git-history/cli.js';
import type { CommitEntry } from '../vendor/lib-git-history/schema.js';
import type { GitCommit, UnreleasedChangelog, ChangelogEntry } from './types.js';

export class NativeGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeGitError';
  }
}

export function buildCliArgs(options: { maxCount?: number; since?: string; ref?: string; path?: string; query?: string; author?: string } = {}): CliArgs {
  return {
    limit: options.maxCount?.toString(),
    since: options.since,
    range: options.ref,
    path: options.path,
    grep: options.query,
    author: options.author,
  };
}

export function toGitCommit(entry: CommitEntry): GitCommit {
  const trailers: Record<string, string> = {};
  if (entry.metadata) {
    if (entry.metadata.category?.[0]) trailers['History-Category'] = entry.metadata.category[0];
    if (entry.metadata.entry?.[0]) trailers['History-Entry'] = entry.metadata.entry[0];
    if (entry.metadata.significance) trailers['History-Significance'] = entry.metadata.significance;
    if (entry.metadata.impact != null) trailers['History-Impact'] = String(entry.metadata.impact);
    if (entry.metadata.trust != null) trailers['History-Trust'] = String(entry.metadata.trust);
    if (entry.metadata.validation) trailers['History-Validation'] = entry.metadata.validation;
    
    if (entry.metadata.customTrailers) {
      for (const [key, values] of Object.entries(entry.metadata.customTrailers)) {
        if (values[0] !== undefined) trailers[key] = values[0];
      }
    }
  }

  return {
    hash: entry.commit,
    date: entry.date,
    message: entry.subject,
    author_name: entry.author,
    author_email: entry.email || '',
    body: entry.body || '',
    trailers
  };
}

async function runStreamingQuery(baseDir: string, args: CliArgs, targetRange?: string, limit?: number): Promise<CommitEntry[]> {
  const results: CommitEntry[] = [];
  try {
    const baseGitArgs = buildGitBaseArgs(args, targetRange);
    const formattingFlags: string[] = [];
    let inPath = false;
    for (const a of baseGitArgs) {
      if (a === '--') { inPath = true; formattingFlags.push(a); }
      else if (inPath) formattingFlags.push(a);
      else if (a.startsWith('--diff-filter=') || ['--cc', '--no-merges', '--first-parent', '-c'].includes(a)) formattingFlags.push(a);
    }

    const mainArgs = [
      '-c', 'core.quotePath=false',
      'log',
      '-z',
      '--name-status',
      `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%cn${FIELD_SEPARATOR}%ce${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%(trailers)${FIELD_SEPARATOR}%(trailers:separator=%x1C)${FIELD_SEPARATOR}%P`,
      ...baseGitArgs
    ];

    let batch: RawCommitBatchItem[] = [];
    let yieldedCount = 0;

    for await (const commitBlock of streamGitRecords(mainArgs, baseDir)) {
      const record = parseGitRecord(commitBlock, args);
      if (!record) continue;
      batch.push(record);

      const batchSize = limit !== undefined ? Math.min(50, limit - yieldedCount) : 50;

      if (batch.length >= batchSize) {
        const processed = await processBatch(batch, args, formattingFlags);
        for (const p of processed) {
          if (limit !== undefined && yieldedCount >= limit) break;
          results.push(p);
          yieldedCount++;
        }
        batch = [];
        if (limit !== undefined && yieldedCount >= limit) break;
      }
    }

    if (batch.length > 0 && (limit === undefined || yieldedCount < limit)) {
      const processed = await processBatch(batch, args, formattingFlags);
      for (const p of processed) {
        if (limit !== undefined && yieldedCount >= limit) break;
        results.push(p);
        yieldedCount++;
      }
    }

    return results;
  } catch (error) {
    cleanupProcesses();
    throw new NativeGitError(error instanceof Error ? error.message : String(error));
  }
}

export async function getNativeCommitHistory(baseDir: string, options: { maxCount?: number; since?: string; ref?: string; path?: string; query?: string; author?: string } = {}): Promise<GitCommit[]> {
  const args = buildCliArgs(options);
  const commits = await runStreamingQuery(baseDir, args, options.ref || 'HEAD', options.maxCount);
  return commits.map(toGitCommit);
}

export async function getUnreleasedChangelog(baseDir: string): Promise<UnreleasedChangelog> {
  try {
    const tagRangeInfo = getGitTagRange(baseDir);
    const args: CliArgs = { 'changelog-only': true };
    
    const rangeParts = tagRangeInfo.range.split('..');
    const from = rangeParts.length > 1 ? (rangeParts[0] ?? '') : '';
    const to = rangeParts.length > 1 ? (rangeParts[1] ?? tagRangeInfo.range) : tagRangeInfo.range;

    const commits = await runStreamingQuery(baseDir, args, tagRangeInfo.range, 500);

    const categories: Record<string, ChangelogEntry[]> = {};
    let totalCount = 0;

    for (const commit of commits) {
      const hasEntry = commit.metadata?.entry && commit.metadata.entry.length > 0;
      const isStandard = ['feat', 'fix', 'perf', 'revert'].includes(commit.type || '') || commit.isBreaking;
      if (!hasEntry && !isStandard) continue;

      let categoryNames = commit.metadata?.category;
      if (!categoryNames || categoryNames.length === 0) {
        categoryNames = commit.type ? [commit.type.charAt(0).toUpperCase() + commit.type.slice(1)] : ['Uncategorized'];
      }

      for (const cat of categoryNames) {
        categories[cat] ??= [];
        const entryText = (commit.metadata?.entry && commit.metadata.entry.length > 0) ? commit.metadata.entry[0] : (commit.cleanSubject || commit.subject);
        
        categories[cat].push({
          hash: commit.commit,
          shortHash: commit.commit.substring(0, 7),
          message: commit.subject,
          category: cat,
          entry: entryText ?? '',
          date: commit.date,
          author: commit.author,
          isBreaking: commit.isBreaking ?? false,
          scope: commit.scope
        });
      }
      totalCount++;
    }

    return {
      range: { from, to, isFallback: tagRangeInfo.isFallback },
      categories,
      totalCount
    };
  } catch (error) {
    cleanupProcesses();
    throw new NativeGitError(error instanceof Error ? error.message : String(error));
  }
}
