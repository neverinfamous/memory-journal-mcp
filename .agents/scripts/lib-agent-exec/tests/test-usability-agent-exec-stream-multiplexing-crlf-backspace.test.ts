import { expect, test, describe } from 'bun:test';
import { StreamManager } from '../stream-manager.js';

describe('StreamManager backspace and carriage return linear resolution', () => {
  test('should resolve carriage returns in a single chunk linearly', () => {
    const sm = new StreamManager();
    const out = sm.processChunk(false, "Progress: 10%\rProgress: 50%\rProgress: 100%\nDone!");
    expect(out).toBe("Progress: 100%\n");
  });

  test('should handle backspaces across boundaries', () => {
    const sm = new StreamManager();
    sm.processChunk(false, "Loadi");
    // Simulate flush
    sm.flushPendingLine(false);
    const out = sm.processChunk(false, "\b\b\b\b\bDone!\n");
    // 'Done!' overwrites 'Loadi', leaving 'ng...'
    expect(out).toBe("\rDone!\n");
  });

  test('should handle flushing correctly with carriage returns', () => {
    const sm = new StreamManager();
    const out1 = sm.processChunk(false, "Loading...\r");
    const flushed = sm.flushPendingLine(false);
    expect(out1 + flushed).toBe("Loading...");
    
    // The line buffer should be preserved. Next chunk is 'Done!'
    const out2 = sm.processChunk(false, "Done!\n");
    // Since it diverged from flushed, it prepends \r
    expect(out2).toBe("\rDone!ng...\n");
  });
});
