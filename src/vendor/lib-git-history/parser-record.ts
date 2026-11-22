// @ts-nocheck
import type { CliArgs } from './cli.js';
import { FIELD_SEPARATOR } from './git-runner.js';
import { extractIssues, truncateSafely, flattenString, expandIssueTrackerUrl } from './parser-utils.js';
import { evaluateNumericFilter } from './parser-metadata.js';
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

interface ParsedCliFilters {
  allowedCategories?: Set<string>;
  allowedTypes?: Set<string>;
}

const CLI_FILTER_CACHE = new WeakMap<CliArgs, ParsedCliFilters>();
const CHANGELOG_TYPES = new Set(['feat', 'fix', 'perf', 'revert']);
const REGEX_TRAILING_DIGITS = /(\d{1,3})$/;
const REGEX_DIGITS_GLOBAL = /\d+/g;
const REGEX_BREAKING_FALLBACK = /^BREAKING[\s-]CHANGES?(?::|$)/im;
const REGEX_REVERT_SUBJECT = /^revert:? /i;
const REGEX_LEADING_EMOJI = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u;
const REGEX_LEADING_SHORTCODE = /^:\w+:\s*/;

function getParsedCliFilters(args: CliArgs): ParsedCliFilters {
  let cached = CLI_FILTER_CACHE.get(args);
  if (cached) return cached;
  cached = {};
  if (args.category) {
    cached.allowedCategories = new Set(args.category.split(',').map(c => c.trim().toLowerCase()));
  }
  if (args.type) {
    cached.allowedTypes = new Set(args.type.split(',').map(t => t.trim().toLowerCase()));
  }
  CLI_FILTER_CACHE.set(args, cached);
  return cached;
}

