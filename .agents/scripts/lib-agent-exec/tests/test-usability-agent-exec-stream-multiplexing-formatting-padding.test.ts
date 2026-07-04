import { describe, it, expect } from 'bun:test';
import { StreamManager } from '../stream-manager.js';

describe('StreamManager Formatting Padding', () => {
  it('should pad with spaces to clear trailing characters when line is truncated (e.g. by ANSI Erase Line stripped to \\u001A)', () => {
    const manager = new StreamManager();
    // Simulate first chunk without newline
    manager.processChunk(false, 'Downloading 100%...');
    const flush1 = manager.flushPendingLine(false);
    expect(flush1).toBe('Downloading 100%...');
    
    // Simulate \r, "Done", and an ANSI Erase in Line (\x1b[K) which stripAnsi converts to \u001A
    manager.processChunk(false, '\rDone\u001A');
    const flush2 = manager.flushPendingLine(false);
    
    // The expected output should use \r, then "Done", then enough spaces to overwrite the rest of "Downloading 100%...", then \r and "Done".
    // "Downloading 100%..." is 19 chars. "Done" is 4 chars. So 15 spaces of padding.
    expect(flush2).toContain('               '); // 15 spaces
    expect(flush2.endsWith('\rDone')).toBe(true);
  });
});
