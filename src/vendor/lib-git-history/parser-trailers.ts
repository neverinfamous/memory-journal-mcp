// @ts-nocheck
import { extractNumericMetadata } from './parser-metadata.js';
import { flattenString, truncateSafely } from './parser-utils.js';
import { MAX_ARRAY_LENGTH, MAX_TRAILER_LENGTH, createNullProtoRecord } from './constants.js';
import { sanitizeLogText } from './security-utils.js';

const MAX_TRAILERS_PER_COMMIT = 100;
const MAX_TRAILER_KEY_LENGTH = 128;

const VALIDATION_PASS_VALUES = new Set(['success', 'ok', 'passing']);
const VALIDATION_FAIL_VALUES = new Set(['error', 'failing', 'fail']);
const REFERENCE_TRAILER_LABELS: ReadonlyMap<string, string> = new Map([
  ['acked-by', 'Acked-By'],
  ['bug', 'Bug'],
  ['cc', 'Cc'],
  ['closes', 'Closes'],
  ['depends-on', 'Depends-On'],
  ['fixes', 'Fixes'],
  ['refs', 'Refs'],
  ['references', 'References'],
  ['related-to', 'Related-To'],
  ['reported-by', 'Reported-By'],
  ['resolves', 'Resolves'],
  ['see-also', 'See-Also'],
  ['signed-off-by', 'Signed-Off-By'],
  ['tested-by', 'Tested-By'],
]);

export interface ParsedTrailersResult {
  categories: string[];
  entriesParsed: string[];
  references: string[];
  coAuthors: string[];
  reviewers: string[];
  metadataObj: Record<string, unknown>;
  customTrailers: Record<string, string[]>;
  trailersObj: Record<string, string>;
  isBreaking: boolean;
  breakingChangeDescription: string | undefined;
}

const EMPTY_STRING_ARRAY: string[] = [];
Object.freeze(EMPTY_STRING_ARRAY);
const EMPTY_RECORD: Record<string, unknown> = Object.freeze(createNullProtoRecord<unknown>());
const EMPTY_STRING_ARRAY_RECORD: Record<string, string[]> = Object.freeze(createNullProtoRecord<string[]>());
const EMPTY_STRING_RECORD: Record<string, string> = Object.freeze(createNullProtoRecord<string>());
const EMPTY_TRAILERS_RESULT: ParsedTrailersResult = Object.freeze({
  categories: EMPTY_STRING_ARRAY,
  entriesParsed: EMPTY_STRING_ARRAY,
  references: EMPTY_STRING_ARRAY,
  coAuthors: EMPTY_STRING_ARRAY,
  reviewers: EMPTY_STRING_ARRAY,
  metadataObj: EMPTY_RECORD,
  customTrailers: EMPTY_STRING_ARRAY_RECORD,
  trailersObj: EMPTY_STRING_RECORD,
  isBreaking: false,
  breakingChangeDescription: undefined,
});

const CATEGORY_SPLIT_RE = /[\s-]+/;
const QUOTE_STRIP_RE = /^"|"$/g;
const WHITESPACE_COLLAPSE_RE = /\s+/g;

function titleCaseCategory(rawItem: string): string {
  const trimmed = rawItem.trim();
  const cleaned =
    trimmed.length > 0 && (trimmed.charCodeAt(0) === 34 || trimmed.charCodeAt(trimmed.length - 1) === 34)
      ? trimmed.replace(QUOTE_STRIP_RE, '')
      : trimmed;
  if (!cleaned) return '';
  if (!cleaned.includes(' ') && !cleaned.includes('-') && !cleaned.includes('\t') && !cleaned.includes('\n') && !cleaned.includes('\r')) {
    const first = cleaned.charCodeAt(0);
    return first >= 97 && first <= 122 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
  }
  return cleaned
    .split(CATEGORY_SPLIT_RE)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseCategoryList(val: string, categories: string[]): void {
  if (!val.includes(',') && !val.includes('"')) {
    const single = titleCaseCategory(val);
    if (single && categories.length <= MAX_ARRAY_LENGTH) categories.push(single);
    return;
  }
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i <= val.length; i++) {
    const atEnd = i === val.length;
    const code = atEnd ? 44 : val.charCodeAt(i);
    if (!atEnd && code === 34) { inQuotes = !inQuotes; continue; }
    if (code === 44 && !inQuotes) {
      const titleCased = titleCaseCategory(val.slice(start, i));
      if (titleCased) {
        categories.push(titleCased);
        if (categories.length > MAX_ARRAY_LENGTH) break;
      }
      start = i + 1;
    }
  }
}

