// @ts-nocheck
import { extractNumericMetadata } from './parser-metadata.js';
import { truncateSafely } from './parser-utils.js';
import {
  MAX_ARRAY_LENGTH,
  MAX_TRAILER_LENGTH,
  REGEX_REFERENCE_TRAILER,
  REGEX_VALIDATION_TRAILER,
} from './constants.js';

const VALIDATION_PASS_VALUES = new Set(['success', 'ok', 'passing']);
const VALIDATION_FAIL_VALUES = new Set(['error', 'failing', 'fail']);

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

function parseCategoryList(val: string, categories: string[]): void {
  const splitVals: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < val.length; i++) {
    const char = val[i];
    if (char === '"') inQuotes = !inQuotes;
    if (char === ',' && !inQuotes) {
      splitVals.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  splitVals.push(current);
  for (const rawItem of splitVals) {
    const cleaned = rawItem.trim().replace(/^"|"$/g, '');
    if (!cleaned) continue;
    const titleCased = cleaned
      .split(/[\s-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
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
  if (REGEX_VALIDATION_TRAILER.test(key)) {
    let v = val.toLowerCase();
    if (VALIDATION_PASS_VALUES.has(v)) v = 'passed';
    else if (VALIDATION_FAIL_VALUES.has(v)) v = 'failed';
    state.metadataObj['validation'] = v;
  } else if (REGEX_REFERENCE_TRAILER.test(key)) {
    if (val) {
      const niceKey = key
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('-');
      state.references.push(`${niceKey}: ${val}`);
    }
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

export function parseTrailersBlock(rawTrailers: string, sha: string): ParsedTrailersResult {
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

  if (rawTrailers) {
    const trailerList = rawTrailers.split('\x1C').filter(Boolean);
    for (const t of trailerList) {
      const colonIdx = t.indexOf(':');
      const keyRaw = colonIdx === -1 ? t.trim() : t.slice(0, colonIdx).trim();
      const key = keyRaw.toLowerCase().replace(/\s+/g, '-');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const rawVal = colonIdx === -1 ? '' : t.slice(colonIdx + 1).trim();
      let val = rawVal.replace(/\r?\n[ \t]+/g, '\n').replace(/\u200B/g, '');
      if (val.length > MAX_TRAILER_LENGTH) {
        val = truncateSafely(val, MAX_TRAILER_LENGTH, '\n...[trailer truncated due to length]');
      }
      state.trailersObj[keyRaw] = val;
      applySingleTrailer(key, val, colonIdx, state);
    }
  }

  enforceMaxArray(state.categories, 'categories', sha);
  enforceMaxArray(state.entriesParsed, 'entriesParsed', sha);
  enforceMaxArray(state.references, 'references', sha);
  enforceMaxArray(state.coAuthors, 'coAuthors', sha);
  enforceMaxArray(state.reviewers, 'reviewers', sha);
  for (const k of Object.keys(state.customTrailers)) {
    enforceMaxArray(state.customTrailers[k], `customTrailers[${k}]`, sha);
  }

  return state;
}
