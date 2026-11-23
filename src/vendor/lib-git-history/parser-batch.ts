// @ts-nocheck
import type { z } from 'zod';
import { entrySchema, fileStatusSchema, type CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { getNumstatMap, NUMSTAT_MAPS_WITH_ALIASES, type NumstatCommitMap } from './git-numstat.js';
import { getPatchMap, wantsPatchOutput } from './git-patch.js';
import { isNoiseFile, getSlackMap, getLanguage, truncateSafely, flattenString, hasOwnKeys } from './parser-utils.js';
import { DEFAULT_MAX_BODY_LEN, MAX_FILES_PER_COMMIT, MS_PER_DAY } from './constants.js';
import type { RawCommitBatchItem } from './parser-record.js';

const SIZE_XS_THRESHOLD = 10;
const SIZE_S_THRESHOLD = 50;
const SIZE_M_THRESHOLD = 250;
const SIZE_L_THRESHOLD = 1000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MULTI_NEWLINE_RE = /(?:\r?\n){3,}/g;
const CODE_FENCE_BACKTICK_RE = /```/g;
const CODE_FENCE_TILDE_RE = /~~~/g;

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
  const lastNewline = truncated.lastIndexOf('\n');
  let newBody = lastNewline > 0 ? truncated.slice(0, lastNewline).trim() : truncated.trim();

  if (newBody.includes('```')) {
    const codeMatches = newBody.match(CODE_FENCE_BACKTICK_RE);
    if (codeMatches && codeMatches.length % 2 !== 0) newBody += '\n```';
  }
  if (newBody.includes('~~~')) {
    const tildeMatches = newBody.match(CODE_FENCE_TILDE_RE);
    if (tildeMatches && tildeMatches.length % 2 !== 0) newBody += '\n~~~';
  }
  return newBody + '\n\n...[truncated to protect context]';
}

