import { describe, expect, test } from 'bun:test';
import { PayloadSchema } from '../schema.ts';

describe('PayloadSchema - templateOverride', () => {
  test('should accept templateOverride', () => {
    const payload = {
      type: "command",
      command: "echo test",
      templateOverride: "custom-template"
    };
    
    expect(() => PayloadSchema.parse(payload)).not.toThrow();
  });
  
  test('should reject very large templateOverride if limits are enforced', () => {
    const payload = {
      type: "command",
      command: "echo test",
      templateOverride: "a".repeat(10000)
    };
    
    // We expect this to fail validation if limits are enforced
    expect(() => PayloadSchema.parse(payload)).toThrow();
  });
});
