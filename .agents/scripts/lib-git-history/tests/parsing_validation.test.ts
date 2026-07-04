import { test, expect, describe } from 'bun:test';
import { parseGitRecord } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser.ts';
import { FIELD_SEPARATOR } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-runner.ts';

function buildCommitBlock({
  sha = '1234567',
  refs = '',
  authorName = 'Test',
  authorEmail = 'test@example.com',
  date = '2026-06-21',
  committerName = 'Test',
  committerEmail = 'test@example.com',
  committerDate = '2026-06-21',
  subject = 'test subject',
  body = '',
  exactTrailerBlock = '',
  rawTrailers = '',
  parentsAndFiles = ''
}: Record<string, string>) {
  return [
    sha, refs, authorName, authorEmail, date, committerName, committerEmail, committerDate, subject, body, exactTrailerBlock, rawTrailers, parentsAndFiles
  ].join(FIELD_SEPARATOR);
}

describe('lib-git-history regex and trailer parsers', () => {
  const defaultArgs: Record<string, string> = {
    'issue-pattern': '#\\d+',
    limit: '10'
  };

  test('gracefully handles missing colons in custom trailers', () => {
    // Malformed custom trailer without a colon
    const rawTrailers = `Valid-Trailer: valid\x1CMalformedTrailerWithoutColon\x1CAnother-Valid: yes`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    // It should skip the malformed one and include the valid ones
    expect(result?.metadataObj.customTrailers).toEqual({
      'valid-trailer': ['valid'],
      'another-valid': ['yes']
    });
  });

  test('gracefully parses nested quotes in category trailers', () => {
    // Category trailer with nested quotes
    const rawTrailers = `history-category: "Core", "Feature ""X""", 'Other'`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    expect(result?.metadataObj.category).toEqual(['Core', 'Feature ""X""', "'Other'"]); 
  });

  test('handles malformed multiline blocks in body breaking changes', () => {
    const body = `Some description

BREAKING-CHANGE:
- Item 1
- Item 2
`;
    const block = buildCommitBlock({ body });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    expect(result?.isBreaking).toBe(true);
    expect(result?.breakingChangeDescription).toBe('- Item 1\n- Item 2');
  });

  test('handles trailers with extensive multiline values (graceful degradation)', () => {
    const hugeValue = Array.from({length: 2000}, () => 'line').join('\n');
    const rawTrailers = `Custom-Huge: ${hugeValue}`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    const parsedHuge = (result?.metadataObj.customTrailers as Record<string, string[]>)?.['custom-huge']?.[0];
    expect(parsedHuge?.length).toBeLessThan(5100);
    expect(parsedHuge).toContain('...[trailer truncated due to length]');
  });

  test('parses validation status trailers accurately', () => {
    const rawTrailers = `validation: ok\x1Chistory-validation: failing\x1Cchangelog-validation-status: unknown`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    // It will overwrite metadataObj.validation for each match. 
    // The last match is changelog-validation-status: unknown
    expect(result?.metadataObj.validation).toBe('unknown');
  });

  test('handles malformed git records gracefully (too few fields)', () => {
    const block = ['just', 'a', 'few', 'fields'].join(FIELD_SEPARATOR);
    const result = parseGitRecord(block, defaultArgs);
    expect(result).toBeNull(); // Should return null for malformed record
  });

  test('safely parses impact and trust with different types of values', () => {
    const rawTrailers = `impact: high\x1Ctrust: 0.99\x1Chistory-impact: low`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    // High becomes 0.8, low becomes 0.2. The last one was history-impact: low
    expect(result?.metadataObj.impact).toBe(0.2);
    expect(result?.metadataObj.trust).toBe(0.99);
  });

  test('extracts issues robustly from subjects with edge characters', () => {
    const subject = `feat(core): fix issue (#123) and #456!`;
    const block = buildCommitBlock({ subject });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    expect(result?.issuesMap.has('#123')).toBe(true);
    expect(result?.issuesMap.has('#456')).toBe(true);
  });
  
  test('gracefully degrades on excessive file status blocks (missing NULs)', () => {
    // Malformed files block without NUL terminators
    const parentsAndFiles = `parentSha\nMfile1.txtMfile2.txt`; 
    const block = buildCommitBlock({ parentsAndFiles });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    // It might misparse files but shouldn't crash
    expect(Array.isArray(result?.rawFiles)).toBe(true);
  });

  test('regex parser tests missing colons with whitespace padding', () => {
    const rawTrailers = `   NoColonTrailer   \x1C  Valid: yes  `;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    expect(result?.metadataObj.customTrailers).toEqual({
      'valid': ['yes']
    });
  });

  test('safely parses deeply nested custom trailers (e.g. array-like)', () => {
    const rawTrailers = `Multi: a\x1CMulti: b\x1CMulti: c`;
    const block = buildCommitBlock({ rawTrailers });
    const result = parseGitRecord(block, defaultArgs);
    
    expect(result).not.toBeNull();
    expect((result?.metadataObj.customTrailers as Record<string, string[]>)?.['multi']).toEqual(['a', 'b', 'c']);
  });

});