function enforceMaxArray(arr: unknown[], name: string, sha: string): void {
  if (arr.length > MAX_ARRAY_LENGTH) {
    console.warn(
      `[lib-git-history] Warning: Array ${sanitizeLogText(name)} truncated from ${arr.length} to ${MAX_ARRAY_LENGTH} items in commit ${sanitizeLogText(sha)}`,
    );
    arr.length = MAX_ARRAY_LENGTH;
  }
}

function applyFallbackTrailer(
  key: string,
  val: string,
  colonIdx: number,
  state: ParsedTrailersResult,
): void {
  const niceKey = REFERENCE_TRAILER_LABELS.get(key);
  if (niceKey !== undefined) {
    if (val && state.references.length <= MAX_ARRAY_LENGTH) state.references.push(`${niceKey}: ${val}`);
  } else if (colonIdx !== -1) {
    let arr = state.customTrailers[key];
    if (!arr) { arr = []; state.customTrailers[key] = arr; }
    if (arr.length <= MAX_ARRAY_LENGTH) arr.push(val);
  }
}

function applySingleTrailer(
  key: string,
  val: string,
  colonIdx: number,
  state: ParsedTrailersResult,
): void {
  switch (key) {
    case 'history-category':
    case 'changelog-category':
    case 'category':
      if (state.categories.length <= MAX_ARRAY_LENGTH) parseCategoryList(val, state.categories);
      break;
    case 'history-entry':
    case 'changelog-entry':
    case 'entry':
      if (state.entriesParsed.length <= MAX_ARRAY_LENGTH) state.entriesParsed.push(val);
      break;
    case 'history-significance':
    case 'changelog-significance':
    case 'significance':
      state.metadataObj['significance'] = val;
      break;
    case 'history-impact':
    case 'changelog-impact':
    case 'impact': {
      const ext = extractNumericMetadata(val);
      if (ext !== undefined) state.metadataObj['impact'] = ext;
      break;
    }
    case 'history-confidence':
    case 'changelog-confidence':
    case 'confidence': {
      const ext = extractNumericMetadata(val);
      if (ext !== undefined) state.metadataObj['confidence'] = ext;
      break;
    }
    case 'history-trust':
    case 'changelog-trust':
    case 'trust': {
      const ext = extractNumericMetadata(val);
      if (ext !== undefined) state.metadataObj['trust'] = ext;
      break;
    }
    case 'validation':
    case 'history-validation':
    case 'changelog-validation':
    case 'validation-status':
    case 'history-validation-status':
    case 'changelog-validation-status': {
      let v = val.toLowerCase();
      if (VALIDATION_PASS_VALUES.has(v)) v = 'passed';
      else if (VALIDATION_FAIL_VALUES.has(v)) v = 'failed';
      state.metadataObj['validation'] = v;
      break;
    }
    case 'breaking-change':
    case 'breaking-changes':
      state.isBreaking = true;
      if (val.trim()) state.breakingChangeDescription = val;
      break;
    case 'co-authored-by': {
      if (!val.includes(',')) {
        const trimmed = val.trim();
        if (trimmed && state.coAuthors.length <= MAX_ARRAY_LENGTH) state.coAuthors.push(trimmed);
        break;
      }
      for (const part of val.split(',')) {
        const trimmed = part.trim();
        if (trimmed && state.coAuthors.length <= MAX_ARRAY_LENGTH) state.coAuthors.push(trimmed);
      }
      break;
    }
    case 'reviewed-by':
      if (val && state.reviewers.length <= MAX_ARRAY_LENGTH) state.reviewers.push(val);
      break;
    default:
      applyFallbackTrailer(key, val, colonIdx, state);
      break;
  }
}

