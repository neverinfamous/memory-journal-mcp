import { describe, it, expect } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('Usability Test: Agent-Exec Payload Stdin Limits', () => {
  it('accepts stdin below 10MB limit', () => {
    const payload = {
      type: 'command',
      command: 'findstr',
      stdin: 'a'.repeat(5 * 1024 * 1024),
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects stdin above 10MB limit', () => {
    const payload = {
      type: 'command',
      command: 'findstr',
      stdin: 'a'.repeat(11 * 1024 * 1024),
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
