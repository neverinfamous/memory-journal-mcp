// @ts-nocheck
import type { CliArgs } from './cli.js';
import { IMPACT_HIGH, IMPACT_MEDIUM, IMPACT_LOW } from './constants.js';

export interface ParsedCliFilters {
  allowedCategories?: Set<string>;
  allowedTypes?: Set<string>;
}

const CLI_FILTER_CACHE = new WeakMap<CliArgs, ParsedCliFilters>();
export const CHANGELOG_TYPES: ReadonlySet<string> = new Set(['feat', 'fix', 'perf', 'revert']);

export function getParsedCliFilters(args: CliArgs): ParsedCliFilters {
  let cached = CLI_FILTER_CACHE.get(args);
  if (cached) return cached;
  cached = {};
  if (args.category) {
    cached.allowedCategories = new Set(args.category.split(',').map((c) => c.trim().toLowerCase()));
  }
  if (args.type) {
    cached.allowedTypes = new Set(args.type.split(',').map((t) => t.trim().toLowerCase()));
  }
  CLI_FILTER_CACHE.set(args, cached);
  return cached;
}

export function hasTsPostFilters(args: CliArgs): boolean {
  return Boolean(args.category || args.type || args.breaking || args['changelog-only'] || args.impact || args.confidence);
}

export function matchesTrailerFilters(
  args: CliArgs,
  categories: readonly string[] | undefined,
  type: string | undefined,
  metadataObj: Readonly<{ impact?: unknown; confidence?: unknown }> | undefined,
): boolean {
  if (args.category) {
    const allowed = getParsedCliFilters(args).allowedCategories;
    if (allowed) {
      if (categories && categories.length > 0) {
        if (!categories.some((c) => allowed.has(c.toLowerCase()))) return false;
      } else if (!allowed.has(type ? type.toLowerCase() : 'uncategorized')) {
        return false;
      }
    }
  }
  if (args['impact']) {
    const rawImpact = metadataObj?.impact;
    if (!evaluateNumericFilter(args['impact'], typeof rawImpact === 'number' ? rawImpact : undefined)) return false;
  }
  if (args['confidence']) {
    const rawConfidence = metadataObj?.confidence;
    if (!evaluateNumericFilter(args['confidence'], typeof rawConfidence === 'number' ? rawConfidence : undefined)) return false;
  }
  return true;
}

export interface FilterableCommitEntry {
  type?: string | undefined;
  isBreaking?: boolean | undefined;
  metadata?: Readonly<{
    category?: readonly string[] | undefined;
    entry?: readonly string[] | undefined;
    impact?: unknown;
    confidence?: unknown;
  }> | undefined;
}

export function matchesCommitEntryFilters(entry: FilterableCommitEntry, args: CliArgs): boolean {
  if (args.type) {
    const allowedTypes = getParsedCliFilters(args).allowedTypes;
    if (allowedTypes && (!entry.type || !allowedTypes.has(entry.type.toLowerCase()))) {
      return false;
    }
  }
  const meta = entry.metadata;
  if (!matchesTrailerFilters(args, meta?.category, entry.type, meta)) return false;
  const isBreaking = Boolean(entry.isBreaking);
  if (args.breaking && !isBreaking) return false;
  const hasEntry = Boolean(meta?.entry && meta.entry.length > 0);
  if (args['changelog-only'] && !hasEntry && !(CHANGELOG_TYPES.has((entry.type ?? '').toLowerCase()) || isBreaking)) {
    return false;
  }
  return true;
}

export function matchesRawRecordFilters(
  raw: { type: string | undefined; isBreaking: boolean; metadataObj: Record<string, unknown> },
  args: CliArgs,
): boolean {
  if (args.type) {
    const allowedTypes = getParsedCliFilters(args).allowedTypes;
    if (allowedTypes && (!raw.type || !allowedTypes.has(raw.type.toLowerCase()))) {
      return false;
    }
  }
  const rawCats = raw.metadataObj['category'];
  const cats = Array.isArray(rawCats) ? (rawCats as readonly string[]) : undefined;
  if (!matchesTrailerFilters(args, cats, raw.type, raw.metadataObj)) return false;
  if (args.breaking && !raw.isBreaking) return false;
  const rawEntries = raw.metadataObj['entry'];
  const hasEntry = Array.isArray(rawEntries) && rawEntries.length > 0;
  if (args['changelog-only'] && !hasEntry && !(CHANGELOG_TYPES.has((raw.type ?? '').toLowerCase()) || raw.isBreaking)) {
    return false;
  }
  return true;
}

interface ParsedNumericFilter {
  op: '>' | '>=' | '<' | '<=' | '==' | '=';
  val: number;
}

