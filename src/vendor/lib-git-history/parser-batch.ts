// @ts-nocheck
import type { z } from 'zod';
import { entrySchema, fileStatusSchema, type CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { getNumstatMap } from './git-numstat.js';
import { getPatchMap } from './git-patch.js';
import { isNoiseFile, getSlackMap, getLanguage, truncateSafely, flattenString } from './parser-utils.js';
import { DEFAULT_MAX_BODY_LEN, MAX_FILES_PER_COMMIT, MS_PER_DAY } from './constants.js';
import type { RawCommitBatchItem } from './parser-record.js';

const SIZE_XS_THRESHOLD = 10;
const SIZE_S_THRESHOLD = 50;
const SIZE_M_THRESHOLD = 250;
const SIZE_L_THRESHOLD = 1000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseWithFallbacks(entryObj: Record<string, unknown>, sha: string, subject: string, date: string, authorName: string): CommitEntry | null {
  const parseResult = entrySchema.safeParse(entryObj);
  if (parseResult.success) return parseResult.data;

  const coercedObj: Record<string, unknown> = { ...entryObj };
  for (const issue of parseResult.error.issues) {
    const topKey = issue.path.length > 0 ? String(issue.path[0]) : '';
    if (!topKey || FORBIDDEN_KEYS.has(topKey)) continue;
    if (topKey === 'metadata' && issue.path.length >= 2) {
      const subKey = String(issue.path[1]);
      if (FORBIDDEN_KEYS.has(subKey)) continue;
      const rawMeta = coercedObj['metadata'];
      const meta: Record<string, unknown> = typeof rawMeta === 'object' && rawMeta !== null
        ? { ...rawMeta }
        : {};
      delete meta[subKey];
      coercedObj['metadata'] = meta;
    } else {
      delete coercedObj[topKey];
    }
  }
  const retryResult = entrySchema.safeParse(coercedObj);
  if (retryResult.success) {
    const finalData = retryResult.data;
    finalData.validationErrors = parseResult.error.issues;
    finalData.isCorrupted = true;
    return finalData;
  }

  coercedObj['commit'] = coercedObj['commit'] || sha || 'unknown_commit';
  coercedObj['subject'] = coercedObj['subject'] || subject || 'No Subject';
  coercedObj['date'] = coercedObj['date'] || date || new Date().toISOString();
  coercedObj['author'] = coercedObj['author'] || authorName || 'Unknown Author';
  coercedObj['validationErrors'] = parseResult.error.issues;
  coercedObj['isCorrupted'] = true;
  
  const fallbackResult = entrySchema.safeParse(coercedObj);
  return fallbackResult.success ? fallbackResult.data : null;
}

function computeCommitSize(totalLines: number, trueFileCount: number): string | undefined {
  if (totalLines > 0) {
    if (totalLines < SIZE_XS_THRESHOLD) return 'XS';
    if (totalLines < SIZE_S_THRESHOLD) return 'S';
    if (totalLines < SIZE_M_THRESHOLD) return 'M';
    if (totalLines < SIZE_L_THRESHOLD) return 'L';
    return 'XL';
  } else if (trueFileCount > 0) {
    return 'XS';
  }
  return undefined;
}

function truncateBodyWithContext(body: string, maxBodyLen: number): string {
  if (!body || body.length <= maxBodyLen) return body;
  const truncated = truncateSafely(body, maxBodyLen, '');
  const lastNewline = Math.max(truncated.lastIndexOf('\n\n'), truncated.lastIndexOf('\n'));
  let newBody = lastNewline > 0 ? truncated.slice(0, lastNewline).trim() : truncated.trim();
  
  const codeMatches = newBody.match(/```/g);
  if (codeMatches && codeMatches.length % 2 !== 0) {
     newBody += '\n```';
  }
  const tildeMatches = newBody.match(/~~~/g);
  if (tildeMatches && tildeMatches.length % 2 !== 0) {
     newBody += '\n~~~';
  }
  return flattenString(newBody + '\n\n...[truncated to protect context]');
}

type NumstatCommitMap = Map<string, { insertions: number; deletions: number; path: string; isBinary?: boolean }>;

function aggregateCommitFileStats(
  b: RawCommitBatchItem,
  statsForCommit: NumstatCommitMap | undefined,
): {
  parsedFiles: z.infer<typeof fileStatusSchema>[];
  trueFileCount: number;
  commitInsertions: number;
  commitDeletions: number;
  nonNoiseInsertions: number;
  nonNoiseDeletions: number;
} {
  let commitInsertions = 0;
  let commitDeletions = 0;
  let nonNoiseInsertions = 0;
  let nonNoiseDeletions = 0;
  let uniqueStatsCount = 0;

  if (statsForCommit && statsForCommit.size > 0) {
    const uniqueStats = new Set(statsForCommit.values());
    uniqueStatsCount = uniqueStats.size;
    for (const stats of uniqueStats) {
      commitInsertions += stats.insertions;
      commitDeletions += stats.deletions;
      if (!isNoiseFile(stats.path)) {
        nonNoiseInsertions += stats.insertions;
        nonNoiseDeletions += stats.deletions;
      }
    }
  }

  const trueFileCount =
    b.trueFileCount !== undefined
      ? Math.max(b.trueFileCount, uniqueStatsCount)
      : Math.max(b.rawFiles.length, uniqueStatsCount);

  const parsedFiles: z.infer<typeof fileStatusSchema>[] = [];
  for (const line of b.rawFiles) {
    if (parsedFiles.length >= MAX_FILES_PER_COMMIT) break;
    const { status, file, oldFile, similarityScore } = line;
    const stats = statsForCommit?.get(file) ?? (oldFile ? statsForCommit?.get(oldFile) : undefined);
    const language = getLanguage(file);
    parsedFiles.push({
      status,
      file,
      ...(oldFile ? { oldFile } : {}),
      ...(similarityScore !== undefined ? { similarityScore } : {}),
      ...(stats && stats.insertions !== undefined ? { insertions: stats.insertions } : {}),
      ...(stats && stats.deletions !== undefined ? { deletions: stats.deletions } : {}),
      ...(stats?.isBinary ? { isBinary: true } : {}),
      ...(language ? { language } : {}),
    });
  }

  if (trueFileCount > MAX_FILES_PER_COMMIT) {
    parsedFiles.push({
      status: 'M',
      file: `...and ${trueFileCount - parsedFiles.length} more files omitted`,
    });
  }

  return { parsedFiles, trueFileCount, commitInsertions, commitDeletions, nonNoiseInsertions, nonNoiseDeletions };
}

function detectIsRebased(b: RawCommitBatchItem): boolean {
  if (b.committerEmail && b.authorEmail && b.committerEmail !== b.authorEmail && b.committerName !== 'GitHub') {
    return true;
  }
  if (b.committerDate && b.date && b.committerDate !== b.date) {
    const cTime = Date.parse(b.committerDate);
    const aTime = Date.parse(b.date);
    if (!Number.isNaN(cTime) && !Number.isNaN(aTime) && Math.abs(cTime - aTime) > MS_PER_DAY) {
      return true;
    }
  }
  return false;
}

function buildCommitEntryObject(
  b: RawCommitBatchItem,
  statsForCommit: NumstatCommitMap | undefined,
  patchData: { patch: string; truncated: boolean } | undefined,
  slackMap: Record<string, string>,
  maxBodyLen: number,
): Record<string, unknown> {
  const { parsedFiles, trueFileCount, commitInsertions, commitDeletions, nonNoiseInsertions, nonNoiseDeletions } =
    aggregateCommitFileStats(b, statsForCommit);
  const size = computeCommitSize(nonNoiseInsertions + nonNoiseDeletions, trueFileCount);
  const isRebased = detectIsRebased(b);
  const slackId =
    b.authorEmail && Object.hasOwn(slackMap, b.authorEmail)
      ? slackMap[b.authorEmail]
      : b.authorName && Object.hasOwn(slackMap, b.authorName)
        ? slackMap[b.authorName]
        : undefined;

  const entryObj: Record<string, unknown> = {
    commit: b.sha || 'unknown_commit',
    ...(b.parents.length > 0 ? { parents: b.parents } : {}),
    ...(b.refs.length > 0 ? { refs: b.refs } : {}),
    ...(b.tags.length > 0 ? { tags: b.tags } : {}),
    author: b.authorName || 'Unknown Author',
    ...(b.authorEmail ? { email: b.authorEmail } : {}),
    ...(slackId ? { slackId } : {}),
    ...(b.committerName && b.committerName !== b.authorName ? { committer: b.committerName } : {}),
    ...(b.committerEmail && b.committerEmail !== b.authorEmail ? { committerEmail: b.committerEmail } : {}),
    ...(b.committerDate && b.committerDate !== b.date ? { committerDate: b.committerDate } : {}),
    date: b.date || new Date().toISOString(),
    ...(b.type ? { type: b.type } : {}),
    ...(b.scope ? { scope: b.scope } : {}),
    ...(b.isBreaking ? { isBreaking: true } : {}),
    subject: b.subject || 'No Subject',
    ...(b.cleanSubject !== b.subject ? { cleanSubject: b.cleanSubject } : {}),
    ...(size ? { size } : {}),
    ...(parsedFiles.length > 0 ? { files: parsedFiles } : {}),
    ...(trueFileCount > 0 ? { fileCount: trueFileCount } : {}),
    ...(trueFileCount > MAX_FILES_PER_COMMIT ? { isFilesTruncated: true } : {}),
    totalInsertions: commitInsertions,
    totalDeletions: commitDeletions,
  };

  if (b.issuesMap.size > 0) {
    entryObj['associatedIssues'] = Array.from(b.issuesMap.entries()).map(([issue, action]) => ({ issue, action }));
  }
  if (patchData) {
    entryObj['patch'] = patchData.patch;
    if (patchData.truncated) entryObj['isPatchTruncated'] = true;
  }
  if (Object.keys(b.metadataObj).length > 0) entryObj['metadata'] = b.metadataObj;
  if (b.references.length > 0) entryObj['references'] = b.references;
  if (b.coAuthors.length > 0) entryObj['coAuthors'] = b.coAuthors;
  if (b.reviewers.length > 0) entryObj['reviewers'] = b.reviewers;
  if (b.trailersObj && Object.keys(b.trailersObj).length > 0) entryObj['trailersObj'] = b.trailersObj;
  if (b.isRevert) entryObj['isRevert'] = true;
  if (b.revertedCommit) entryObj['revertedCommit'] = b.revertedCommit;
  if (b.breakingChangeDescription) entryObj['breakingChangeDescription'] = b.breakingChangeDescription;
  if (isRebased) entryObj['isRebased'] = true;

  let body = b.body.replace(/(?:\r?\n){3,}/g, '\n\n');
  if (body.length > maxBodyLen) {
    body = truncateBodyWithContext(body, maxBodyLen);
    entryObj['isBodyTruncated'] = true;
  }
  if (body) entryObj['body'] = flattenString(body);
  return entryObj;
}

export async function processBatch(
  batch: RawCommitBatchItem[],
  args: CliArgs,
  formattingFlags: string[],
  cwd: string = process.cwd()
): Promise<CommitEntry[]> {
  if (batch.length === 0) return [];
  const shas = batch.map((b) => b.sha).join('\n') + '\n';

  const skipDiffs = Boolean(args.summary || args['no-body']);
  const wantPatch = Boolean(args['include-patch'] || args['diff-context'] !== undefined);
  const [numstatRes, patchRes] = await Promise.allSettled([
    skipDiffs ? Promise.resolve(new Map<string, NumstatCommitMap>()) : getNumstatMap(formattingFlags, shas, cwd),
    wantPatch && !skipDiffs
      ? getPatchMap(formattingFlags, args, shas, cwd)
      : Promise.resolve(new Map<string, { patch: string; truncated: boolean }>()),
  ]);

  let numstatMap = new Map<string, NumstatCommitMap>();
  if (numstatRes.status === 'fulfilled') {
    numstatMap = numstatRes.value;
  } else {
    const err = numstatRes.reason;
    console.warn('Warning: Failed to get numstat map (This may cause missing file stats for this batch):', err instanceof Error ? err.message : String(err));
  }

  let patchMap = new Map<string, { patch: string; truncated: boolean }>();
  if (patchRes.status === 'fulfilled') {
    patchMap = patchRes.value;
  } else {
    const err = patchRes.reason;
    console.warn('Warning: Failed to get patch map (This may cause missing patches for this batch):', err instanceof Error ? err.message : String(err));
  }

  const processed: CommitEntry[] = [];
  const parsedMaxBodyLen = args['max-body-length'];
  const maxBodyLen = parsedMaxBodyLen !== undefined && !Number.isNaN(parsedMaxBodyLen) && parsedMaxBodyLen >= 0 ? parsedMaxBodyLen : DEFAULT_MAX_BODY_LEN;
  const slackMap = getSlackMap(args, cwd);

  for (const b of batch) {
    const entryObj = buildCommitEntryObject(
      b,
      numstatMap.get(b.sha),
      wantPatch ? patchMap.get(b.sha) : undefined,
      slackMap,
      maxBodyLen,
    );
    const parsedEntry = parseWithFallbacks(entryObj, b.sha, b.subject, b.date, b.authorName);
    if (parsedEntry) processed.push(parsedEntry);
  }
  return processed;
}
