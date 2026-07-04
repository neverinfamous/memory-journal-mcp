import { expect, test, describe } from "bun:test";
import { PayloadSchema } from "../schema.js";

describe("Payload Validation Schema Types", () => {
  test("Malformed Payloads: should reject string for args (requires array)", () => {
    const payload = {
      type: "command",
      command: "echo",
      args: "hello", // should be array
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test("Malformed Payloads: should reject missing required fields", () => {
    const payload = {
      type: "command",
      // missing 'command'
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test("Malformed Payloads: should reject empty or whitespace-only strings for command", () => {
    const payload1 = { type: "command", command: "" };
    const payload2 = { type: "command", command: "   " };
    expect(PayloadSchema.safeParse(payload1).success).toBe(false);
    expect(PayloadSchema.safeParse(payload2).success).toBe(false);
  });

  test("Malformed Payloads: should reject empty or whitespace-only strings for scriptPath", () => {
    const payload1 = { type: "script", scriptPath: "" };
    const payload2 = { type: "script", scriptPath: "   " };
    expect(PayloadSchema.safeParse(payload1).success).toBe(false);
    expect(PayloadSchema.safeParse(payload2).success).toBe(false);
  });

  test("Malformed Payloads: should reject empty or whitespace-only strings for code", () => {
    const payload1 = { type: "eval", code: "" };
    const payload2 = { type: "eval", code: "   " };
    expect(PayloadSchema.safeParse(payload1).success).toBe(false);
    expect(PayloadSchema.safeParse(payload2).success).toBe(false);
  });

  test("Schema Types: should successfully parse 'command'", () => {
    const payload = {
      type: "command",
      command: "echo",
      args: ["hello"],
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "command") {
      expect(result.data.type).toBe("command");
      expect(result.data.command).toBe("echo");
    }
  });

  test("Schema Types: should successfully parse 'script'", () => {
    const payload = {
      type: "script",
      scriptPath: "./script.sh",
      interpreter: "bash",
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "script") {
      expect(result.data.type).toBe("script");
      expect(result.data.scriptPath).toBe("./script.sh");
    }
  });

  test("Schema Types: should successfully parse 'eval'", () => {
    const payload = {
      type: "eval",
      code: "console.log('hi')",
      interpreter: "node",
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "eval") {
      expect(result.data.type).toBe("eval");
      expect(result.data.code).toBe("console.log('hi')");
    }
  });

  test("Invalid Fields: should reject arbitrary keys (strict mode)", () => {
    const payload = {
      type: "command",
      command: "echo",
      unknownField: "should-be-rejected",
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
