import { describe, it, expect } from 'bun:test';
import { PayloadSchema } from '../schema.js';

describe('Usability: Agent-Exec Payload env property with primitives', () => {
  it('should coerce numbers and booleans to strings in the env property', () => {
    const payload = {
      type: "command",
      command: "pwsh",
      args: ["-c", "echo $env:MY_VAR"],
      env: {
        "MY_VAR_NUM": 123,
        "MY_VAR_BOOL": true,
        "MY_VAR_STR": "hello"
      }
    };

    const parseResult = PayloadSchema.safeParse(payload);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      expect(parseResult.data.env?.MY_VAR_NUM).toBe("123");
      expect(parseResult.data.env?.MY_VAR_BOOL).toBe("true");
      expect(parseResult.data.env?.MY_VAR_STR).toBe("hello");
    }
  });

  it('should reject objects and arrays in the env property', () => {
    const payload1 = {
      type: "command",
      command: "pwsh",
      env: {
        "MY_VAR": { nested: "value" }
      }
    };
    
    const payload2 = {
      type: "command",
      command: "pwsh",
      env: {
        "MY_VAR": ["array"]
      }
    };

    expect(PayloadSchema.safeParse(payload1).success).toBe(false);
    expect(PayloadSchema.safeParse(payload2).success).toBe(false);
  });
});
