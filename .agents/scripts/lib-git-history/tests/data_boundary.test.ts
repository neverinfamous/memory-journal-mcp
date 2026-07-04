import { expect, test, describe } from 'bun:test';
import { entrySchema } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/schema.ts';
import { parseGitRecord, processBatch, RawCommitBatchItem } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser.ts';
import { FIELD_SEPARATOR } from 'C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-runner.ts';

describe('Zod Boundary Limits', () => {
  const baseEntry = {
    commit: 'a1b2c3d4e5f6',
    author: 'Test Author',
    date: new Date().toISOString(),
    subject: 'Initial commit',
  };

  test('should reject NaN for integer fields', () => {
    const entry = {
      ...baseEntry,
      totalInsertions: NaN,
      totalDeletions: NaN,
    };
    const result = entrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  test('should reject Infinity for integer fields', () => {
    const entry = {
      ...baseEntry,
      totalInsertions: Infinity,
      totalDeletions: Infinity,
    };
    const result = entrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  test('should reject NaN and Infinity in files array', () => {
    const entry = {
      ...baseEntry,
      files: [{
        status: 'M',
        file: 'test.ts',
        similarityScore: NaN,
        insertions: Infinity,
      }]
    };
    const result = entrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });
});

describe('Trailer Metadata NaN/Infinity Handling', () => {
  test('should not parse NaN/Infinity as numeric impact/trust', () => {
    const parts = [
      'a1b2c3d', '', 'Author', 'email', 'date', 'Committer', 'email', 'date',
      'Subject',
      'Body',
      'history-impact: NaN\x1Chistory-trust: Infinity', 
      'history-impact: NaN\x1Chistory-trust: Infinity', 
      'M\0file.txt\0'
    ];
    const commitBlock = parts.join(FIELD_SEPARATOR);
    const result = parseGitRecord(commitBlock, {});
    expect(result).not.toBeNull();
    // It should safely reject non-finite numbers
    expect(result?.metadataObj.impact).toBeUndefined();
    expect(result?.metadataObj.trust).toBeUndefined();
  });
});

describe('Malformed Unicode and Emojis', () => {
  test('should parse commit with emojis in subject and body', () => {
    const parts = [
      'a1b2c3d', '', 'Author 🚀', 'email', 'date', 'Committer 👨‍💻', 'email', 'date',
      '✨ feat: add new feature 🚀',
      'This feature is awesome! 🦄\n\nIt works like magic ✨.',
      '', '', 'M\0test.ts\0'
    ];
    const commitBlock = parts.join(FIELD_SEPARATOR);
    const result = parseGitRecord(commitBlock, {});
    expect(result).not.toBeNull();
    expect(result?.subject).toBe('✨ feat: add new feature 🚀');
    expect(result?.body).toContain('🦄');
  });

  test('should parse malformed unicode without crashing', () => {
    const malformed = Buffer.from('malformed \xff\xfe unicode \x00', 'binary').toString();
    const parts = [
      'a1b2c3e', '', 'Author', 'email', 'date', 'Committer', 'email', 'date',
      'Subject',
      malformed,
      '', '', 'M\0file.txt\0'
    ];
    const commitBlock = parts.join(FIELD_SEPARATOR);
    const result = parseGitRecord(commitBlock, {});
    expect(result).not.toBeNull();
  });
});

describe('UTF-16 BOMs and Encodings', () => {
  test('should handle UTF-16 BOM in text fields', () => {
    const bom = '\uFEFF';
    const parts = [
      'a1b2c3f', '', 'Author', 'email', 'date', 'Committer', 'email', 'date',
      bom + 'Subject with BOM',
      'Body with BOM ' + bom,
      '', '', 'M\0file.txt\0'
    ];
    const commitBlock = parts.join(FIELD_SEPARATOR);
    const result = parseGitRecord(commitBlock, {});
    expect(result).not.toBeNull();
  });
});

describe('Mixed Carriage Returns', () => {
  test('should normalize mixed carriage returns in body', () => {
    const parts = [
      'a1b2c4a', '', 'Author', 'email', 'date', 'Committer', 'email', 'date',
      'Subject\r',
      'Line 1\r\nLine 2\nLine 3\r\rLine 4\r\n\r\nLine 5',
      '', '', 'M\0file.txt\0'
    ];
    const commitBlock = parts.join(FIELD_SEPARATOR);
    const result = parseGitRecord(commitBlock, {});
    expect(result).not.toBeNull();
    expect(result?.subject).toBe('Subject');
    expect(result?.body).toBe('Line 1\nLine 2\nLine 3\r\rLine 4\n\nLine 5');
  });
});

describe('processBatch Validation Errors', () => {
  test('should coerce corrupted entry and capture validationErrors', async () => {
    const batch: RawCommitBatchItem[] = [{
      sha: 'a1b2c3d', parents: [], refs: [], tags: [], authorName: 'Author', authorEmail: '',
      date: new Date().toISOString(), committerName: '', committerEmail: '', committerDate: '',
      subject: 'Subject', body: 'Body', cleanSubject: 'Subject', type: undefined, scope: undefined,
      isBreaking: false, breakingChangeDescription: undefined, isRevert: false, revertedCommit: undefined,
      rawFiles: [{ status: 'M', file: 'test.ts', similarityScore: NaN }], // NaN should trigger failure
      trailersObj: Object.create(null), metadataObj: {}, references: [], coAuthors: [], reviewers: [], issuesMap: new Map(), trueFileCount: 1
    }];
    
    const processed = await processBatch(batch, {}, []);
    expect(processed.length).toBe(1);
    
    // We expect the parser to drop the offending field (the 'files' array in this case, 
    // because path[0] is 'files' and it deletes coercedObj.files)
    // Wait, let's see what happens if similarityScore is NaN.
    // It's a file Status Schema issue.
    // parseResult.error.issues path will be ["files", 0, "similarityScore"]
    
    // Wait, if it's 3 levels deep: "files", 0, "similarityScore"
    // The fallback logic says:
    // else if (issue.path[0] === 'files') { delete coercedObj.files; }
    // So 'files' should be stripped out.
    
    expect(processed[0].files).toBeUndefined();
    expect(processed[0].validationErrors).toBeDefined();
    expect(processed[0].validationErrors?.length).toBeGreaterThan(0);
  });
});