export type RawCommitBatchItem = {
  sha: string; parents: string[]; refs: string[]; tags: string[]; authorName: string; authorEmail: string; date: string;
  committerName: string; committerEmail: string; committerDate: string;
  subject: string; body: string; cleanSubject: string; type: string | undefined;
  scope: string | undefined; isBreaking: boolean; breakingChangeDescription: string | undefined; isRevert: boolean; revertedCommit: string | undefined;
  rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>; metadataObj: Record<string, unknown>; trailersObj?: Record<string, string>; references: string[];
  coAuthors: string[]; reviewers: string[]; issuesMap: Map<string, string | null>;
  trueFileCount: number;
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

function parseSingleFileStatus(
  statusRaw: string,
  getNextFilePart: () => string | null,
): RawFileItem | null {
  let status = statusRaw;
  let similarityScore: number | undefined;
  let hasOldFile: boolean;

  if (statusRaw.length === 1) {
    hasOldFile = statusRaw === 'R' || statusRaw === 'C';
  } else {
    const digitsMatch = statusRaw.match(REGEX_TRAILING_DIGITS);
    if (digitsMatch && digitsMatch[1]) {
      similarityScore = parseInt(digitsMatch[1], 10);
      status = statusRaw.slice(0, -digitsMatch[1].length);
    }
    const statusLetters = status.length === 1 ? status : status.replace(REGEX_DIGITS_GLOBAL, '');
    hasOldFile = statusLetters.length === 1 && (statusLetters === 'R' || statusLetters === 'C');
  }

  const oldFile = hasOldFile ? (getNextFilePart() || undefined) : undefined;
  const file = getNextFilePart();
  if (!file) return null;

  const flatOldFile = oldFile ? flattenString(oldFile) : undefined;
  return {
    status: status.length === 1 ? status : flattenString(status),
    file: flattenString(file),
    ...(flatOldFile ? { oldFile: flatOldFile } : {}),
    ...(similarityScore !== undefined ? { similarityScore } : {}),
  };
}

function isValidFileStatus(statusRaw: string): boolean {
  if (statusRaw.length === 1) {
    const code = statusRaw.charCodeAt(0);
    return code >= 65 && code <= 90;
  }
  return statusRaw.length <= 20 && REGEX_FILE_STATUS.test(statusRaw);
}

function parseFilesBlock(filesBlock: string, sha: string): { rawFiles: RawFileItem[]; trueFileCount: number } {
  const rawFiles: RawFileItem[] = [];
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

  let firstStatus = getNextFilePart();
  if (firstStatus === null) return { rawFiles, trueFileCount };
  firstStatus = firstStatus.replace(/^[\r\n]+/, '');
  if (!firstStatus && fileBlockIdx >= filesBlock.length) return { rawFiles, trueFileCount };

  let statusRaw: string | null = firstStatus;
  let iterations = 0;
  let emptyCount = 0;
  while (statusRaw !== null && iterations < MAX_STATUS_ITERATIONS) {
    iterations++;
    if (statusRaw.includes('\r')) statusRaw = statusRaw.replace(/\r/g, '');
    if (statusRaw === '') {
      emptyCount++;
      if (emptyCount > MAX_EMPTY_STATUS_COUNT) break;
      statusRaw = getNextFilePart();
      continue;
    }
    emptyCount = 0;
    if (!isValidFileStatus(statusRaw)) {
      console.warn(`[lib-git-history] Warning: Desynced or invalid file status "${statusRaw}" in commit ${sha}. Stopping file parsing for this commit.`);
      break;
    }
    const parsedFile = parseSingleFileStatus(statusRaw, getNextFilePart);
    if (parsedFile) {
      trueFileCount++;
      if (rawFiles.length < MAX_PARSED_FILES) rawFiles.push(parsedFile);
    }
    statusRaw = getNextFilePart();
  }
  return { rawFiles, trueFileCount };
}

function parseParentsAndFiles(parentsAndFiles: string): { parentsRaw: string; filesBlock: string } {
  const firstNewline = parentsAndFiles.indexOf('\n');
  const firstNul = parentsAndFiles.indexOf('\0');
  if (firstNewline !== -1 && (firstNul === -1 || firstNewline < firstNul)) {
    return {
      parentsRaw: parentsAndFiles.slice(0, firstNewline).trim(),
      filesBlock: parentsAndFiles.slice(firstNewline + 1).replace(/^\r+/, ''),
    };
  }
  if (firstNul !== -1) {
    return {
      parentsRaw: parentsAndFiles.slice(0, firstNul).trim(),
      filesBlock: parentsAndFiles.slice(firstNul + 1),
    };
  }
  return { parentsRaw: parentsAndFiles.trim(), filesBlock: '' };
}

function stripExactTrailerBlock(body: string, exactTrailerBlock: string): string {
  if (!exactTrailerBlock) return body;
  const normalizedBody = body.replace(/\r\n?/g, '\n');
  const trailerTrimmed = exactTrailerBlock.replace(/\r\n?/g, '\n').trim();
  if (trailerTrimmed.length === 0) return body;
  const trimmedBody = normalizedBody.trimEnd();
  if (trimmedBody.endsWith(trailerTrimmed)) {
    return trimmedBody.slice(0, -trailerTrimmed.length).trimEnd();
  }
  return body;
}

function matchesRecordFilters(
  args: CliArgs,
  categories: string[],
  entriesParsed: string[],
  type: string | undefined,
  isBreaking: boolean,
  metadataObj: Record<string, unknown>,
): boolean {
  const parsedFilters = getParsedCliFilters(args);
  if (parsedFilters.allowedCategories) {
    const filterCategories = categories.length > 0 ? categories : (type ? [type.charAt(0).toUpperCase() + type.slice(1)] : ['Uncategorized']);
    if (!filterCategories.some((c) => parsedFilters.allowedCategories?.has(c.toLowerCase()))) return false;
  }
  if (parsedFilters.allowedTypes) {
    if (!type || !parsedFilters.allowedTypes.has(type.toLowerCase())) return false;
  }
  if (args.breaking && !isBreaking) return false;
  if (args['changelog-only'] && entriesParsed.length === 0 && !(CHANGELOG_TYPES.has(type || '') || isBreaking)) return false;
  if (args['impact']) {
    const rawImpact = metadataObj['impact'];
    if (!evaluateNumericFilter(args['impact'], typeof rawImpact === 'number' ? rawImpact : undefined)) return false;
  }
  if (args['confidence']) {
    const rawConfidence = metadataObj['confidence'];
    if (!evaluateNumericFilter(args['confidence'], typeof rawConfidence === 'number' ? rawConfidence : undefined)) return false;
  }
  return true;
}

function applyIssueTrackerUrls(issuesMap: Map<string, string | null>, tracker: string | undefined): void {
  if (!tracker) return;
  for (const [issue, action] of Array.from(issuesMap.entries())) {
    const finalIssue = expandIssueTrackerUrl(issue, tracker);
    if (finalIssue !== issue) {
      issuesMap.delete(issue);
      issuesMap.set(finalIssue, action);
    }
  }
}

function normalizeSubjectAndBody(rawSubject: string, bodyParts: string[]): { subject: string; body: string } {
  let subject = rawSubject.trim().replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = truncateSafely(subject, MAX_SUBJECT_LENGTH, '...[subject truncated]');
  }
  let body = bodyParts.join(FIELD_SEPARATOR).replace(/\r\n/g, '\n');
  if (body.length > MAX_BODY_LENGTH) {
    body = truncateSafely(body, MAX_BODY_LENGTH, '\n\n...[body truncated to prevent memory exhaustion]');
  }
  const hasBOM = body.startsWith('\uFEFF');
  body = body.trim();
  if (hasBOM && !body.startsWith('\uFEFF')) body = '\uFEFF' + body;
  return { subject, body };
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
  if (body.length === 0) return { isBreaking: initialIsBreaking, breakingChangeDescription: initialDesc };
  const bcMatch = body.match(REGEX_BREAKING_CHANGE);
  if (bcMatch !== null) {
    return { isBreaking: true, breakingChangeDescription: initialDesc || bcMatch[1].trim() };
  }
  if (!initialIsBreaking && REGEX_BREAKING_FALLBACK.test(body)) {
    return { isBreaking: true, breakingChangeDescription: initialDesc };
  }
  return { isBreaking: initialIsBreaking, breakingChangeDescription: initialDesc };
}

