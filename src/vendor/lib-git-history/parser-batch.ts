// @ts-nocheck
import type { CommitEntry, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { isNoiseFile, getSlackMap, getLanguage, truncateSafely, flattenString, hasOwnKeys } from './parser-utils.js';
import {
  DEFAULT_MAX_BODY_LEN,
  MAX_FILES_PER_COMMIT,
  MS_PER_DAY,
  NUMSTAT_MAPS_WITH_ALIASES,
  wantsPatchOutput,
  type NumstatCommitMap,
} from './constants.js';
import type { RawCommitBatchItem } from './parser-record.js';

const SIZE_XS_THRESHOLD = 10;
const SIZE_S_THRESHOLD = 50;
const SIZE_M_THRESHOLD = 250;
const SIZE_L_THRESHOLD = 1000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MULTI_NEWLINE_RE = /(?:\r?\n){3,}/g;
const CODE_FENCE_BACKTICK_RE = /```/g;
const CODE_FENCE_TILDE_RE = /~~~/g;

const COMMIT_SIZE_SET = new Set(['XS', 'S', 'M', 'L', 'XL']);
const REQUIRED_STRING_KEYS = ['commit', 'author', 'date', 'subject'] as const;
const OPTIONAL_STRING_KEYS = ['email', 'committer', 'committerEmail', 'committerDate', 'type', 'scope', 'breakingChangeDescription', 'revertedCommit', 'cleanSubject', 'body', 'patch', 'slackId'] as const;
const OPTIONAL_BOOL_KEYS = ['isBreaking', 'isRevert', 'isRebased', 'isBodyTruncated', 'isFilesTruncated', 'isPatchTruncated', 'isCorrupted'] as const;
const OPTIONAL_INT_KEYS = ['fileCount', 'totalInsertions', 'totalDeletions'] as const;
const OPTIONAL_STR_ARRAY_KEYS = ['parents', 'refs', 'tags', 'references', 'coAuthors', 'reviewers'] as const;
const FILE_INT_KEYS = ['similarityScore', 'insertions', 'deletions'] as const;
const META_STR_ARRAY_KEYS = ['category', 'entry'] as const;
const META_STR_KEYS = ['significance', 'validation'] as const;
const META_NUM_OR_STR_KEYS = ['impact', 'trust', 'confidence'] as const;

interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

const isPlainObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumOrStr = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string';
const isValidatedEntry = (obj: Record<string, unknown>, issues: ValidationIssue[] | null): obj is CommitEntry => issues === null;

function isStringArray(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return false;
  return true;
}

function pushIssue(list: ValidationIssue[] | null, path: (string | number)[], message: string): ValidationIssue[] {
  if (list === null) return [{ path, message }];
  list.push({ path, message });
  return list;
}

function validateFileStatusArray(files: unknown, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  if (!Array.isArray(files)) return pushIssue(out, ['files'], 'Expected array');
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isPlainObj(f)) { out = pushIssue(out, ['files', i], 'Expected object'); continue; }
    if (typeof f['status'] !== 'string') out = pushIssue(out, ['files', i, 'status'], 'Expected string');
    if (typeof f['file'] !== 'string') out = pushIssue(out, ['files', i, 'file'], 'Expected string');
    if (f['oldFile'] !== undefined && typeof f['oldFile'] !== 'string') out = pushIssue(out, ['files', i, 'oldFile'], 'Expected string');
    if (f['language'] !== undefined && typeof f['language'] !== 'string') out = pushIssue(out, ['files', i, 'language'], 'Expected string');
    if (f['isBinary'] !== undefined && typeof f['isBinary'] !== 'boolean') out = pushIssue(out, ['files', i, 'isBinary'], 'Expected boolean');
    for (const k of FILE_INT_KEYS) {
      const val = f[k];
      if (val !== undefined && (typeof val !== 'number' || !Number.isSafeInteger(val))) out = pushIssue(out, ['files', i, k], 'Expected safe integer');
    }
  }
  return out;
}

function validateMetadataObj(meta: unknown, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  if (!isPlainObj(meta)) return pushIssue(out, ['metadata'], 'Expected object');
  for (const k of META_STR_ARRAY_KEYS) if (meta[k] !== undefined && !isStringArray(meta[k])) out = pushIssue(out, ['metadata', k], 'Expected string array');
  for (const k of META_STR_KEYS) if (meta[k] !== undefined && typeof meta[k] !== 'string') out = pushIssue(out, ['metadata', k], 'Expected string');
  for (const k of META_NUM_OR_STR_KEYS) if (meta[k] !== undefined && !isFiniteNumOrStr(meta[k])) out = pushIssue(out, ['metadata', k], 'Expected finite number or string');
  const ct = meta['customTrailers'];
  if (ct === undefined) return out;
  if (!isPlainObj(ct)) return pushIssue(out, ['metadata', 'customTrailers'], 'Expected object');
  for (const k in ct) if (Object.hasOwn(ct, k) && !isStringArray(ct[k])) out = pushIssue(out, ['metadata', 'customTrailers', k], 'Expected string array');
  return out;
}

function validateExtraFields(obj: Record<string, unknown>, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  const size = obj['size'];
  if (size !== undefined && (typeof size !== 'string' || !COMMIT_SIZE_SET.has(size))) out = pushIssue(out, ['size'], 'Expected commit size');
  if (obj['files'] !== undefined) out = validateFileStatusArray(obj['files'], out);
  if (obj['metadata'] !== undefined) out = validateMetadataObj(obj['metadata'], out);
  const trailers = obj['trailersObj'];
  if (trailers !== undefined) {
    if (!isPlainObj(trailers)) out = pushIssue(out, ['trailersObj'], 'Expected object');
    else for (const k in trailers) if (Object.hasOwn(trailers, k) && typeof trailers[k] !== 'string') out = pushIssue(out, ['trailersObj', k], 'Expected string');
  }
  const assoc = obj['associatedIssues'];
  if (assoc !== undefined) {
    if (!Array.isArray(assoc)) out = pushIssue(out, ['associatedIssues'], 'Expected array');
    else for (let i = 0; i < assoc.length; i++) {
      const item = assoc[i];
      if (!isPlainObj(item) || typeof item['issue'] !== 'string' || (item['action'] !== null && typeof item['action'] !== 'string')) {
        out = pushIssue(out, ['associatedIssues', i], 'Expected issue object');
      }
    }
  }
  if (obj['validationErrors'] !== undefined && !Array.isArray(obj['validationErrors'])) out = pushIssue(out, ['validationErrors'], 'Expected array');
  return out;
}

function collectCommitEntryIssues(obj: Record<string, unknown>): ValidationIssue[] | null {
  let out: ValidationIssue[] | null = null;
  for (const k of REQUIRED_STRING_KEYS) if (typeof obj[k] !== 'string') out = pushIssue(out, [k], 'Expected string');
  for (const k of OPTIONAL_STRING_KEYS) if (obj[k] !== undefined && typeof obj[k] !== 'string') out = pushIssue(out, [k], 'Expected string');
  for (const k of OPTIONAL_BOOL_KEYS) if (obj[k] !== undefined && typeof obj[k] !== 'boolean') out = pushIssue(out, [k], 'Expected boolean');
  for (const k of OPTIONAL_INT_KEYS) {
    const val = obj[k];
    if (val !== undefined && (typeof val !== 'number' || !Number.isSafeInteger(val))) out = pushIssue(out, [k], 'Expected safe integer');
  }
  for (const k of OPTIONAL_STR_ARRAY_KEYS) if (obj[k] !== undefined && !isStringArray(obj[k])) out = pushIssue(out, [k], 'Expected string array');
  return validateExtraFields(obj, out);
}

function stripFailedIssue(coercedObj: Record<string, unknown>, issue: ValidationIssue): void {
  const topKey = issue.path.length > 0 ? String(issue.path[0]) : '';
  if (!topKey || FORBIDDEN_KEYS.has(topKey)) return;
  if (topKey === 'metadata' && issue.path.length >= 2) {
    const subKey = String(issue.path[1]);
    if (FORBIDDEN_KEYS.has(subKey)) return;
    const rawMeta = coercedObj['metadata'];
    const meta: Record<string, unknown> = isPlainObj(rawMeta) ? { ...rawMeta } : {};
    delete meta[subKey];
    coercedObj['metadata'] = meta;
  } else {
    delete coercedObj[topKey];
  }
}

function parseWithFallbacks(entryObj: Record<string, unknown>, sha: string, subject: string, date: string, authorName: string): CommitEntry | null {
  const issues = collectCommitEntryIssues(entryObj);
  if (issues === null) return isValidatedEntry(entryObj, issues) ? entryObj : null;

  const coercedObj: Record<string, unknown> = { ...entryObj };
  for (const issue of issues) stripFailedIssue(coercedObj, issue);
  if (isValidatedEntry(coercedObj, collectCommitEntryIssues(coercedObj))) {
    coercedObj.validationErrors = issues;
    coercedObj.isCorrupted = true;
    return coercedObj;
  }

  coercedObj['commit'] = coercedObj['commit'] || sha || 'unknown_commit';
  coercedObj['subject'] = coercedObj['subject'] || subject || 'No Subject';
  coercedObj['date'] = coercedObj['date'] || date || new Date().toISOString();
  coercedObj['author'] = coercedObj['author'] || authorName || 'Unknown Author';
  coercedObj['validationErrors'] = issues;
  coercedObj['isCorrupted'] = true;
  return isValidatedEntry(coercedObj, collectCommitEntryIssues(coercedObj)) ? coercedObj : null;
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
  parsedFiles: FileStatus[];
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

  const parsedFiles: FileStatus[] = [];
  if (!omitFiles) {
    const rawLimit = Math.min(b.rawFiles.length, MAX_FILES_PER_COMMIT);
    for (let i = 0; i < rawLimit; i++) {
      const line = b.rawFiles[i];
      const { status, file, oldFile, similarityScore } = line;
      const stats = statsForCommit ? (statsForCommit.get(file) ?? (oldFile ? statsForCommit.get(oldFile) : undefined)) : undefined;
      const language = getLanguage(file);
      const fileEntry: FileStatus = { status, file };
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
    for (const [issue, action] of b.issuesMap) associatedIssues.push({ issue, action });
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
    let body = b.body;
    let needsFlatten = false;
    if (body.includes('\n\n\n') || body.includes('\r')) { body = body.replace(MULTI_NEWLINE_RE, '\n\n'); needsFlatten = body !== b.body; }
    if (body.length > maxBodyLen) { body = truncateBodyWithContext(body, maxBodyLen); entryObj['isBodyTruncated'] = true; needsFlatten = true; }
    if (body) entryObj['body'] = needsFlatten ? flattenString(body) : body;
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
  omitBodyOverride?: boolean,
): Promise<CommitEntry[]> {
  if (batch.length === 0) return [];

  const skipDiffs = Boolean(args.summary || args['no-body']);
  const isBuiltInChangelogNoCache = !args.cache && (args.format === 'markdown' || args.format === 'slack');
  const wantPatch = wantsPatchOutput(args) && !isBuiltInChangelogNoCache;
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
      needNumstatSpawn ? import('./git-numstat.js').then((m) => m.getNumstatMap(formattingFlags, shas, cwd)) : Promise.resolve(undefined),
      needPatchSpawn ? import('./git-patch.js').then((m) => m.getPatchMap(formattingFlags, args, shas, cwd)) : Promise.resolve(patchMap),
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
  const omitFiles = Boolean(args.summary || args['no-body'] || isBuiltInChangelogNoCache);
  const omitBody = Boolean(omitFiles || (args.stats && !args.cache) || omitBodyOverride);

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
