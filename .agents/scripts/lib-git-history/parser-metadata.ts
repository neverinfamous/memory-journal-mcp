import { match, P } from 'ts-pattern';
import { z } from 'zod';
import { IMPACT_HIGH, IMPACT_MEDIUM, IMPACT_LOW } from './constants.js';

export function evaluateNumericFilter(filterString: string, recordValue: number | undefined): boolean {
  if (recordValue === undefined) return false;
  const matchObj = filterString.match(/^(>=|<=|>|<|==|=|)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!matchObj) return false;
  const op = matchObj[1] || '==';
  const val = parseFloat(matchObj[2]);
  return match(op)
    .with('>', () => recordValue > val)
    .with('>=', () => recordValue >= val)
    .with('<', () => recordValue < val)
    .with('<=', () => recordValue <= val)
    .with('==', '=', () => recordValue === val)
    .otherwise(() => false);
}

const numericSchema = z.union([
  z.object({ status: z.literal('success'), data: z.number() }).transform(v => v.data),
  z.object({ status: z.literal('success'), data: z.string().transform(Number) }).transform(v => v.data),
  z.object({ data: z.number() }).transform(v => v.data),
  z.object({ data: z.string().transform(Number) }).transform(v => v.data),
  z.object({ status: z.literal('success'), data: z.object({ trust: z.coerce.number() }) }).transform(v => v.data.trust),
  z.object({ status: z.literal('success'), data: z.object({ impact: z.coerce.number() }) }).transform(v => v.data.impact),
  z.object({ status: z.literal('success'), data: z.object({ confidence: z.coerce.number() }) }).transform(v => v.data.confidence),
  z.object({ trust: z.coerce.number() }).transform(v => v.trust),
  z.object({ impact: z.coerce.number() }).transform(v => v.impact),
  z.object({ confidence: z.coerce.number() }).transform(v => v.confidence)
]);

const extractMatch = (s: string, regex: RegExp) => {
  const m = s.match(regex);
  return (m && m[1] !== undefined) ? Number(m[1]) : undefined;
};

export function extractNumericMetadata(val: string): number | string | undefined {
  const trimmed = val.trim();
  const vLower = trimmed.toLowerCase();

  return match(vLower)
    .with('high', () => IMPACT_HIGH)
    .with('medium', () => IMPACT_MEDIUM)
    .with('low', () => IMPACT_LOW)
    .with(P.union('nan', 'infinity', '-infinity'), () => undefined)
    .otherwise(() => {
      const n = Number(trimmed);
      if (!Number.isNaN(n) && trimmed !== '') return n;

      let jsonCandidate = trimmed;
      if (!jsonCandidate.startsWith('{')) {
        jsonCandidate = `{${jsonCandidate}}`;
      }

      try {
        const parsed = JSON.parse(jsonCandidate);
        const zodResult = numericSchema.safeParse(parsed);
        if (zodResult.success && !Number.isNaN(zodResult.data) && Number.isFinite(zodResult.data)) {
          return zodResult.data;
        }
      } catch {
        const regex = /['"]?(?:trust|impact|confidence|data)['"]?\s*:\s*['"]?([\d.]+)['"]?/;
        const matchedString = extractMatch(trimmed, regex);
        
        if (matchedString !== undefined && !Number.isNaN(matchedString)) {
          return (typeof matchedString === 'number' && !Number.isFinite(matchedString)) ? undefined : matchedString;
        }
      }

      if (trimmed.startsWith('{') || trimmed.toLowerCase().includes('nan')) {
        return undefined;
      }
      
      return trimmed !== '' ? trimmed : undefined;
    });
}
