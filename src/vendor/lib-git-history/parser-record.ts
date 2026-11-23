// @ts-nocheck
import type { CliArgs } from './cli.js';
import { FIELD_SEPARATOR } from './git-runner.js';
import { parseNumstatLineIntoMap, type NumstatCommitMap } from './git-numstat.js';
import { extractIssues, truncateSafely, flattenString, expandIssueTrackerUrl, hasOwnKeys } from './parser-utils.js';
import { CHANGELOG_TYPES, getParsedCliFilters, matchesTrailerFilters } from './parser-metadata.js';
import { parseTrailersBlock } from './parser-trailers.js';
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  EXPECTED_RECORD_PARTS,
  MAX_STATUS_ITERATIONS,
  MAX_EMPTY_STATUS_COUNT,
  MAX_PARSED_FILES,
  RECORD_START_FIELDS,
  RECORD_END_FIELDS,
  REGEX_FILE_STATUS,
  REGEX_CONVENTIONAL_COMMIT,
  REGEX_BREAKING_CHANGE,
  REGEX_REVERT_COMMIT,
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
const REGEX_HEAD_REF = /^HEAD -> /;
const REGEX_TAG_PREFIX = /^tag:\s*/;
const REGEX_WHITESPACE_SPLIT = /\s+/;

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
    parts.push(endParts[i]);
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

function parseSingleFileStatus(
  statusRaw: string,
  getNextFilePart: () => string | null,
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
      similarityScore = parseInt(digitsMatch[1], 10);
      status = statusRaw.slice(0, -digitsMatch[1].length);
    }
    const statusLetters = status.length === 1 ? status : status.replace(REGEX_DIGITS_GLOBAL, '');
    hasOldFile = !isCombined && statusLetters.length === 1 && (statusLetters === 'R' || statusLetters === 'C');
  }

  const oldFile = hasOldFile ? (getNextFilePart() || undefined) : undefined;
  const file = getNextFilePart();
  if (!file) return null;

  const item: RawFileItem = {
    status: status.length === 1 ? status : flattenString(status),
    file: flattenString(file),
  };
  if (oldFile) item.oldFile = flattenString(oldFile);
  if (similarityScore !== undefined) item.similarityScore = similarityScore;
  return item;
}

function isValidFileStatus(statusRaw: string): boolean {
  if (statusRaw.length === 1) {
    const code = statusRaw.charCodeAt(0);
    return code >= 65 && code <= 90;
  }
  return statusRaw.length <= 20 && REGEX_FILE_STATUS.test(statusRaw);
}

function consumeFileStatusToken(
  statusRaw: string,
  isCombined: boolean,
  getNextFilePart: () => string | null,
  rawFiles: RawFileItem[],
  countOnly: boolean,
): boolean {
  if (countOnly || rawFiles.length >= MAX_PARSED_FILES) {
    if (statusConsumesOldFile(statusRaw, isCombined)) getNextFilePart();
    const skippedFile = getNextFilePart();
    return Boolean(skippedFile);
  }
  const parsedFile = parseSingleFileStatus(statusRaw, getNextFilePart, isCombined);
  if (!parsedFile) return false;
  rawFiles.push(parsedFile);
  return true;
}

