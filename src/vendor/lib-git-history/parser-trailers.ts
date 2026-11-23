// @ts-nocheck
import { extractNumericMetadata } from './parser-metadata.js';
import { flattenString, truncateSafely } from './parser-utils.js';
import { MAX_ARRAY_LENGTH, MAX_TRAILER_LENGTH } from './constants.js';

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

const EMPTY_STRING_ARRAY: string[] = Object.freeze([]) as unknown as string[];
const EMPTY_RECORD: Record<string, unknown> = Object.freeze(Object.create(null) as Record<string, unknown>);
const EMPTY_STRING_ARRAY_RECORD: Record<string, string[]> = Object.freeze(Object.create(null) as Record<string, string[]>);
const EMPTY_STRING_RECORD: Record<string, string> = Object.freeze(Object.create(null) as Record<string, string>);
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
    if (single) categories.push(single);
    return;
  }
  const splitVals: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if (code === 34) inQuotes = !inQuotes;
    else if (code === 44 && !inQuotes) {
      splitVals.push(val.slice(start, i));
      start = i + 1;
    }
  }
  splitVals.push(val.slice(start));
  for (const rawItem of splitVals) {
    const titleCased = titleCaseCategory(rawItem);
    if (titleCased) categories.push(titleCased);
  }
}

function enforceMaxArray(arr: unknown[], name: string, sha: string): void {
  if (arr.length > MAX_ARRAY_LENGTH) {
    console.warn(
      `[lib-git-history] Warning: Array ${name} truncated from ${arr.length} to ${MAX_ARRAY_LENGTH} items in commit ${sha}`,
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
    if (val) state.references.push(`${niceKey}: ${val}`);
  } else if (colonIdx !== -1) {
    if (!state.customTrailers[key]) state.customTrailers[key] = [];
    state.customTrailers[key].push(val);
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
      parseCategoryList(val, state.categories);
      break;
    case 'history-entry':
    case 'changelog-entry':
    case 'entry':
      state.entriesParsed.push(val);
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
    case 'co-authored-by':
      for (const part of val.split(',')) {
        const trimmed = part.trim();
        if (trimmed) state.coAuthors.push(trimmed);
      }
      break;
    case 'reviewed-by':
      if (val) state.reviewers.push(val);
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
    metadataObj: Object.create(null) as Record<string, unknown>,
    customTrailers: Object.create(null) as Record<string, string[]>,
    trailersObj: Object.create(null) as Record<string, string>,
    isBreaking: false,
    breakingChangeDescription: undefined,
  };

  const trailerList = rawTrailers.split('\x1C');
  for (const t of trailerList) {
    if (!t) continue;
    const colonIdx = t.indexOf(':');
    const keyRaw = colonIdx === -1 ? t.trim() : t.slice(0, colonIdx).trim();
    if (!keyRaw) continue;
    const flatKeyRaw = flattenString(keyRaw);
    const keyLower = flatKeyRaw.toLowerCase();
    const key = keyLower.includes(' ') || keyLower.includes('\t') ? keyLower.replace(WHITESPACE_COLLAPSE_RE, '-') : keyLower;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const rawVal = colonIdx === -1 ? '' : t.slice(colonIdx + 1).trim();
    let val = rawVal.includes('\n') ? rawVal.replace(REGEX_TRAILER_CONTINUATION, '\n') : rawVal;
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
    enforceMaxArray(state.customTrailers[k], `customTrailers[${k}]`, sha);
  }

  return state;
}
