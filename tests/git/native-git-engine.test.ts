import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNativeCommitHistory, getUnreleasedChangelog, buildCliArgs, toGitCommit } from '../../src/git/native-git-engine.js';
import * as gitRunner from '../../src/vendor/lib-git-history/git-runner.js';
import * as parser from '../../src/vendor/lib-git-history/parser.js';

vi.mock('../../src/vendor/lib-git-history/git-runner.js', () => ({
    getGitTagRange: vi.fn(),
    streamGitRecords: vi.fn(),
    cleanupProcesses: vi.fn(),
    buildGitBaseArgs: vi.fn(),
    RECORD_SEPARATOR: 'SEP'
}));

vi.mock('../../src/vendor/lib-git-history/parser.js', () => ({
    parseGitRecord: vi.fn(),
    processBatch: vi.fn()
}));

describe('Native Git Engine', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should build CLI args correctly', () => {
        const args = buildCliArgs({ maxCount: 10, author: 'test' });
        expect(args.limit).toBe('10');
        expect(args.author).toBe('test');
    });

    it('should convert CommitEntry to GitCommit', () => {
        const commit = toGitCommit({
            commit: 'abc1234',
            date: '2023-01-01',
            subject: 'Test commit',
            author: 'Test User',
            metadata: {
                category: ['feat'],
                entry: ['Added something new']
            }
        });

        expect(commit.hash).toBe('abc1234');
        expect(commit.trailers['History-Category']).toBe('feat');
        expect(commit.trailers['History-Entry']).toBe('Added something new');
    });

    it('should handle unreleased changelog extraction', async () => {
        vi.mocked(gitRunner.getGitTagRange).mockReturnValue({ range: 'v1..HEAD', isFallback: false, headSha: 'HEAD' });
        vi.mocked(gitRunner.buildGitBaseArgs).mockReturnValue(['log']);
        
        async function* mockStream() {
            yield 'RAW_COMMIT_DATA';
        }
        vi.mocked(gitRunner.streamGitRecords).mockImplementation(mockStream);
        
        vi.mocked(parser.parseGitRecord).mockReturnValue({ sha: 'abc' } as any);
        vi.mocked(parser.processBatch).mockResolvedValue([
            {
                commit: 'abc',
                date: '2023',
                subject: 'Msg',
                author: 'Test',
                type: 'feat',
                metadata: { entry: ['A fix'] }
            }
        ] as any);

        const result = await getUnreleasedChangelog(process.cwd());
        expect(result.range.from).toBe('v1');
        expect(result.range.to).toBe('HEAD');
        expect(result.categories['Feat']).toBeDefined();
        expect(result.totalCount).toBe(1);
    });
});
