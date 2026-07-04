import { expect, test, describe } from "bun:test";
import { PayloadSchema } from "../schema.js";

describe("Agent-Exec Payload Validation - Command", () => {
  test("rejects empty command string", () => {
    const payload = {
      type: "command",
      command: ""
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("command must not be empty");
    }
  });

  test("rejects whitespace-only command string", () => {
    const payload = {
      type: "command",
      command: "   "
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
  
  test("rejects missing command field", () => {
    const payload = {
      type: "command"
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
