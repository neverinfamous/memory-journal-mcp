import { expect, test, describe } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('cwd bounds validation', () => {
  test('rejects object or number', () => {
    const payloadNumber = {
      type: "command",
      command: "echo test",
      cwd: 123
    };
    
    const resNumber = PayloadSchema.safeParse(payloadNumber);
    expect(resNumber.success).toBe(false);

    const payloadObject = {
      type: "command",
      command: "echo test",
      cwd: { path: "/tmp" }
    };
    
    const resObject = PayloadSchema.safeParse(payloadObject);
    expect(resObject.success).toBe(false);
  });
  
  test('rejects extremely long cwd', () => {
    const payloadLong = {
      type: "command",
      command: "echo test",
      cwd: "a".repeat(100000)
    };
    
    const resLong = PayloadSchema.safeParse(payloadLong);
    expect(resLong.success).toBe(false);
  });
});
