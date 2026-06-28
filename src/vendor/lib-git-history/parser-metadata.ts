// @ts-nocheck
import { match, P } from 'ts-pattern';

export function extractNumericMetadata(val: string): number | string | undefined {
  const trimmed = val.trim();
  const vLower = trimmed.toLowerCase();

  return match(vLower)
    .with('high', () => 0.8)
    .with('medium', () => 0.5)
    .with('low', () => 0.2)
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
        const matched = match(parsed)
          .with({ status: 'success', data: P.number }, (res) => res.data)
          .with({ status: 'success', data: P.string }, (res) => {
            const num = Number(res.data);
            return !Number.isNaN(num) && Number.isFinite(num) ? num : res.data;
          })
          .with({ data: P.number }, (res) => res.data)
          .with({ data: P.string }, (res) => {
            const num = Number(res.data);
            return !Number.isNaN(num) && Number.isFinite(num) ? num : res.data;
          })
          .with({ status: 'success', data: { trust: P.number } }, (res) => res.data.trust)
          .with({ status: 'success', data: { impact: P.number } }, (res) => res.data.impact)
          .with({ status: 'success', data: { confidence: P.number } }, (res) => res.data.confidence)
          .with({ trust: P.number }, (res) => res.trust)
          .with({ impact: P.number }, (res) => res.impact)
          .with({ confidence: P.number }, (res) => res.confidence)
          .with({ status: 'success', data: { trust: P.string } }, (res) => Number(res.data.trust))
          .with({ status: 'success', data: { impact: P.string } }, (res) => Number(res.data.impact))
          .with({ status: 'success', data: { confidence: P.string } }, (res) => Number(res.data.confidence))
          .with({ trust: P.string }, (res) => Number(res.trust))
          .with({ impact: P.string }, (res) => Number(res.impact))
          .with({ confidence: P.string }, (res) => Number(res.confidence))
          .otherwise(() => undefined);
        if (matched !== undefined && !Number.isNaN(matched)) {
          return (typeof matched === 'number' && !Number.isFinite(matched)) ? undefined : matched;
        }
      } catch {
        const matchedString = match(trimmed)
          .with(P.when((s: string) => /['"]?trust['"]?\s*:\s*['"]?([\d.]+)['"]?/.test(s)), (s: string) => { const m = s.match(/['"]?trust['"]?\s*:\s*['"]?([\d.]+)['"]?/); return m ? Number(m[1]) : undefined; })
          .with(P.when((s: string) => /['"]?impact['"]?\s*:\s*['"]?([\d.]+)['"]?/.test(s)), (s: string) => { const m = s.match(/['"]?impact['"]?\s*:\s*['"]?([\d.]+)['"]?/); return m ? Number(m[1]) : undefined; })
          .with(P.when((s: string) => /['"]?confidence['"]?\s*:\s*['"]?([\d.]+)['"]?/.test(s)), (s: string) => { const m = s.match(/['"]?confidence['"]?\s*:\s*['"]?([\d.]+)['"]?/); return m ? Number(m[1]) : undefined; })
          .with(P.when((s: string) => /['"]?data['"]?\s*:\s*['"]?([\d.]+)['"]?/.test(s)), (s: string) => { const m = s.match(/['"]?data['"]?\s*:\s*['"]?([\d.]+)['"]?/); return m ? Number(m[1]) : undefined; })
          .otherwise(() => undefined);
        
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
