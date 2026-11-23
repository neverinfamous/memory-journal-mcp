// @ts-nocheck
import { z } from 'zod';
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
  const parsedFilters = getParsedCliFilters(args);
  if (parsedFilters.allowedCategories) {
    const allowed = parsedFilters.allowedCategories;
    if (categories && categories.length > 0) {
      if (!categories.some((c) => allowed.has(c.toLowerCase()))) return false;
    } else if (!allowed.has(type ? type.toLowerCase() : 'uncategorized')) {
      return false;
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
  const parsedFilters = getParsedCliFilters(args);
  if (parsedFilters.allowedTypes && (!entry.type || !parsedFilters.allowedTypes.has(entry.type.toLowerCase()))) {
    return false;
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
  const parsedFilters = getParsedCliFilters(args);
  if (parsedFilters.allowedTypes && (!raw.type || !parsedFilters.allowedTypes.has(raw.type.toLowerCase()))) {
    return false;
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

function getParsedNumericFilter(filterString: string): ParsedNumericFilter | null {
  const cached = NUMERIC_FILTER_CACHE.get(filterString);
  if (cached !== undefined) return cached;

  const normalizedFilter = filterString.trim().toLowerCase()
    .replace(/\bhigh\b/g, String(IMPACT_HIGH))
    .replace(/\bmedium\b/g, String(IMPACT_MEDIUM))
    .replace(/\blow\b/g, String(IMPACT_LOW));
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
const finiteNumberSchema = z.union([
  z.number().finite(),
  z.string().trim().regex(FINITE_DECIMAL_RE).transform(Number).refine(Number.isFinite),
]);

const numericSchema = z.union([
  z.object({ status: z.literal('success'), data: finiteNumberSchema }).transform(v => v.data),
  z.object({ data: finiteNumberSchema }).transform(v => v.data),
  z.object({ status: z.literal('success'), data: z.object({ trust: finiteNumberSchema }) }).transform(v => v.data.trust),
  z.object({ status: z.literal('success'), data: z.object({ impact: finiteNumberSchema }) }).transform(v => v.data.impact),
  z.object({ status: z.literal('success'), data: z.object({ confidence: finiteNumberSchema }) }).transform(v => v.data.confidence),
  z.object({ trust: finiteNumberSchema }).transform(v => v.trust),
  z.object({ impact: finiteNumberSchema }).transform(v => v.impact),
  z.object({ confidence: finiteNumberSchema }).transform(v => v.confidence),
]);

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

  const vLower = trimmed.toLowerCase();
  switch (vLower) {
    case 'high': return IMPACT_HIGH;
    case 'medium': return IMPACT_MEDIUM;
    case 'low': return IMPACT_LOW;
    case 'nan':
    case 'infinity':
    case '+infinity':
    case '-infinity': return undefined;
    default: break;
  }

  if (trimmed.includes(':')) {
    const jsonCandidate = firstCode === 123 ? trimmed : `{${trimmed}}`;
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      const zodResult = numericSchema.safeParse(parsed);
      if (zodResult.success && !Number.isNaN(zodResult.data) && Number.isFinite(zodResult.data)) {
        return zodResult.data;
      }
    } catch {
      const matchedString = extractMatch(trimmed, FALLBACK_EXTRACT_REGEX);
      if (matchedString !== undefined && !Number.isNaN(matchedString)) {
        return (typeof matchedString === 'number' && !Number.isFinite(matchedString)) ? undefined : matchedString;
      }
    }
  }

  if (firstCode === 123 || vLower.includes('nan')) {
    return undefined;
  }

  return trimmed;
}