function aggregateCommitFileStats(
  b: RawCommitBatchItem,
  statsForCommit: NumstatCommitMap | undefined,
  omitFiles: boolean,
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
    const statsIterable = NUMSTAT_MAPS_WITH_ALIASES.has(statsForCommit)
      ? new Set(statsForCommit.values())
      : statsForCommit.values();
    for (const stats of statsIterable) {
      uniqueStatsCount++;
      commitInsertions += stats.insertions;
      commitDeletions += stats.deletions;
      if (
        nonNoiseInsertions + nonNoiseDeletions < SIZE_L_THRESHOLD &&
        (stats.insertions > 0 || stats.deletions > 0) &&
        !isNoiseFile(stats.path)
      ) {
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
  if (!omitFiles) {
    const rawLimit = Math.min(b.rawFiles.length, MAX_FILES_PER_COMMIT);
    for (let i = 0; i < rawLimit; i++) {
      const line = b.rawFiles[i];
      const { status, file, oldFile, similarityScore } = line;
      const stats = statsForCommit ? (statsForCommit.get(file) ?? (oldFile ? statsForCommit.get(oldFile) : undefined)) : undefined;
      const language = getLanguage(file);
      const fileEntry: z.infer<typeof fileStatusSchema> = { status, file };
      if (oldFile) fileEntry.oldFile = oldFile;
      if (similarityScore !== undefined) fileEntry.similarityScore = similarityScore;
      if (stats) {
        if (stats.insertions !== undefined) fileEntry.insertions = stats.insertions;
        if (stats.deletions !== undefined) fileEntry.deletions = stats.deletions;
        if (stats.isBinary) fileEntry.isBinary = true;
      }
      if (language) fileEntry.language = language;
      parsedFiles.push(fileEntry);
    }

    if (trueFileCount > MAX_FILES_PER_COMMIT) {
      parsedFiles.push({
        status: 'M',
        file: `...and ${trueFileCount - parsedFiles.length} more files omitted`,
      });
    }
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
  omitFiles: boolean,
  omitBody: boolean,
): Record<string, unknown> {
  const { parsedFiles, trueFileCount, commitInsertions, commitDeletions, nonNoiseInsertions, nonNoiseDeletions } =
    aggregateCommitFileStats(b, statsForCommit, omitFiles);
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
    author: b.authorName || 'Unknown Author',
    date: b.date || new Date().toISOString(),
    subject: b.subject || 'No Subject',
    totalInsertions: commitInsertions,
    totalDeletions: commitDeletions,
  };

  if (b.parents.length > 0) entryObj['parents'] = b.parents;
  if (b.refs.length > 0) entryObj['refs'] = b.refs;
  if (b.tags.length > 0) entryObj['tags'] = b.tags;
  if (b.authorEmail) entryObj['email'] = b.authorEmail;
  if (slackId) entryObj['slackId'] = slackId;
  if (b.committerName && b.committerName !== b.authorName) entryObj['committer'] = b.committerName;
  if (b.committerEmail && b.committerEmail !== b.authorEmail) entryObj['committerEmail'] = b.committerEmail;
  if (b.committerDate && b.committerDate !== b.date) entryObj['committerDate'] = b.committerDate;
  if (b.type) entryObj['type'] = b.type;
  if (b.scope) entryObj['scope'] = b.scope;
  if (b.isBreaking) entryObj['isBreaking'] = true;
  if (b.cleanSubject !== b.subject) entryObj['cleanSubject'] = b.cleanSubject;
  if (size) entryObj['size'] = size;
  if (parsedFiles.length > 0) entryObj['files'] = parsedFiles;
  if (trueFileCount > 0) entryObj['fileCount'] = trueFileCount;
  if (trueFileCount > MAX_FILES_PER_COMMIT) entryObj['isFilesTruncated'] = true;

  if (b.issuesMap.size > 0) {
    const associatedIssues: Array<{ issue: string; action: string | null }> = [];
    for (const [issue, action] of b.issuesMap) associatedIssues.push({ issue: flattenString(issue), action });
    entryObj['associatedIssues'] = associatedIssues;
  }
  if (patchData) {
    entryObj['patch'] = patchData.patch;
    if (patchData.truncated) entryObj['isPatchTruncated'] = true;
  }
  if (hasOwnKeys(b.metadataObj)) entryObj['metadata'] = b.metadataObj;
  if (b.references.length > 0) entryObj['references'] = b.references;
  if (b.coAuthors.length > 0) entryObj['coAuthors'] = b.coAuthors;
  if (b.reviewers.length > 0) entryObj['reviewers'] = b.reviewers;
  if (b.trailersObj && hasOwnKeys(b.trailersObj)) entryObj['trailersObj'] = b.trailersObj;
  if (b.isRevert) entryObj['isRevert'] = true;
  if (b.revertedCommit) entryObj['revertedCommit'] = b.revertedCommit;
  if (b.breakingChangeDescription) entryObj['breakingChangeDescription'] = b.breakingChangeDescription;
  if (isRebased) entryObj['isRebased'] = true;

  if (!omitBody && b.body.length > 0) {
    let body = b.body.includes('\n\n\n') || b.body.includes('\r') ? b.body.replace(MULTI_NEWLINE_RE, '\n\n') : b.body;
    if (body.length > maxBodyLen) {
      body = truncateBodyWithContext(body, maxBodyLen);
      entryObj['isBodyTruncated'] = true;
    }
    if (body) entryObj['body'] = flattenString(body);
  }
  return entryObj;
}

export async function processBatch(
  batch: RawCommitBatchItem[],
  args: CliArgs,
  formattingFlags: string[],
  cwd: string = process.cwd(),
  preFetchedPatchMap?: Map<string, { patch: string; truncated: boolean }> | null,
  patchTargetShas?: ReadonlySet<string>,
): Promise<CommitEntry[]> {
  if (batch.length === 0) return [];

  const skipDiffs = Boolean(args.summary || args['no-body']);
  const wantPatch = wantsPatchOutput(args);
  const allHaveInlineNumstats = !skipDiffs && batch.every((b) => b.inlineNumstats !== undefined);
  const needNumstatSpawn = !skipDiffs && !allHaveInlineNumstats;
  // [INTENT]: `preFetchedPatchMap === null` signals the caller already attempted `getPatchMap` and it failed (avoid duplicate retry).
  const needPatchSpawn = wantPatch && preFetchedPatchMap === undefined;
  const shas = needNumstatSpawn || needPatchSpawn ? batch.map((b) => b.sha).join('\n') + '\n' : undefined;

  let numstatMap: Map<string, NumstatCommitMap> | undefined;
  let patchMap: Map<string, { patch: string; truncated: boolean }> | undefined =
    preFetchedPatchMap === null ? undefined : preFetchedPatchMap;

  if (needNumstatSpawn || needPatchSpawn) {
    const [numstatRes, patchRes] = await Promise.allSettled([
      needNumstatSpawn ? getNumstatMap(formattingFlags, shas, cwd) : Promise.resolve(undefined),
      needPatchSpawn ? getPatchMap(formattingFlags, args, shas, cwd) : Promise.resolve(patchMap),
    ]);

    if (numstatRes.status === 'fulfilled') {
      numstatMap = numstatRes.value;
    } else {
      const err = numstatRes.reason;
      console.warn('Warning: Failed to get numstat map (This may cause missing file stats for this batch):', err instanceof Error ? err.message : String(err));
    }

    if (patchRes.status === 'fulfilled') {
      patchMap = patchRes.value;
    } else {
      const err = patchRes.reason;
      console.warn('Warning: Failed to get patch map (This may cause missing patches for this batch):', err instanceof Error ? err.message : String(err));
    }
  }

  const processed: CommitEntry[] = [];
  const parsedMaxBodyLen = args['max-body-length'];
  const maxBodyLen = parsedMaxBodyLen !== undefined && !Number.isNaN(parsedMaxBodyLen) && parsedMaxBodyLen >= 0 ? parsedMaxBodyLen : DEFAULT_MAX_BODY_LEN;
  const slackMap = getSlackMap(args, cwd);
  const omitFiles = Boolean(args.summary || args['no-body']);
  const omitBody = Boolean(args.summary || args['no-body'] || (args.stats && !args.cache));

  for (const b of batch) {
    // [INTENT]: Memoize empty-string patch on successful patch fetches for targeted SHAs so excluded-only/empty commits do not permanently miss SQLite cache.
    const patchData =
      wantPatch && patchMap !== undefined && (patchTargetShas === undefined || patchTargetShas.has(b.sha))
        ? (patchMap.get(b.sha) ?? { patch: '', truncated: false })
        : undefined;
    const entryObj = buildCommitEntryObject(
      b,
      b.inlineNumstats ?? numstatMap?.get(b.sha),
      patchData,
      slackMap,
      maxBodyLen,
      omitFiles,
      omitBody,
    );
    const parsedEntry = parseWithFallbacks(entryObj, b.sha, b.subject, b.date, b.authorName);
    if (parsedEntry) processed.push(parsedEntry);
  }
  return processed;
}
