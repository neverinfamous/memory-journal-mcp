// @ts-nocheck
import { z } from 'zod';
import { IMPACT_HIGH, IMPACT_MEDIUM, IMPACT_LOW } from './constants.js';

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

const FINITE_DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
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

  if (trimmed !== '') {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return Number.isFinite(n) ? n : undefined;
  }

  const jsonCandidate = trimmed.startsWith('{') ? trimmed : `{${trimmed}}`;

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

  if (trimmed.startsWith('{') || vLower.includes('nan')) {
    return undefined;
  }

  return trimmed !== '' ? trimmed : undefined;
}
