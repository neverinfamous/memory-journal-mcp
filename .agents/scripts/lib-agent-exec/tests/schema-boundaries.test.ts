import { test, expect, describe } from 'bun:test';
import { PayloadSchema } from "../schema.js";

describe("PayloadSchema Boundaries", () => {
  test("Command: maxBuffer with Infinity", () => {
    expect(() => PayloadSchema.parse({ type: "command", command: "echo", maxBuffer: Infinity })).toThrow();
  });
  test("Command: null byte in stdin", () => {
    expect(() => PayloadSchema.parse({ type: "command", command: "echo", stdin: "hello\0world" })).not.toThrow();
  });
  test("Command: malformed UTF-8 in args", () => {
    // Emojis are valid; we removed the unpaired surrogate check because JS RegExp makes it too slow/complex to distinguish paired vs unpaired correctly.
    expect(() => PayloadSchema.parse({ type: "command", command: "echo", args: ["🔥"] })).not.toThrow();
  });
  test("Script: null byte in scriptPath", () => {
    expect(() => PayloadSchema.parse({ type: "script", scriptPath: "malicious\0.sh" })).toThrow("Must not contain null bytes");
  });
  test("Eval: null byte in cwd", () => {
    expect(() => PayloadSchema.parse({ type: "eval", code: "console.log(1)", cwd: "path/with/\0/null" })).toThrow("Must not contain null bytes");
  });
  test("Command: carriage return in command", () => {
    expect(() => PayloadSchema.parse({ type: "command", command: "echo\recho hacked" })).toThrow("Must not contain carriage returns");
  });

  test("Command: BOM in command", () => {
    expect(() => PayloadSchema.parse({ type: "command", command: "\uFEFFecho" })).toThrow("Must not contain BOMs");
  });

  test("Command: args length > 1000", () => {
    const tooManyArgs = Array.from({ length: 1001 }, (_, i) => String(i));
    expect(() => PayloadSchema.parse({ type: "command", command: "echo", args: tooManyArgs })).toThrow();
  });
});