export function parseGitRecord(commitBlock: string, args: CliArgs): RawCommitBatchItem | null {
  const parts = extractRecordParts(commitBlock);
  if (!parts || parts.length < 12) return null;

  const sha = parts[0].trim();
  const refsRaw = parts[1].trim();
  const authorName = parts[2].trim();
  const authorEmail = parts[3].trim();
  const date = parts[4].trim();
  const committerName = parts[5].trim();
  const committerEmail = parts[6].trim();
  const committerDate = parts[7].trim();
  const bodyEndIdx = parts.length - 3;
  const normalized = normalizeSubjectAndBody(parts[8], parts.slice(9, bodyEndIdx));
  const subject = normalized.subject;
  let body = normalized.body;

  const exactTrailerBlock = (parts[bodyEndIdx] ?? '').trim();
  const rawTrailers = (parts[bodyEndIdx + 1] ?? '').trim();
  const { parentsRaw, filesBlock } = parseParentsAndFiles(parts[bodyEndIdx + 2] ?? '');
  const { rawFiles, trueFileCount } = parseFilesBlock(filesBlock, sha);

  const convMatch = stripLeadingEmojiAndShortcode(subject).match(REGEX_CONVENTIONAL_COMMIT);
  const type = convMatch ? convMatch[1] : undefined;
  const scope = convMatch ? convMatch[2] : undefined;
  const cleanSubject = convMatch ? convMatch[4].trim() : subject;

  const trailers = parseTrailersBlock(rawTrailers, sha);
  body = stripExactTrailerBlock(body, exactTrailerBlock);
  const { isBreaking, breakingChangeDescription } = detectBodyBreaking(
    body,
    Boolean(convMatch?.[3]) || trailers.isBreaking,
    trailers.breakingChangeDescription,
  );

  if (trailers.categories.length > 0) trailers.metadataObj['category'] = trailers.categories;
  if (trailers.entriesParsed.length > 0) trailers.metadataObj['entry'] = trailers.entriesParsed;
  if (Object.keys(trailers.customTrailers).length > 0) trailers.metadataObj['customTrailers'] = trailers.customTrailers;

  if (!matchesRecordFilters(args, trailers.categories, trailers.entriesParsed, type, isBreaking, trailers.metadataObj)) {
    return null;
  }

  const refs = refsRaw ? refsRaw.split(', ').map((r) => r.trim().replace(/^HEAD -> /, '')).filter(Boolean) : [];
  const tags = refs.filter((r) => r.startsWith('tag: ')).map((r) => r.replace(/^tag:\s*/, ''));
  const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];

  const revertMatch = body.includes('This reverts commit ') ? body.match(REGEX_REVERT_COMMIT) : null;
  const isRevert = REGEX_REVERT_SUBJECT.test(subject) || Boolean(revertMatch);
  const revertedCommit = revertMatch ? revertMatch[1] : undefined;

  const issuesMap = new Map<string, string | null>();
  extractIssues(subject, issuesMap, args['issue-pattern']);
  extractIssues(body, issuesMap, args['issue-pattern']);
  applyIssueTrackerUrls(issuesMap, args['issue-tracker']);

  return {
    sha: flattenString(sha), parents, refs, tags,
    authorName: flattenString(authorName), authorEmail: flattenString(authorEmail),
    date: flattenString(date), committerName: flattenString(committerName),
    committerEmail: flattenString(committerEmail), committerDate: flattenString(committerDate),
    subject: flattenString(subject), body, cleanSubject: flattenString(cleanSubject),
    type: type ? flattenString(type) : undefined, scope: scope ? flattenString(scope) : undefined,
    isBreaking, isRevert,
    revertedCommit: revertedCommit ? flattenString(revertedCommit) : undefined,
    breakingChangeDescription: breakingChangeDescription ? flattenString(breakingChangeDescription) : undefined,
    rawFiles, metadataObj: trailers.metadataObj, trailersObj: trailers.trailersObj,
    references: trailers.references, coAuthors: trailers.coAuthors, reviewers: trailers.reviewers,
    issuesMap, trueFileCount,
  };
}
