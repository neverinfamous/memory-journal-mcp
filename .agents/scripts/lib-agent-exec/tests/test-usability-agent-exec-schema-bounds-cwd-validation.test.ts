import { describe, expect, it } from 'bun:test';
import { PayloadSchema } from '../schema.js';
import type { ZodIssue } from 'zod';

describe('PayloadSchema - cwd validation', () => {
  it('should reject a number for cwd', () => {
    const payload = {
      type: 'command',
      command: 'echo hello',
      cwd: 12345
    };

    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);

    if (!result.success) {
      const cwdError = result.error.issues.find((e: ZodIssue) => e.path.includes('cwd'));
      expect(cwdError).toBeDefined();
      expect(cwdError?.code).toBe('invalid_type');
    }
  });

  it('should reject an object for cwd', () => {
    const payload = {
      type: 'command',
      command: 'echo hello',
      cwd: { path: '/tmp' }
    };

    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);

    if (!result.success) {
      const cwdError = result.error.issues.find((e: ZodIssue) => e.path.includes('cwd'));
      expect(cwdError).toBeDefined();
      expect(cwdError?.code).toBe('invalid_type');
    }
  });

  it('should accept a valid string for cwd', () => {
    const payload = {
      type: 'command',
      command: 'echo hello',
      cwd: '/tmp/valid-path'
    };

    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
