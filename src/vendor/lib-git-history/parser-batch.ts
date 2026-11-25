// @ts-nocheck
import type { CommitEntry, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { isNoiseFile, getSlackMap, getLanguage, truncateSafely, flattenString, hasOwnKeys } from './parser-utils.js';
import { sanitizeLogText } from './security-utils.js';
import {
  DEFAULT_MAX_BODY_LEN, MAX_ARRAY_LENGTH, MAX_FILES_PER_COMMIT, MAX_PARSED_FILES,
  MS_PER_DAY, NUMSTAT_MAPS_WITH_ALIASES, wantsPatchOutput, type NumstatCommitMap,
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
const ALLOWED_META_KEYS = new Set<string>([...META_STR_ARRAY_KEYS, ...META_STR_KEYS, ...META_NUM_OR_STR_KEYS, 'customTrailers']);

interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

const MAX_RECORD_KEYS = 256;
const MAX_RECORD_KEY_LEN = 128;

const isPlainObj = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype;
};
const isFiniteNumOrStr = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string';
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isValidatedEntry = (_obj: Record<string, unknown>, issues: ValidationIssue[] | null): _obj is CommitEntry => issues === null;

function isStringArray(v: unknown, maxLen = MAX_ARRAY_LENGTH): boolean {
  if (!Array.isArray(v) || v.length > maxLen) return false;
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return false;
  return true;
}

function pushIssue(list: ValidationIssue[] | null, path: (string | number)[], message: string): ValidationIssue[] {
  if (list === null) return [{ path, message }];
  list.push({ path, message });
  return list;
}

function validateBoundedRecord(
  rec: unknown, pathPrefix: string[], checkVal: (v: unknown) => boolean, expectedMsg: string, list: ValidationIssue[] | null,
): ValidationIssue[] | null {
  let out = list;
  if (!isPlainObj(rec)) return pushIssue(out, pathPrefix, 'Expected object');
  let count = 0;
  for (const k of Object.getOwnPropertyNames(rec)) {
    if (FORBIDDEN_KEYS.has(k) || k.length > MAX_RECORD_KEY_LEN) { out = pushIssue(out, [...pathPrefix, k], 'Invalid record key'); continue; }
    if (++count > MAX_RECORD_KEYS) { out = pushIssue(out, pathPrefix, 'Record exceeds key limit'); break; }
    if (!checkVal(rec[k])) out = pushIssue(out, [...pathPrefix, k], expectedMsg);
  }
  return out;
}

function validateFileStatusArray(files: unknown, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  if (!isUnknownArray(files)) return pushIssue(out, ['files'], 'Expected array');
  if (files.length > MAX_PARSED_FILES) return pushIssue(out, ['files'], 'Files array exceeds limit');
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isPlainObj(f)) { out = pushIssue(out, ['files', i], 'Expected object'); continue; }
    if (!isNonEmptyString(f['status'])) out = pushIssue(out, ['files', i, 'status'], 'Expected non-empty string');
    if (!isNonEmptyString(f['file'])) out = pushIssue(out, ['files', i, 'file'], 'Expected non-empty string');
    if (f['oldFile'] !== undefined && typeof f['oldFile'] !== 'string') out = pushIssue(out, ['files', i, 'oldFile'], 'Expected string');
    if (f['language'] !== undefined && typeof f['language'] !== 'string') out = pushIssue(out, ['files', i, 'language'], 'Expected string');
    if (f['isBinary'] !== undefined && typeof f['isBinary'] !== 'boolean') out = pushIssue(out, ['files', i, 'isBinary'], 'Expected boolean');
    for (const k of FILE_INT_KEYS) {
      const val = f[k];
      if (val !== undefined && (!isNonNegInt(val) || (k === 'similarityScore' && val > 100))) {
        out = pushIssue(out, ['files', i, k], 'Expected bounded non-negative safe integer');
      }
    }
  }
  return out;
}

function validateMetadataObj(meta: unknown, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  if (!isPlainObj(meta)) return pushIssue(out, ['metadata'], 'Expected object');
  let keyCount = 0;
  for (const k of Object.getOwnPropertyNames(meta)) {
    if (FORBIDDEN_KEYS.has(k) || !ALLOWED_META_KEYS.has(k)) out = pushIssue(out, ['metadata', k], 'Unexpected metadata key');
    else if (++keyCount > MAX_RECORD_KEYS) { out = pushIssue(out, ['metadata'], 'Metadata exceeds key limit'); break; }
  }
  for (const k of META_STR_ARRAY_KEYS) if (meta[k] !== undefined && !isStringArray(meta[k])) out = pushIssue(out, ['metadata', k], 'Expected string array');
  for (const k of META_STR_KEYS) if (meta[k] !== undefined && typeof meta[k] !== 'string') out = pushIssue(out, ['metadata', k], 'Expected string');
  for (const k of META_NUM_OR_STR_KEYS) if (meta[k] !== undefined && !isFiniteNumOrStr(meta[k])) out = pushIssue(out, ['metadata', k], 'Expected finite number or string');
  if (meta['customTrailers'] !== undefined) {
    out = validateBoundedRecord(meta['customTrailers'], ['metadata', 'customTrailers'], (v) => isStringArray(v), 'Expected bounded string array', out);
  }
  return out;
}

