import { describe, it, expect } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('Usability Test: Agent-Exec Payload String Security', () => {
  it('rejects args with null byte, carriage return, and BOM', () => {
    const invalidArgs = ['\0', '\r', '\uFEFF'];
    for (const arg of invalidArgs) {
      const payload = {
        type: 'command',
        command: 'echo',
        args: [arg],
      };
      const result = PayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it('rejects other fields with null byte, carriage return, and BOM', () => {
    const fieldsToTest = [
      'cwd',
      'templateOverride',
      'stdoutFile',
      'stderrFile',
      'onSuccess',
      'onFailure',
    ];
    
    const invalidChars = ['\0', '\r', '\uFEFF'];

    for (const field of fieldsToTest) {
      for (const char of invalidChars) {
        const payload = {
          type: 'command',
          command: 'echo',
          [field]: `invalid${char}string`,
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    }
  });

  it('rejects webhookPayloadTemplate with null byte', () => {
    const invalidChars = ['\0'];

    for (const char of invalidChars) {
      const payload = {
        type: 'command',
        command: 'echo',
        webhookPayloadTemplate: `invalid${char}string`,
      };
      const result = PayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it('allows webhookPayloadTemplate with carriage return and BOM', () => {
    const validChars = ['\r', '\uFEFF'];

    for (const char of validChars) {
      const payload = {
        type: 'command',
        command: 'echo',
        webhookPayloadTemplate: `valid${char}string`,
      };
      const result = PayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    }
  });

  it('rejects webhookMethod with null byte, carriage return, and BOM', () => {
    const invalidChars = ['\0', '\r', '\uFEFF'];

    for (const char of invalidChars) {
      const payload = {
        type: 'command',
        command: 'echo',
        webhookMethod: `POST${char}`,
      };
      const result = PayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });
});
