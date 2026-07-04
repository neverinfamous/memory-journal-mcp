import { describe, it, expect } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('Usability Test: Agent-Exec Payload Stdin Limits', () => {
  it('accepts stdin with null bytes', () => {
    const payload = {
      type: 'command',
      command: 'findstr',
      stdin: 'valid\0input',
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
