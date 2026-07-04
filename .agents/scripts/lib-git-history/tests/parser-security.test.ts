import { parseGitRecord } from '../parser.js';
import { FIELD_SEPARATOR } from '../git-runner.js';
import type { CliArgs } from '../cli.js';
import { test, expect } from 'bun:test';

const defaultFields = [
  'sha123', '', 'Author Name', 'author@example.com', '2023-01-01T00:00:00Z', 'Committer Name', 'committer@example.com', '2023-01-01T00:00:00Z', 'fix: subject line', 'body text', '', '', 'parents\n'
];

function runTest(fields: string[]) {
  return parseGitRecord(fields.join(FIELD_SEPARATOR), { target: "wsl2" } as CliArgs);
}

test('ReDoS with odd number of quotes in history-category', () => {
    const fields = [...defaultFields];
    let payload = "";
    for (let i = 0; i < 5000; i++) payload += "foo, ";
    payload += '"unmatched quote';
    fields[11] = `history-category: ${payload}`;
    
    const start = Date.now();
    runTest(fields);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
});

test('NUL flood in parentsAndFiles', () => {
    const fields = [...defaultFields];
    fields[12] = "parents\n" + "\x00".repeat(50000);
    const res = runTest(fields);
    expect(res).not.toBeNull();
});

test('Missing colons and extremely long trailers', () => {
    const fields = [...defaultFields];
    fields[11] = "A".repeat(100000);
    const res = runTest(fields);
    expect(res).not.toBeNull();
});


