// @ts-nocheck
import type { CliArgs } from './cli.js';
import { extractIssuesLazy, expandIssueTrackerUrl, hasOwnKeys } from './parser-utils.js';
import { CHANGELOG_TYPES, getParsedCliFilters, matchesTrailerFilters } from './parser-metadata.js';
import { parseTrailersBlock } from './parser-trailers.js';
import { sanitizeLogText } from './security-utils.js';
import {
  FIELD_SEPARATOR, MAX_ARRAY_LENGTH, MAX_BODY_LENGTH, MAX_SUBJECT_LENGTH, MAX_ISSUE_TEXT_LENGTH, EXPECTED_RECORD_PARTS,
  MAX_STATUS_ITERATIONS, MAX_EMPTY_STATUS_COUNT, MAX_PARSED_FILES, RECORD_START_FIELDS, RECORD_END_FIELDS,
  REGEX_FILE_STATUS, REGEX_CONVENTIONAL_COMMIT, REGEX_BREAKING_CHANGE, REGEX_REVERT_COMMIT, flattenString, truncateSafely, parseNumstatLineIntoMap, type NumstatCommitMap,
} from './constants.js';

const REGEX_TRAILING_DIGITS = /(\d{1,3})$/;
const REGEX_DIGITS_GLOBAL = /\d+/g;
const REGEX_BREAKING_FALLBACK = /^BREAKING[\s-]CHANGES?(?::|$)/im;
const REGEX_REVERT_SUBJECT = /^revert:? /i;
const REGEX_LEADING_EMOJI = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u;
const REGEX_LEADING_SHORTCODE = /^:\w+:\s*/;
const REGEX_LEADING_CR_LF = /^[\r\n]+/;
const REGEX_LEADING_CR = /^\r+/;
const REGEX_CR_LF = /\r\n/g;
const REGEX_CR_OPT_LF = /\r\n?/g;
const REGEX_CR = /\r/g;
const REGEX_WHITESPACE_SPLIT = /\s+/;
const REGEX_ISSUE_HINT = /[#-]\d|:\/\//;

const EMPTY_STRING_ARRAY: string[] = []; Object.freeze(EMPTY_STRING_ARRAY);
const EMPTY_REFS_TAGS: { refs: string[]; tags: string[] } = Object.freeze({ refs: EMPTY_STRING_ARRAY, tags: EMPTY_STRING_ARRAY });
const immutableErr = (): never => { throw new TypeError('Cannot mutate shared EMPTY_ISSUES_MAP'); };
const EMPTY_ISSUES_MAP = Object.freeze(Object.assign(new Map<string, string | null>(), { set: immutableErr, delete: immutableErr, clear: immutableErr }));
const hasIssueTokenHint = (s: string): boolean =>
  s.length > 0 && REGEX_ISSUE_HINT.test(s.length > MAX_ISSUE_TEXT_LENGTH ? s.slice(0, MAX_ISSUE_TEXT_LENGTH) : s);

function parseRefsAndTags(refsRaw: string, collectRefs = true): { refs: string[]; tags: string[] } {
  if (!refsRaw) return EMPTY_REFS_TAGS;
  const refs: string[] = collectRefs ? [] : EMPTY_STRING_ARRAY;
  const tags: string[] = [];
  let pos = 0;
  while (pos <= refsRaw.length) {
    if (tags.length >= MAX_ARRAY_LENGTH && (!collectRefs || refs.length >= MAX_ARRAY_LENGTH)) break;
    const commaIdx = refsRaw.indexOf(', ', pos);
    const rawSeg = commaIdx === -1 ? refsRaw.slice(pos) : refsRaw.slice(pos, commaIdx);
    let seg = rawSeg.trim();
    if (seg.startsWith('HEAD -> ')) seg = seg.slice(8);
    if (seg) {
      if (collectRefs && refs.length < MAX_ARRAY_LENGTH) refs.push(flattenString(seg));
      if (seg.startsWith('tag: ') && tags.length < MAX_ARRAY_LENGTH) { const t = seg.slice(5).trimStart(); if (t) tags.push(flattenString(t)); }
    }
    if (commaIdx === -1) break;
    pos = commaIdx + 2;
  }
  return { refs, tags };
}

export type RawCommitBatchItem = {
  sha: string; parents: string[]; refs: string[]; tags: string[]; authorName: string; authorEmail: string; date: string;
  committerName: string; committerEmail: string; committerDate: string;
  subject: string; body: string; cleanSubject: string; type: string | undefined;
  scope: string | undefined; isBreaking: boolean; breakingChangeDescription: string | undefined; isRevert: boolean; revertedCommit: string | undefined;
  rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>; metadataObj: Record<string, unknown>; trailersObj?: Record<string, string>; references: string[];
  coAuthors: string[]; reviewers: string[]; issuesMap: Map<string, string | null>;
  trueFileCount: number;
  inlineNumstats?: NumstatCommitMap;
};

function extractRecordParts(commitBlock: string): string[] | null {
  const parts: string[] = [];
  const sepLen = FIELD_SEPARATOR.length;
  let startPos = 0;

  for (let i = 0; i < RECORD_START_FIELDS; i++) {
    const idx = commitBlock.indexOf(FIELD_SEPARATOR, startPos);
    if (idx === -1) break;
    parts.push(commitBlock.slice(startPos, idx));
    startPos = idx + sepLen;
  }

  const endParts: string[] = new Array<string>(RECORD_END_FIELDS);
  let endCount = 0;
  let endPos = commitBlock.length;
  for (let i = 0; i < RECORD_END_FIELDS; i++) {
    const searchFrom = endPos - sepLen;
    if (searchFrom < startPos) break;
    const idx = commitBlock.lastIndexOf(FIELD_SEPARATOR, searchFrom);
    if (idx < startPos) break;
    endParts[RECORD_END_FIELDS - 1 - endCount] = commitBlock.slice(idx + sepLen, endPos);
    endCount++;
    endPos = idx;
  }

  parts.push(commitBlock.slice(startPos, endPos));
  for (let i = RECORD_END_FIELDS - endCount; i < RECORD_END_FIELDS; i++) {
    const part = endParts[i];
    if (part !== undefined) parts.push(part);
  }

  if (parts.length < EXPECTED_RECORD_PARTS) {
    console.warn(`[lib-git-history] Warning: Dropping malformed git record with only ${parts.length} parts (expected at least ${EXPECTED_RECORD_PARTS}).`);
    return null;
  }
  return parts;
}

type RawFileItem = { status: string; file: string; oldFile?: string; similarityScore?: number };

function statusConsumesOldFile(statusRaw: string, isCombined: boolean): boolean {
  if (isCombined) return false;
  if (statusRaw.length === 1) return statusRaw === 'R' || statusRaw === 'C';
  const digitsMatch = statusRaw.match(REGEX_TRAILING_DIGITS);
  const status = digitsMatch && digitsMatch[1] ? statusRaw.slice(0, -digitsMatch[1].length) : statusRaw;
  const statusLetters = status.length === 1 ? status : status.replace(REGEX_DIGITS_GLOBAL, '');
  return statusLetters.length === 1 && (statusLetters === 'R' || statusLetters === 'C');
}

interface FilePartCursor {
  idx: number;
}

function readFilePart(filesBlock: string, cursor: FilePartCursor): string | null {
  if (cursor.idx >= filesBlock.length) return null;
  const nulIdx = filesBlock.indexOf('\x00', cursor.idx);
  if (nulIdx === -1) {
    const part = filesBlock.slice(cursor.idx);
    cursor.idx = filesBlock.length;
    return part;
  }
  const part = filesBlock.slice(cursor.idx, nulIdx);
  cursor.idx = nulIdx + 1;
  return part;
}

function skipFilePart(filesBlock: string, cursor: FilePartCursor): boolean {
  if (cursor.idx >= filesBlock.length) return false;
  const nulIdx = filesBlock.indexOf('\x00', cursor.idx);
  const nonEmpty = (nulIdx === -1 ? filesBlock.length : nulIdx) > cursor.idx;
  cursor.idx = nulIdx === -1 ? filesBlock.length : nulIdx + 1;
  return nonEmpty;
}

function parseSingleFileStatus(
  statusRaw: string,
  filesBlock: string,
  cursor: FilePartCursor,
  isCombined = false,
): RawFileItem | null {
  let status = statusRaw;
  let similarityScore: number | undefined;
  let hasOldFile: boolean;

  if (statusRaw.length === 1) {
    hasOldFile = !isCombined && (statusRaw === 'R' || statusRaw === 'C');
  } else {
    const digitsMatch = statusRaw.match(REGEX_TRAILING_DIGITS);
    if (digitsMatch && digitsMatch[1]) {
      const score = parseInt(digitsMatch[1], 10);
      if (score >= 0 && score <= 100) similarityScore = score;
      status = statusRaw.slice(0, -digitsMatch[1].length);
    }
    const statusLetters = status.length === 1 ? status : status.replace(REGEX_DIGITS_GLOBAL, '');
    hasOldFile = !isCombined && statusLetters.length === 1 && (statusLetters === 'R' || statusLetters === 'C');
  }

  const oldFile = hasOldFile ? (readFilePart(filesBlock, cursor) || undefined) : undefined;
  const file = readFilePart(filesBlock, cursor);
  if (!file) return null;

  const item: RawFileItem = {
    status: status.length === 1 ? status : flattenString(status),
    file: flattenString(file),
  };
  if (oldFile) item.oldFile = flattenString(oldFile);
  if (similarityScore !== undefined) item.similarityScore = similarityScore;
  return item;
}

const previewStatus = (s: string): string => sanitizeLogText(s.length > 128 ? `${s.slice(0, 128)}...` : s);

function isValidFileStatus(statusRaw: string): boolean {
  if (statusRaw.length === 1) {
    const code = statusRaw.charCodeAt(0);
    return code >= 65 && code <= 90;
  }
  return statusRaw.length <= 20 && REGEX_FILE_STATUS.test(statusRaw);
}

function consumeFileStatusToken(
  statusRaw: string, isCombined: boolean, filesBlock: string, cursor: FilePartCursor,
  rawFiles: RawFileItem[], countOnly: boolean,
): boolean {
  if (countOnly || rawFiles.length >= MAX_PARSED_FILES) {
    if (statusConsumesOldFile(statusRaw, isCombined)) skipFilePart(filesBlock, cursor);
    return skipFilePart(filesBlock, cursor);
  }
  const parsedFile = parseSingleFileStatus(statusRaw, filesBlock, cursor, isCombined);
  if (!parsedFile) return false;
  rawFiles.push(parsedFile);
  return true;
}

function createEmptyFilesResult(
  inlineNumstatMode: boolean,
): { rawFiles: RawFileItem[]; trueFileCount: number; inlineNumstats?: NumstatCommitMap } {
  return inlineNumstatMode ? { rawFiles: [], trueFileCount: 0, inlineNumstats: new Map() } : { rawFiles: [], trueFileCount: 0 };
}

function parseFilesBlock(
  filesBlock: string, sha: string, inlineNumstatMode: boolean, countOnly = false,
): { rawFiles: RawFileItem[]; trueFileCount: number; inlineNumstats?: NumstatCommitMap } {
  if (!filesBlock) return createEmptyFilesResult(inlineNumstatMode);
  const rawFiles: RawFileItem[] = [];
  const inlineNumstats: NumstatCommitMap | undefined = inlineNumstatMode ? new Map() : undefined;
  let trueFileCount = 0;
  const cursor: FilePartCursor = { idx: 0 };
  let readNumstatPart: (() => string | null) | undefined;

  let firstToken = readFilePart(filesBlock, cursor);
  if (firstToken === null) return createEmptyFilesResult(inlineNumstatMode);
  const firstCode = firstToken.charCodeAt(0);
  if (firstCode === 10 || firstCode === 13) firstToken = firstToken.replace(REGEX_LEADING_CR_LF, '');
  if (!firstToken && cursor.idx >= filesBlock.length) return createEmptyFilesResult(inlineNumstatMode);

  const hasCR = filesBlock.includes('\r');
  let token: string | null = firstToken;
  let iterations = 0;
  let emptyCount = 0;
  while (token !== null && iterations < MAX_STATUS_ITERATIONS) {
    iterations++;
    if (hasCR && token.includes('\r')) token = token.replace(REGEX_CR, '');
    if (token === '') {
      emptyCount++;
      if (emptyCount > MAX_EMPTY_STATUS_COUNT) break;
      token = readFilePart(filesBlock, cursor);
      continue;
    }
    emptyCount = 0;

    if (token.charCodeAt(0) === 58) {
      const isCombined = token.charCodeAt(1) === 58;
      const lastSpace = token.lastIndexOf(' ');
      const statusRaw = lastSpace !== -1 ? token.slice(lastSpace + 1) : '';
      if (!isValidFileStatus(statusRaw)) {
        console.warn(`[lib-git-history] Warning: Desynced or invalid raw file status "${previewStatus(statusRaw)}" in commit ${sanitizeLogText(sha)}. Stopping file parsing for this commit.`);
        break;
      }
      if (consumeFileStatusToken(statusRaw, isCombined, filesBlock, cursor, rawFiles, countOnly)) trueFileCount++;
    } else if (inlineNumstats !== undefined && token.includes('\t')) {
      parseNumstatLineIntoMap(token, readNumstatPart ??= () => readFilePart(filesBlock, cursor), inlineNumstats);
    } else if (isValidFileStatus(token)) {
      if (consumeFileStatusToken(token, false, filesBlock, cursor, rawFiles, countOnly)) trueFileCount++;
    } else {
      console.warn(`[lib-git-history] Warning: Desynced or invalid file status "${previewStatus(token)}" in commit ${sanitizeLogText(sha)}. Stopping file parsing for this commit.`);
      break;
    }
    token = readFilePart(filesBlock, cursor);
  }
  return { rawFiles, trueFileCount, ...(inlineNumstats ? { inlineNumstats } : {}) };
}

function parseParentsAndFiles(parentsAndFiles: string): { parentsRaw: string; filesBlock: string } {
  const len = parentsAndFiles.length;
  for (let i = 0; i < len; i++) {
    const code = parentsAndFiles.charCodeAt(i);
    if (code === 10) {
      const rawFilesBlock = parentsAndFiles.slice(i + 1);
      return {
        parentsRaw: parentsAndFiles.slice(0, i).trim(),
        filesBlock: rawFilesBlock.charCodeAt(0) === 13 ? rawFilesBlock.replace(REGEX_LEADING_CR, '') : rawFilesBlock,
      };
    }
    if (code === 0) {
      return {
        parentsRaw: parentsAndFiles.slice(0, i).trim(),
        filesBlock: parentsAndFiles.slice(i + 1),
      };
    }
  }
  return { parentsRaw: parentsAndFiles.trim(), filesBlock: '' };
}

function stripExactTrailerBlock(body: string, exactTrailerBlock: string): string {
  if (!exactTrailerBlock || !body || exactTrailerBlock.length > body.length * 2) return body;
  const normalizedBody = body.includes('\r') ? body.replace(REGEX_CR_OPT_LF, '\n') : body;
  const trailerTrimmed = exactTrailerBlock.includes('\r') ? exactTrailerBlock.replace(REGEX_CR_OPT_LF, '\n').trim() : exactTrailerBlock;
  if (trailerTrimmed.length === 0) return body;
  const trimmedBody = normalizedBody.trimEnd();
  if (trimmedBody.endsWith(trailerTrimmed)) {
    return trimmedBody.slice(0, -trailerTrimmed.length).trimEnd();
  }
  return body;
}

function applyIssueTrackerUrls(issuesMap: Map<string, string | null>, tracker: string | undefined): void {
  if (!tracker || issuesMap.size === 0) return;
  for (const [issue, action] of Array.from(issuesMap.entries())) {
    const finalIssue = expandIssueTrackerUrl(issue, tracker);
    if (finalIssue !== issue) {
      issuesMap.delete(issue);
      if (finalIssue) issuesMap.set(finalIssue, action);
    }
  }
}

function normalizeSubject(rawSubject: string): string {
  const trimmed = rawSubject.trim();
  const capped = trimmed.length > MAX_SUBJECT_LENGTH * 2 + 2 ? trimmed.slice(0, MAX_SUBJECT_LENGTH * 2 + 2) : trimmed;
  const subject = capped.includes('\r') ? capped.replace(REGEX_CR_LF, '\n') : capped;
  return subject.length > MAX_SUBJECT_LENGTH ? truncateSafely(subject, MAX_SUBJECT_LENGTH, '...[subject truncated]') : subject;
}

function normalizeBody(rawBody: string): string {
  const capped = rawBody.length > MAX_BODY_LENGTH * 2 + 2 ? rawBody.slice(0, MAX_BODY_LENGTH * 2 + 2) : rawBody;
  let body = capped.includes('\r') ? capped.replace(REGEX_CR_LF, '\n') : capped;
  if (body.length > MAX_BODY_LENGTH) body = truncateSafely(body, MAX_BODY_LENGTH, '\n\n...[body truncated to prevent memory exhaustion]');
  const hasBOM = body.charCodeAt(0) === 0xFEFF;
  body = body.trim();
  if (hasBOM && body.charCodeAt(0) !== 0xFEFF) body = '\uFEFF' + body;
  return body;
}

function stripLeadingEmojiAndShortcode(subject: string): string {
  if (subject.length === 0) return subject;
  const c = subject.charCodeAt(0);
  if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return subject;
  return subject.replace(REGEX_LEADING_EMOJI, '').replace(REGEX_LEADING_SHORTCODE, '');
}

function detectBodyBreaking(
  body: string,
  initialIsBreaking: boolean,
  initialDesc: string | undefined,
): { isBreaking: boolean; breakingChangeDescription: string | undefined } {
  if (body.length < 15 || (initialIsBreaking && initialDesc !== undefined)) {
    return { isBreaking: initialIsBreaking, breakingChangeDescription: initialDesc };
  }
  const bcMatch = body.match(REGEX_BREAKING_CHANGE);
  if (bcMatch !== null) {
    return { isBreaking: true, breakingChangeDescription: initialDesc || (bcMatch[1] ?? '').trim() };
  }
  // [INTENT]: `REGEX_BREAKING_CHANGE` covers all LF-only breaking lines; fallback is only needed for bare `\r` line breaks.
  if (!initialIsBreaking && body.includes('\r') && REGEX_BREAKING_FALLBACK.test(body)) return { isBreaking: true, breakingChangeDescription: initialDesc };
  return { isBreaking: initialIsBreaking, breakingChangeDescription: initialDesc };
}

function extractCommitIssues(subject: string, body: string, args: CliArgs): Map<string, string | null> {
  const customPattern = args['issue-pattern'];
  const subjHint = hasIssueTokenHint(subject);
  const bodyHint = hasIssueTokenHint(body);
  if (!subjHint && !bodyHint && !customPattern) return EMPTY_ISSUES_MAP;

  let issuesMap: Map<string, string | null> | undefined;
  const getMap = (): Map<string, string | null> => (issuesMap ??= new Map<string, string | null>());

  if (subjHint || customPattern) extractIssuesLazy(subject, getMap, customPattern, subjHint);
  if (bodyHint || customPattern) extractIssuesLazy(body, getMap, customPattern, bodyHint);

  if (!issuesMap || issuesMap.size === 0) return EMPTY_ISSUES_MAP;
  if (args['issue-tracker']) applyIssueTrackerUrls(issuesMap, args['issue-tracker']);
  return issuesMap;
}

function skipWithTags(sha: string, rawRefs: string, onSkippedTags?: (tags: readonly string[], sha: string) => void): null {
  if (onSkippedTags && rawRefs.includes('tag:')) {
    const { tags } = parseRefsAndTags(rawRefs.trim(), false);
    if (tags.length > 0) onSkippedTags(tags, flattenString(sha));
  }
  return null;
}

type IdentityFields = { authorName: string; authorEmail: string; date: string; committerName: string; committerEmail: string; committerDate: string };
function extractIdentityFields(parts: string[]): IdentityFields {
  const rawAuthorName = (parts[2] ?? '').trim(), rawAuthorEmail = (parts[3] ?? '').trim(), rawDate = (parts[4] ?? '').trim();
  const rawCommitterName = (parts[5] ?? '').trim(), rawCommitterEmail = (parts[6] ?? '').trim(), rawCommitterDate = (parts[7] ?? '').trim();
  const authorName = flattenString(rawAuthorName), authorEmail = flattenString(rawAuthorEmail), date = flattenString(rawDate);
  return {
    authorName, authorEmail, date,
    committerName: rawCommitterName === rawAuthorName ? authorName : flattenString(rawCommitterName),
    committerEmail: rawCommitterEmail === rawAuthorEmail ? authorEmail : flattenString(rawCommitterEmail),
    committerDate: rawCommitterDate === rawDate ? date : flattenString(rawCommitterDate),
  };
}

export function parseGitRecord(
  commitBlock: string, args: CliArgs, inlineNumstatMode = false,
  onSkippedTags?: (tags: readonly string[], sha: string) => void, omitBodyOverride = false,
): RawCommitBatchItem | null {
  const parts = extractRecordParts(commitBlock);
  if (!parts) return null;

  const sha = (parts[0] ?? '').trim();
  const rawRefs = parts[1] ?? '';
  const subject = normalizeSubject(parts[8] ?? '');
  const convMatch = stripLeadingEmojiAndShortcode(subject).match(REGEX_CONVENTIONAL_COMMIT);
  const type = convMatch ? convMatch[1] : undefined;
  if (args.type) {
    const allowedTypes = getParsedCliFilters(args).allowedTypes;
    if (allowedTypes && (!type || !allowedTypes.has(type.toLowerCase()))) return skipWithTags(sha, rawRefs, onSkippedTags);
  }

  const bodyEndIdx = parts.length - 3;
  const rawTrailers = (parts[bodyEndIdx + 1] ?? '').trim();
  const trailers = parseTrailersBlock(rawTrailers, sha);
  // [INTENT]: Evaluate trailer-only filters before normalizing bodies or scanning for BREAKING CHANGE footers.
  if (!matchesTrailerFilters(args, trailers.categories, type, trailers.metadataObj)) {
    return skipWithTags(sha, rawRefs, onSkippedTags);
  }

  const rawBody = bodyEndIdx === 10 ? (parts[9] ?? '') : parts.slice(9, bodyEndIdx).join(FIELD_SEPARATOR);
  const initialBody = normalizeBody(rawBody);
  const exactTrailerBlock = (parts[bodyEndIdx] ?? '').trim();
  const strippedBody = stripExactTrailerBlock(initialBody, exactTrailerBlock);
  const { isBreaking, breakingChangeDescription } = detectBodyBreaking(
    strippedBody, Boolean(convMatch?.[3]) || trailers.isBreaking, trailers.breakingChangeDescription,
  );

  if (args.breaking && !isBreaking) return skipWithTags(sha, rawRefs, onSkippedTags);
  if (args['changelog-only'] && trailers.entriesParsed.length === 0 && !(CHANGELOG_TYPES.has((type ?? '').toLowerCase()) || isBreaking)) {
    return skipWithTags(sha, rawRefs, onSkippedTags);
  }

  if (trailers.categories.length > 0) trailers.metadataObj['category'] = trailers.categories;
  if (trailers.entriesParsed.length > 0) trailers.metadataObj['entry'] = trailers.entriesParsed;
  if (hasOwnKeys(trailers.customTrailers)) trailers.metadataObj['customTrailers'] = trailers.customTrailers;

  const { parentsRaw, filesBlock } = parseParentsAndFiles(parts[bodyEndIdx + 2] ?? '');
  const isBuiltInChangelogNoCache = !args.cache && (args.format === 'markdown' || args.format === 'slack');
  const omitFiles = Boolean(args.summary || args['no-body'] || isBuiltInChangelogNoCache);
  const { rawFiles, trueFileCount, inlineNumstats } = parseFilesBlock(filesBlock, sha, inlineNumstatMode, omitFiles);

  const { refs, tags } = parseRefsAndTags(rawRefs.trim());
  const parents = (!parentsRaw ? [] : !parentsRaw.includes(' ') ? [flattenString(parentsRaw)] : parentsRaw.split(REGEX_WHITESPACE_SPLIT).filter(Boolean).map(flattenString)).slice(0, MAX_ARRAY_LENGTH);

  const revertMatch = strippedBody.includes('This reverts commit ') ? strippedBody.match(REGEX_REVERT_COMMIT) : null;
  const isRevert = ((subject.charCodeAt(0) | 32) === 114 && REGEX_REVERT_SUBJECT.test(subject)) || Boolean(revertMatch);
  const revertedCommit = revertMatch ? revertMatch[1] : undefined;

  const issuesMap = extractCommitIssues(subject, strippedBody, args);
  const omitBody = omitFiles || (args.stats && !args.cache) || omitBodyOverride;
  const body = omitBody || !strippedBody ? '' : flattenString(strippedBody);
  const flatSubject = flattenString(subject);
  const scope = convMatch ? convMatch[2] : undefined;
  const cleanSubject = convMatch ? flattenString((convMatch[4] ?? '').trim()) : flatSubject;
  return {
    sha: flattenString(sha), parents, refs, tags, ...extractIdentityFields(parts),
    subject: flatSubject, body, cleanSubject,
    type: type ? flattenString(type) : undefined, scope: scope ? flattenString(scope) : undefined, isBreaking, isRevert,
    revertedCommit: revertedCommit ? flattenString(revertedCommit) : undefined, breakingChangeDescription: breakingChangeDescription ? flattenString(breakingChangeDescription) : undefined,
    rawFiles, metadataObj: trailers.metadataObj, trailersObj: trailers.trailersObj, references: trailers.references,
    coAuthors: trailers.coAuthors, reviewers: trailers.reviewers, issuesMap, trueFileCount, ...(inlineNumstats !== undefined ? { inlineNumstats } : {}),
  };
}
