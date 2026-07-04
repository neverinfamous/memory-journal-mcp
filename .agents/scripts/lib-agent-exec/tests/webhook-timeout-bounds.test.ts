import { describe, expect, it } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('Webhook and Stall Timeout Bounds', () => {
  it('should clamp webhookTimeoutMs > 2147483647 to 2147483647', () => {
    const payload = {
      type: 'command',
      command: 'echo',
      webhookTimeoutMs: 2147483648
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.webhookTimeoutMs).toBe(2147483647);
    }
  });

  it('should clamp stallTimeoutMs > 2147483647 to 2147483647', () => {
    const payload = {
      type: 'command',
      command: 'echo',
      stallTimeoutMs: 2147483648
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stallTimeoutMs).toBe(2147483647);
    }
  });
  
  it('should allow valid timeouts', () => {
    const payload = {
      type: 'command',
      command: 'echo',
      webhookTimeoutMs: 100,
      stallTimeoutMs: 0
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
