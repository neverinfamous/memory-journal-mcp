import { expect, test, describe } from 'bun:test';
import { parseGitRecord } from '../parser.js';
import { FIELD_SEPARATOR } from '../git-runner.js';
import type { CliArgs } from '../cli.js';

function buildRecord(fields: string[]): string {
    return fields.join(FIELD_SEPARATOR);
}

const mockArgs = {} as CliArgs;

describe('parseGitRecord Security and Robustness', () => {
    test('Handles malformed file block with excessive NULs', () => {
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', 'subject',
            'body\n\ncontent', 'trailer', 'trailer',
            'parent1 parent2\n' + 'M\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0file.txt\0'
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.rawFiles.length).toBeLessThanOrEqual(500);
    });

    test('Prevents catastrophic backtracking in BREAKING CHANGE regex', () => {
        const body = "BREAKING CHANGE" + " ".repeat(50000) + "X";
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', 'subject',
            body, '', '', 'parent1\nM\0file.txt\0'
        ];
        const record = buildRecord(fields);
        const start = performance.now();
        const result = parseGitRecord(record, mockArgs);
        const end = performance.now();
        expect(end - start).toBeLessThan(500); 
        expect(result?.isBreaking).toBeTrue();
    });

    test('Handles large text blobs safely', () => {
        const largeBody = "A".repeat(150000);
        const largeSubject = "B".repeat(6000);
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', largeSubject,
            largeBody, '', '', 'parent1\nM\0file.txt\0'
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.subject.length).toBeLessThan(6000);
        expect(result?.body.length).toBeLessThan(150000);
    });

    test('Parses trailers with missing colons', () => {
        const rawTrailers = "X-My-Custom-Trailer\x1CSigned-off-by: person\x1CMy-Valid-Trailer: value"; 
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', 'subject',
            'body', '', rawTrailers, 'parent1\nM\0file.txt\0'
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.metadataObj.customTrailers).toBeDefined();
        expect((result?.metadataObj.customTrailers as Record<string, string[]>)?.['x-my-custom-trailer']).toBeUndefined();
        expect((result?.metadataObj.customTrailers as Record<string, string[]>)?.['my-valid-trailer']?.[0]).toBe("value");
        expect(result?.references.length).toBeGreaterThan(0);
    });

    test('Handles complex nested quotes and trick characters', () => {
        const subject = 'fix(ui): handle "nested \'quotes\'" and \u0000 \x1C 🙃';
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', subject,
            'body with \u0000\u0000\u0000 and 😈', '', '', 'parent1\n'
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.subject).toBe(subject);
    });

    test('Handles excessive file parsing gracefully', () => {
        const statusBlock = Array.from({length: 1000}).map(() => "M\0file.txt\0").join("");
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', 'subject',
            'body', '', '', 'parent1\n' + statusBlock
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.rawFiles.length).toBeLessThanOrEqual(500);
    });

    test('Handles Combined Diff formats with renames safely', () => {
        // Git combined diff format omits old file paths for renames (e.g., RM)
        const filesBlock = "MM\x00file1.ts\x00RM\x00new_file.ts\x00A\x00next_file.ts\x00";
        const fields = [
            'sha', 'refs', 'author', 'email', 'date', 'committer', 'c_email', 'c_date', 'subject',
            'body', '', '', 'parent1 parent2\n' + filesBlock
        ];
        const record = buildRecord(fields);
        const result = parseGitRecord(record, mockArgs);
        expect(result).not.toBeNull();
        expect(result?.rawFiles[0]?.status).toBe("MM");
        expect(result?.rawFiles[0]?.file).toBe("file1.ts");
        expect(result?.rawFiles[1]?.file).toBe("new_file.ts");
        expect(result?.rawFiles[1]?.oldFile).toBeUndefined();
        expect(result?.rawFiles[2]?.file).toBe("next_file.ts");
    });
});