function validateExtraFields(obj: Record<string, unknown>, list: ValidationIssue[] | null): ValidationIssue[] | null {
  let out = list;
  const size = obj['size'];
  if (size !== undefined && (typeof size !== 'string' || !COMMIT_SIZE_SET.has(size))) out = pushIssue(out, ['size'], 'Expected commit size');
  if (obj['files'] !== undefined) out = validateFileStatusArray(obj['files'], out);
  if (obj['metadata'] !== undefined) out = validateMetadataObj(obj['metadata'], out);
  if (obj['trailersObj'] !== undefined) out = validateBoundedRecord(obj['trailersObj'], ['trailersObj'], (v) => typeof v === 'string', 'Expected string', out);
  const assoc = obj['associatedIssues'];
  if (assoc !== undefined) {
    if (!isUnknownArray(assoc) || assoc.length > MAX_ARRAY_LENGTH) out = pushIssue(out, ['associatedIssues'], 'Expected bounded array');
    else for (let i = 0; i < assoc.length; i++) {
      const item = assoc[i];
      if (!isPlainObj(item) || !isNonEmptyString(item['issue']) || (item['action'] !== null && typeof item['action'] !== 'string')) {
        out = pushIssue(out, ['associatedIssues', i], 'Expected issue object');
      }
    }
  }
  if (obj['validationErrors'] !== undefined && (!Array.isArray(obj['validationErrors']) || obj['validationErrors'].length > MAX_ARRAY_LENGTH)) {
    out = pushIssue(out, ['validationErrors'], 'Expected bounded array');
  }
  return out;
}

function collectCommitEntryIssues(obj: Record<string, unknown>): ValidationIssue[] | null {
  let out: ValidationIssue[] | null = null;
  for (const k of REQUIRED_STRING_KEYS) if (!isNonEmptyString(obj[k])) out = pushIssue(out, [k], 'Expected non-empty string');
  for (const k of OPTIONAL_STRING_KEYS) if (obj[k] !== undefined && typeof obj[k] !== 'string') out = pushIssue(out, [k], 'Expected string');
  for (const k of OPTIONAL_BOOL_KEYS) if (obj[k] !== undefined && typeof obj[k] !== 'boolean') out = pushIssue(out, [k], 'Expected boolean');
  for (const k of OPTIONAL_INT_KEYS) {
    if (obj[k] !== undefined && !isNonNegInt(obj[k])) out = pushIssue(out, [k], 'Expected non-negative safe integer');
  }
  for (const k of OPTIONAL_STR_ARRAY_KEYS) if (obj[k] !== undefined && !isStringArray(obj[k])) out = pushIssue(out, [k], 'Expected bounded string array');
  return validateExtraFields(obj, out);
}

function stripFailedIssue(coercedObj: Record<string, unknown>, issue: ValidationIssue): void {
  const topKey = issue.path.length > 0 ? String(issue.path[0]) : '';
  if (!topKey || FORBIDDEN_KEYS.has(topKey)) return;
  if (topKey === 'metadata' && issue.path.length >= 2) {
    const subKey = String(issue.path[1]);
    const rawMeta = coercedObj['metadata'];
    if (!isPlainObj(rawMeta)) { delete coercedObj['metadata']; return; }
    const meta: Record<string, unknown> = {};
    for (const k of Object.keys(rawMeta)) {
      if (!FORBIDDEN_KEYS.has(k) && ALLOWED_META_KEYS.has(k) && k !== subKey) meta[k] = rawMeta[k];
    }
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
  const boundedIssues = issues.length > MAX_ARRAY_LENGTH ? issues.slice(0, MAX_ARRAY_LENGTH) : issues;
  if (isValidatedEntry(coercedObj, collectCommitEntryIssues(coercedObj))) {
    coercedObj.validationErrors = boundedIssues;
    coercedObj.isCorrupted = true;
    return coercedObj;
  }

  coercedObj['commit'] = (typeof coercedObj['commit'] === 'string' && coercedObj['commit'].length > 0 ? coercedObj['commit'] : '') || sha || 'unknown_commit';
  coercedObj['subject'] = (typeof coercedObj['subject'] === 'string' && coercedObj['subject'].length > 0 ? coercedObj['subject'] : '') || subject || 'No Subject';
  coercedObj['date'] = (typeof coercedObj['date'] === 'string' && coercedObj['date'].length > 0 ? coercedObj['date'] : '') || date || new Date().toISOString();
  coercedObj['author'] = (typeof coercedObj['author'] === 'string' && coercedObj['author'].length > 0 ? coercedObj['author'] : '') || authorName || 'Unknown Author';
  coercedObj['validationErrors'] = boundedIssues;
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
      if (nonNoiseInsertions + nonNoiseDeletions < SIZE_L_THRESHOLD && (stats.insertions > 0 || stats.deletions > 0) && !isNoiseFile(stats.path)) {
        nonNoiseInsertions += stats.insertions;
        nonNoiseDeletions += stats.deletions;
      }
    }
  }

  const trueFileCount = b.trueFileCount !== undefined ? Math.max(b.trueFileCount, uniqueStatsCount) : Math.max(b.rawFiles.length, uniqueStatsCount);

  const parsedFiles: FileStatus[] = [];
  if (!omitFiles) {
    const rawLimit = Math.min(b.rawFiles.length, MAX_FILES_PER_COMMIT);
    for (let i = 0; i < rawLimit; i++) {
      const line = b.rawFiles[i];
      if (line === undefined) continue;
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
      parsedFiles.push({ status: 'M', file: `...and ${trueFileCount - parsedFiles.length} more files omitted` });
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
      const err: unknown = numstatRes.reason;
      console.warn('Warning: Failed to get numstat map (This may cause missing file stats for this batch):', sanitizeLogText(err instanceof Error ? err.message : String(err)));
    }

    if (patchRes.status === 'fulfilled') {
      patchMap = patchRes.value;
    } else {
      const err: unknown = patchRes.reason;
      console.warn('Warning: Failed to get patch map (This may cause missing patches for this batch):', sanitizeLogText(err instanceof Error ? err.message : String(err)));
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
