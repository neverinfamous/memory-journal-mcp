import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { parseGitRecord } from '../parser.js';
import { streamGitRecords, FIELD_SEPARATOR } from '../git-runner.js';
import type { CliArgs } from '../cli.js';
import * as child_process from 'node:child_process';
import { EventEmitter } from 'node:events';

describe('System & Environment Stability Tests', () => {

  describe('parser - Extreme Path Lengths and Spaces', () => {
    it('handles extreme path lengths', () => {
      const longPath = 'a/'.repeat(500) + 'file.txt';
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}Body${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n` + 
      `M\0${longPath}\0`;

      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      expect(result).not.toBeNull();
      expect(result?.rawFiles).toHaveLength(1);
      expect(result?.rawFiles[0].file).toBe(longPath);
    });

    it('handles paths with spaces', () => {
      const spacePath = 'this is a path/with   spaces/in it.txt';
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}Body${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n` + 
      `A\0${spacePath}\0`;

      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      expect(result).not.toBeNull();
      expect(result?.rawFiles).toHaveLength(1);
      expect(result?.rawFiles[0].file).toBe(spacePath);
    });
  });

  describe('parser - Complex Git Renames (R100, R050)', () => {
    it('handles R100 (exact rename)', () => {
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}Body${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n` + 
      `R100\0old_file.txt\0new_file.txt\0`;

      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      expect(result).not.toBeNull();
      expect(result?.rawFiles).toHaveLength(1);
      expect(result?.rawFiles[0].status).toBe('R');
      expect(result?.rawFiles[0].similarityScore).toBe(100);
      expect(result?.rawFiles[0].oldFile).toBe('old_file.txt');
      expect(result?.rawFiles[0].file).toBe('new_file.txt');
    });

    it('handles R050 (partial rename)', () => {
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}Body${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n` + 
      `R050\0old_file.txt\0new_file.txt\0`;

      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      expect(result).not.toBeNull();
      expect(result?.rawFiles).toHaveLength(1);
      expect(result?.rawFiles[0].status).toBe('R');
      expect(result?.rawFiles[0].similarityScore).toBe(50);
      expect(result?.rawFiles[0].oldFile).toBe('old_file.txt');
      expect(result?.rawFiles[0].file).toBe('new_file.txt');
    });

    it('handles combined diff rename/modify formats', () => {
      // In combined diffs, Git might omit the old path if it's a multi-parent rename/copy that's complex
      // Or status might be MM or RM
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}Body${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n` + 
      `RM\0old_file.txt\0new_file.txt\0`;

      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      expect(result).not.toBeNull();
      expect(result?.rawFiles).toHaveLength(1);
      // Let's see what the implementation actually does
    });
  });

  describe('runner - Missing System Binaries and Timeouts', () => {
    let spawnSpy: ReturnType<typeof spyOn>;

    afterEach(() => {
      if (spawnSpy) spawnSpy.mockRestore();
    });

    it('throws when git binary is missing', async () => {
      spawnSpy = spyOn(child_process, 'spawn').mockImplementation((_cmd: string, _argsOrOptions?: readonly string[] | child_process.SpawnOptions, _options?: child_process.SpawnOptions) => {
        const err = new Error('spawn git ENOENT');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        throw err;
      });

      const stream = streamGitRecords(['log']);
      let error: unknown;
      try {
        await stream.next();
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect((error as Error)?.message).toContain('GitExecutableNotFound');
    });

    it('handles process killed with SIGKILL', async () => {
      spawnSpy = spyOn(child_process, 'spawn').mockImplementation(((_cmd: string, _argsOrOptions?: readonly string[] | child_process.SpawnOptions, _options?: child_process.SpawnOptions) => {
        const proc = new EventEmitter();
        const procRec = proc as unknown as Record<string, unknown>;
        procRec.stdout = {
          setEncoding: () => {},
          [Symbol.asyncIterator]: async function* () {
            yield 'some output';
            proc.emit('close', null, 'SIGKILL');
          }
        };
        procRec.stderr = {
          setEncoding: () => {},
          on: () => {}
        };
        procRec.kill = () => { procRec.killed = true; return true; };
        procRec.killed = false;
        return proc as unknown as ReturnType<typeof child_process.spawn>;
      }) as unknown as typeof child_process.spawn);

      const stream = streamGitRecords(['log']);
      let error: unknown;
      try {
        for await (const _chunk of stream) {
          void _chunk;
          // just drain
        }
      } catch (err) {
        error = err;
      }
      expect(error).toBeDefined();
      expect((error as Error)?.message).toContain('SIGKILL');
    });
  });

  describe('parser - Security and Performance Limits', () => {
    it('handles massive body without ReDoS (BREAKING CHANGE regex)', () => {
      const bodyPart = 'A'.repeat(50000);
      const commitBlock = `SHA123${FIELD_SEPARATOR}refs${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20${FIELD_SEPARATOR}Subject${FIELD_SEPARATOR}BREAKING CHANGE: ${bodyPart}${FIELD_SEPARATOR}${FIELD_SEPARATOR}${FIELD_SEPARATOR}PARENT\n`;
      
      const start = performance.now();
      const result = parseGitRecord(commitBlock, { target: "wsl2" } as CliArgs);
      const duration = performance.now() - start;
      
      expect(result).not.toBeNull();
      expect(result?.isBreaking).toBe(true);
      expect(duration).toBeLessThan(100); // Should be very fast
    });
  });


});