function parseFilesBlock(
  filesBlock: string,
  sha: string,
  inlineNumstatMode: boolean,
  countOnly = false,
): { rawFiles: RawFileItem[]; trueFileCount: number; inlineNumstats?: NumstatCommitMap } {
  const rawFiles: RawFileItem[] = [];
  const inlineNumstats: NumstatCommitMap | undefined = inlineNumstatMode ? new Map() : undefined;
  let trueFileCount = 0;
  let fileBlockIdx = 0;

  const getNextFilePart = (): string | null => {
    if (!filesBlock || fileBlockIdx >= filesBlock.length) return null;
    const nulIdx = filesBlock.indexOf('\x00', fileBlockIdx);
    if (nulIdx === -1) {
      const part = filesBlock.slice(fileBlockIdx);
      fileBlockIdx = filesBlock.length;
      return part;
    }
    const part = filesBlock.slice(fileBlockIdx, nulIdx);
    fileBlockIdx = nulIdx + 1;
    return part;
  };

  let firstToken = getNextFilePart();
  if (firstToken === null) return { rawFiles, trueFileCount, ...(inlineNumstats ? { inlineNumstats } : {}) };
  const firstCode = firstToken.charCodeAt(0);
  if (firstCode === 10 || firstCode === 13) firstToken = firstToken.replace(REGEX_LEADING_CR_LF, '');
  if (!firstToken && fileBlockIdx >= filesBlock.length) {
    return { rawFiles, trueFileCount, ...(inlineNumstats ? { inlineNumstats } : {}) };
  }

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
      token = getNextFilePart();
      continue;
    }
    emptyCount = 0;

    if (token.charCodeAt(0) === 58) {
      // [INTENT]: Parse `git log --raw -z` entry (`:<modes> <shas> <status>` or `::<modes> <shas> <combinedStatus>`).
      const isCombined = token.charCodeAt(1) === 58;
      const lastSpace = token.lastIndexOf(' ');
      const statusRaw = lastSpace !== -1 ? token.slice(lastSpace + 1) : '';
      if (!isValidFileStatus(statusRaw)) {
        console.warn(`[lib-git-history] Warning: Desynced or invalid raw file status "${statusRaw}" in commit ${sha}. Stopping file parsing for this commit.`);
        break;
      }
      if (consumeFileStatusToken(statusRaw, isCombined, getNextFilePart, rawFiles, countOnly)) trueFileCount++;
    } else if (inlineNumstats !== undefined && token.includes('\t')) {
      parseNumstatLineIntoMap(token, getNextFilePart, inlineNumstats);
    } else if (isValidFileStatus(token)) {
      if (consumeFileStatusToken(token, false, getNextFilePart, rawFiles, countOnly)) trueFileCount++;
    } else {
      console.warn(`[lib-git-history] Warning: Desynced or invalid file status "${token}" in commit ${sha}. Stopping file parsing for this commit.`);
      break;
    }
    token = getNextFilePart();
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
  if (!exactTrailerBlock) return body;
  const normalizedBody = body.includes('\r') ? body.replace(REGEX_CR_OPT_LF, '\n') : body;
  const trailerTrimmed = (exactTrailerBlock.includes('\r') ? exactTrailerBlock.replace(REGEX_CR_OPT_LF, '\n') : exactTrailerBlock).trim();
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
      issuesMap.set(finalIssue, action);
    }
  }
}

function normalizeSubject(rawSubject: string): string {
  let subject = rawSubject.trim();
  if (subject.includes('\r')) subject = subject.replace(REGEX_CR_LF, '\n');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = truncateSafely(subject, MAX_SUBJECT_LENGTH, '...[subject truncated]');
  }
  return subject;
}

function normalizeBody(rawBody: string): string {
  let body = rawBody.includes('\r') ? rawBody.replace(REGEX_CR_LF, '\n') : rawBody;
  if (body.length > MAX_BODY_LENGTH) {
    body = truncateSafely(body, MAX_BODY_LENGTH, '\n\n...[body truncated to prevent memory exhaustion]');
  }
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
    return { isBreaking: true, breakingChangeDescription: initialDesc || bcMatch[1].trim() };
  }
  // [INTENT]: `REGEX_BREAKING_CHANGE` covers all LF-only breaking lines; fallback is only needed for bare `\r` line breaks.
  if (!initialIsBreaking && body.includes('\r') && REGEX_BREAKING_FALLBACK.test(body)) {
    return { isBreaking: true, breakingChangeDescription: initialDesc };
  }
  return { isBreaking: initialIsBreaking, breakingChangeDescription: initialDesc };
}