const NUMERIC_FILTER_CACHE = new Map<string, ParsedNumericFilter | null>();
const MAX_FILTER_CACHE_SIZE = 64;
const NUMERIC_FILTER_REGEX = /^(>=|<=|>|<|==|=)?\s*(-?\d+(?:\.\d+)?)$/;
const FALLBACK_EXTRACT_REGEX = /['"]?(?:trust|impact|confidence|data)['"]?\s*:\s*['"]?([\d.]+)['"]?/;
const HIGH_WORD_RE = /\bhigh\b/g;
const MEDIUM_WORD_RE = /\bmedium\b/g;
const LOW_WORD_RE = /\blow\b/g;

function getParsedNumericFilter(filterString: string): ParsedNumericFilter | null {
  const cached = NUMERIC_FILTER_CACHE.get(filterString);
  if (cached !== undefined) return cached;

  const normalizedFilter = filterString.trim().toLowerCase()
    .replace(HIGH_WORD_RE, String(IMPACT_HIGH))
    .replace(MEDIUM_WORD_RE, String(IMPACT_MEDIUM))
    .replace(LOW_WORD_RE, String(IMPACT_LOW));
  const matchObj = normalizedFilter.match(NUMERIC_FILTER_REGEX);
  let parsed: ParsedNumericFilter | null = null;
  if (matchObj) {
    const rawOp = matchObj[1] || '==';
    const val = parseFloat(matchObj[2] ?? '0');
    if (rawOp === '>' || rawOp === '>=' || rawOp === '<' || rawOp === '<=' || rawOp === '==' || rawOp === '=') {
      parsed = { op: rawOp, val };
    }
  }
  if (NUMERIC_FILTER_CACHE.size >= MAX_FILTER_CACHE_SIZE) {
    NUMERIC_FILTER_CACHE.clear();
  }
  NUMERIC_FILTER_CACHE.set(filterString, parsed);
  return parsed;
}

export function evaluateNumericFilter(filterString: string, recordValue: number | undefined): boolean {
  if (recordValue === undefined) return false;
  const parsed = getParsedNumericFilter(filterString);
  if (!parsed) return false;
  switch (parsed.op) {
    case '>': return recordValue > parsed.val;
    case '>=': return recordValue >= parsed.val;
    case '<': return recordValue < parsed.val;
    case '<=': return recordValue <= parsed.val;
    case '==':
    case '=': return recordValue === parsed.val;
    default: return false;
  }
}

// [INVARIANT]: Require literal dot before fractional digits so `\d+` and `\d*` never overlap (prevents O(N^2) backtracking).
const FINITE_DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (FINITE_DECIMAL_RE.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const getOwn = (rec: Record<string, unknown>, key: string): unknown => (Object.hasOwn(rec, key) ? rec[key] : undefined);

function extractStructuredNumber(parsed: unknown): number | undefined {
  if (!isPlainRecord(parsed)) return undefined;
  const rawData = getOwn(parsed, 'data');
  const directData = toFiniteNumber(rawData);
  if (directData !== undefined) return directData;
  if (getOwn(parsed, 'status') === 'success' && isPlainRecord(rawData)) {
    const nested = toFiniteNumber(getOwn(rawData, 'trust')) ?? toFiniteNumber(getOwn(rawData, 'impact')) ?? toFiniteNumber(getOwn(rawData, 'confidence'));
    if (nested !== undefined) return nested;
  }
  return toFiniteNumber(getOwn(parsed, 'trust')) ?? toFiniteNumber(getOwn(parsed, 'impact')) ?? toFiniteNumber(getOwn(parsed, 'confidence'));
}

const extractMatch = (s: string, regex: RegExp) => {
  const m = s.match(regex);
  return (m && m[1] !== undefined) ? Number(m[1]) : undefined;
};

export function extractNumericMetadata(val: string): number | string | undefined {
  const trimmed = val.trim();
  if (trimmed === '') return undefined;

  // [INTENT]: Fast-path numeric trailer strings (e.g., "0.8", "1", "-5") before lowercasing or JSON parsing.
  const firstCode = trimmed.charCodeAt(0);
  if ((firstCode >= 48 && firstCode <= 57) || firstCode === 45 || firstCode === 43 || firstCode === 46) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return Number.isFinite(n) ? n : undefined;
  }

  if (trimmed.length <= 8) {
    switch (trimmed.toLowerCase()) {
      case 'high': return IMPACT_HIGH;
      case 'medium': return IMPACT_MEDIUM;
      case 'low': return IMPACT_LOW;
      case 'nan':
      case 'infinity': return undefined;
      default: break;
    }
  }

  if (trimmed.includes(':')) {
    let runFallback = firstCode !== 123 && firstCode !== 34;
    if (!runFallback) {
      const jsonCandidate = firstCode === 123 ? trimmed : `{${trimmed}}`;
      try {
        const parsed: unknown = JSON.parse(jsonCandidate);
        const extracted = extractStructuredNumber(parsed);
        if (extracted !== undefined && !Number.isNaN(extracted) && Number.isFinite(extracted)) return extracted;
      } catch {
        runFallback = true;
      }
    }
    if (runFallback) {
      const matchedString = extractMatch(trimmed, FALLBACK_EXTRACT_REGEX);
      if (matchedString !== undefined && !Number.isNaN(matchedString)) {
        return (typeof matchedString === 'number' && !Number.isFinite(matchedString)) ? undefined : matchedString;
      }
    }
  }

  if (firstCode === 123 || trimmed.toLowerCase().includes('nan')) {
    return undefined;
  }

  return trimmed;
}
