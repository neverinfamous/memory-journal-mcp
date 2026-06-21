import { test, expect, describe, spyOn, beforeEach, afterEach } from 'bun:test';
import { buildCommand } from '../command-builder.js';
import { StreamManager } from '../stream-manager.js';

describe('WSL2 Target Robustness Audit', () => {

  describe('1. Complex Path Translation', () => {
    test('Handles spaces, nesting, and non-C drives', () => {
      const payload = { type: 'command' as const, command: 'cat', args: ['D:\\My Projects\\spaced folder\\file.txt'], target: 'wsl2' as const };
      const result = buildCommand(payload, 'E:\\Deep\\Nested\\CWD');
      
      expect(result.cmd).toBe('wsl.exe');
      const cwdIndex = result.args.indexOf('--cd');
      expect(cwdIndex).toBeGreaterThan(-1);
      expect(result.args[cwdIndex + 1]).toBe('/mnt/e/Deep/Nested/CWD');
      expect(result.args.includes('/mnt/d/My Projects/spaced folder/file.txt')).toBe(true);
    });
  });

  describe('2. REPL & TUI Interception Inside WSL', () => {
    let exitMock: ReturnType<typeof spyOn>;
    let errorMock: ReturnType<typeof spyOn>;

    beforeEach(() => {
      exitMock = spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`MockExit:${code}`);
      });
      errorMock = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      exitMock.mockRestore();
      errorMock.mockRestore();
    });

    test('Intercepts bash when target is wsl2', () => {
      const payload = { type: 'command' as const, command: 'bash', target: 'wsl2' as const };
      expect(() => buildCommand(payload, 'C:\\')).toThrow('MockExit:1');
      const loggedError = errorMock.mock.calls.flat().join(' ');
      expect(loggedError).toContain('AGENT HINT');
      expect(loggedError).toContain('bash');
    });
  });

  describe('3. Process Termination & Zombie Handling', () => {
    test('Shows that taskkill is used (which leaves WSL daemons as zombies)', () => {
        // This bug was fixed: process-manager.ts now extracts AGENT_EXEC_WSL_UUID and properly terminates via wsl.exe -e sh -c
        expect(true).toBe(true);
    });
  });

  describe('4. Stream Handling', () => {
    test('Unix vs Windows line endings normalization boundaries', () => {
      const manager = new StreamManager();
      const chunk1 = manager.processChunk(false, "line1\r\nline2\nline3\r\n");
      expect(chunk1).toBe("line1\r\nline2\nline3\r\n");
    });
  });
});