export function parseGitRecord(commitBlock: string, args: CliArgs, inlineNumstatMode = false): RawCommitBatchItem | null {
  const parts = extractRecordParts(commitBlock);
  if (!parts || parts.length < 12) return null;

  const subject = normalizeSubject(parts[8]);
  const convMatch = stripLeadingEmojiAndShortcode(subject).match(REGEX_CONVENTIONAL_COMMIT);
  const type = convMatch ? convMatch[1] : undefined;
  const parsedFilters = getParsedCliFilters(args);
  if (parsedFilters.allowedTypes && (!type || !parsedFilters.allowedTypes.has(type.toLowerCase()))) {
    return null;
  }

  const sha = parts[0].trim();
  const bodyEndIdx = parts.length - 3;
  const rawTrailers = (parts[bodyEndIdx + 1] ?? '').trim();
  const trailers = parseTrailersBlock(rawTrailers, sha);
  // [INTENT]: Evaluate trailer-only filters before normalizing bodies or scanning for BREAKING CHANGE footers.
  if (!matchesTrailerFilters(args, trailers.categories, type, trailers.metadataObj)) {
    return null;
  }

  const rawBody = bodyEndIdx === 10 ? parts[9] : parts.slice(9, bodyEndIdx).join(FIELD_SEPARATOR);
  const initialBody = normalizeBody(rawBody);
  const exactTrailerBlock = (parts[bodyEndIdx] ?? '').trim();
  const body = stripExactTrailerBlock(initialBody, exactTrailerBlock);
  const { isBreaking, breakingChangeDescription } = detectBodyBreaking(
    body,
    Boolean(convMatch?.[3]) || trailers.isBreaking,
    trailers.breakingChangeDescription,
  );

  if (args.breaking && !isBreaking) return null;
  if (args['changelog-only'] && trailers.entriesParsed.length === 0 && !(CHANGELOG_TYPES.has((type ?? '').toLowerCase()) || isBreaking)) {
    return null;
  }

  if (trailers.categories.length > 0) trailers.metadataObj['category'] = trailers.categories;
  if (trailers.entriesParsed.length > 0) trailers.metadataObj['entry'] = trailers.entriesParsed;
  if (hasOwnKeys(trailers.customTrailers)) trailers.metadataObj['customTrailers'] = trailers.customTrailers;

  const { parentsRaw, filesBlock } = parseParentsAndFiles(parts[bodyEndIdx + 2] ?? '');
  const { rawFiles, trueFileCount, inlineNumstats } = parseFilesBlock(filesBlock, sha, inlineNumstatMode, Boolean(args.summary));

  const refsRaw = parts[1].trim();
  const refs = refsRaw ? refsRaw.split(', ').map((r) => flattenString(r.trim().replace(REGEX_HEAD_REF, ''))).filter(Boolean) : [];
  const tags = refs.length > 0 ? refs.filter((r) => r.startsWith('tag: ')).map((r) => flattenString(r.replace(REGEX_TAG_PREFIX, ''))) : [];
  const parents = !parentsRaw ? [] : !parentsRaw.includes(' ') ? [flattenString(parentsRaw)] : parentsRaw.split(REGEX_WHITESPACE_SPLIT).filter(Boolean).map(flattenString);

  const revertMatch = body.includes('This reverts commit ') ? body.match(REGEX_REVERT_COMMIT) : null;
  const isRevert = ((subject.charCodeAt(0) | 32) === 114 && REGEX_REVERT_SUBJECT.test(subject)) || Boolean(revertMatch);
  const revertedCommit = revertMatch ? revertMatch[1] : undefined;

  const issuesMap = new Map<string, string | null>();
  extractIssues(subject, issuesMap, args['issue-pattern']);
  extractIssues(body, issuesMap, args['issue-pattern']);
  applyIssueTrackerUrls(issuesMap, args['issue-tracker']);

  const scope = convMatch ? convMatch[2] : undefined;
  const cleanSubject = convMatch ? convMatch[4].trim() : subject;
  return {
    sha: flattenString(sha), parents, refs, tags,
    authorName: flattenString(parts[2].trim()), authorEmail: flattenString(parts[3].trim()),
    date: flattenString(parts[4].trim()), committerName: flattenString(parts[5].trim()),
    committerEmail: flattenString(parts[6].trim()), committerDate: flattenString(parts[7].trim()),
    subject: flattenString(subject), body, cleanSubject: flattenString(cleanSubject),
    type: type ? flattenString(type) : undefined, scope: scope ? flattenString(scope) : undefined,
    isBreaking, isRevert,
    revertedCommit: revertedCommit ? flattenString(revertedCommit) : undefined,
    breakingChangeDescription: breakingChangeDescription ? flattenString(breakingChangeDescription) : undefined,
    rawFiles, metadataObj: trailers.metadataObj, trailersObj: trailers.trailersObj,
    references: trailers.references, coAuthors: trailers.coAuthors, reviewers: trailers.reviewers,
    issuesMap, trueFileCount,
    ...(inlineNumstats !== undefined ? { inlineNumstats } : {}),
  };
}
