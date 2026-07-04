import { test, expect } from 'bun:test';
import { PayloadSchema } from '../schema.js';

test("Usability Test: Agent-Exec Payload Flags Bypass > Should gracefully parse string booleans due to LLM hallucinations", () => {
  const payload = {
    type: "command",
    command: "vim",
    bypassInterceptors: "true",
    keepPayload: "false",
    expectJsonEnvelope: "true"
  };

  const parsed = PayloadSchema.safeParse(payload);
  expect(parsed.success).toBe(true);
  
  if (parsed.success) {
    expect(parsed.data.bypassInterceptors).toBe(true);
    expect(parsed.data.keepPayload).toBe(false);
    expect(parsed.data.expectJsonEnvelope).toBe(true);
  }
});