const REGEX_TRAILER_CONTINUATION = /\r?\n[ \t]+/g;
const REGEX_ZERO_WIDTH_SPACE = /\u200B/g;

export function parseTrailersBlock(rawTrailers: string, sha: string): ParsedTrailersResult {
  if (!rawTrailers) {
    return EMPTY_TRAILERS_RESULT;
  }

  const state: ParsedTrailersResult = {
    categories: [],
    entriesParsed: [],
    references: [],
    coAuthors: [],
    reviewers: [],
    metadataObj: createNullProtoRecord<unknown>(),
    customTrailers: createNullProtoRecord<string[]>(),
    trailersObj: createNullProtoRecord<string>(),
    isBreaking: false,
    breakingChangeDescription: undefined,
  };

  let processed = 0;
  let pos = 0;
  while (pos <= rawTrailers.length) {
    const sepIdx = rawTrailers.indexOf('\x1C', pos);
    const t = sepIdx === -1 ? rawTrailers.slice(pos) : rawTrailers.slice(pos, sepIdx);
    pos = sepIdx === -1 ? rawTrailers.length + 1 : sepIdx + 1;
    if (!t) continue;
    if (++processed > MAX_TRAILERS_PER_COMMIT) {
      console.warn(`[lib-git-history] Warning: Trailer count exceeded ${MAX_TRAILERS_PER_COMMIT} in commit ${sanitizeLogText(sha)}; ignoring remaining trailers.`);
      break;
    }
    const colonIdx = t.indexOf(':');
    const keyRaw = colonIdx === -1 ? t.trim() : t.slice(0, colonIdx).trim();
    if (!keyRaw || keyRaw.length > MAX_TRAILER_KEY_LENGTH) continue;
    const flatKeyRaw = flattenString(keyRaw);
    const keyLower = flatKeyRaw.toLowerCase();
    const key = keyLower.includes(' ') || keyLower.includes('\t') ? keyLower.replace(WHITESPACE_COLLAPSE_RE, '-') : keyLower;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const rawVal = colonIdx === -1 ? '' : t.slice(colonIdx + 1).trim();
    const cappedRaw = rawVal.length > MAX_TRAILER_LENGTH * 4 + 64 ? rawVal.slice(0, MAX_TRAILER_LENGTH * 4 + 64) : rawVal;
    let val = cappedRaw.includes('\n') ? cappedRaw.replace(REGEX_TRAILER_CONTINUATION, '\n') : cappedRaw;
    if (val.includes('\u200B')) val = val.replace(REGEX_ZERO_WIDTH_SPACE, '');
    if (val.length > MAX_TRAILER_LENGTH) {
      val = truncateSafely(val, MAX_TRAILER_LENGTH, '\n...[trailer truncated due to length]');
    }
    const flatVal = val ? flattenString(val) : '';
    state.trailersObj[flatKeyRaw] = flatVal;
    applySingleTrailer(key, flatVal, colonIdx, state);
  }

  enforceMaxArray(state.categories, 'categories', sha);
  enforceMaxArray(state.entriesParsed, 'entriesParsed', sha);
  enforceMaxArray(state.references, 'references', sha);
  enforceMaxArray(state.coAuthors, 'coAuthors', sha);
  enforceMaxArray(state.reviewers, 'reviewers', sha);
  for (const k in state.customTrailers) {
    const customList = state.customTrailers[k];
    if (customList !== undefined) {
      enforceMaxArray(customList, `customTrailers[${k}]`, sha);
    }
  }

  return state;
}
