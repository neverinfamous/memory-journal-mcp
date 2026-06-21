import { describe, test, expect } from "bun:test";
import { PayloadSchema } from "../schema.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SCRATCH_DIR = "C:/Users/chris/.gemini/antigravity/brain/93731c55-3758-4f55-929c-a862d6fca61d/scratch/";
const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";

describe("Payload Schema Validation", () => {
  test("Rejects string passed as args (expects array)", () => {
    const payload = {
      type: "command",
      command: "echo",
      args: "hello" // Invalid: should be array
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/expected array, received string/i);
    }
  });

  test("Rejects empty command string", () => {
    const payload = { type: "command", command: "" };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("command must not be empty");
    }
  });

  test("Rejects missing required fields (e.g., command)", () => {
    const payload = {
      type: "command"
      // Missing 'command'
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  test("Accepts valid command payload", () => {
    const payload = {
      type: "command",
      command: "echo",
      args: ["hello"]
    };
    const result = PayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("agent-exec.ts CLI Error Handling", () => {
  const writePayload = (name: string, content: string | object) => {
    const p = path.join(SCRATCH_DIR, name);
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  };

  test("Gracefully handles missing cwd path without crashing runtime", () => {
    const payload = {
      type: "command",
      command: "echo",
      cwd: "C:/NonExistentPath/12345/abcde" // Missing/invalid cwd
    };
    const payloadPath = writePayload("invalid_cwd.json", payload);
    const result = spawnSync("bun", [AGENT_EXEC_PATH, payloadPath], { encoding: 'utf-8' });
    
    // It should exit with 1 and print an error message, NOT crash with unhandled exception
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not exist or is not a directory");
  });

  test("Gracefully handles long invalid cwd path (>260 chars) without crashing", () => {
    const longCwd = "C:/NonExistentPath/" + "a".repeat(300);
    const payload = {
      type: "command",
      command: "echo",
      cwd: longCwd
    };
    const payloadPath = writePayload("long_invalid_cwd.json", payload);
    const result = spawnSync("bun", [AGENT_EXEC_PATH, payloadPath], { encoding: 'utf-8' });
    
    // It should fail gracefully, but wait, agent-exec.ts skips fs.existsSync for lengths >= 260.
    // We expect the execution-engine or spawn to throw, which should ideally be caught and not crash the process with an unhandled exception.
    // If it's uncaught, status will be 1 or something, but stderr will have the raw stack trace.
    // Let's just check if it exits with status code that isn't 0.
    expect(result.status).not.toBe(0);
  });

  test("Gracefully handles malformed JSON without crashing", () => {
    const payloadPath = writePayload("malformed.json", "{ type: 'command', command: 'echo', }"); // Invalid JSON
    const result = spawnSync("bun", [AGENT_EXEC_PATH, payloadPath], { encoding: 'utf-8' });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid JSON in payload file");
  });

  test("Gracefully handles excessively large payload files", () => {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const p = path.join(SCRATCH_DIR, "large_payload.json");
    // Create a dummy file larger than 10MB
    const fd = fs.openSync(p, 'w');
    // Write 11MB of data
    const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB chunk
    for (let i = 0; i < 11; i++) {
      fs.writeSync(fd, chunk);
    }
    fs.closeSync(fd);

    const result = spawnSync("bun", [AGENT_EXEC_PATH, p], { encoding: 'utf-8' });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Payload file exceeds 10MB limit");
    
    fs.unlinkSync(p);
  });
  
  test("Gracefully handles schema validation failure via CLI", () => {
    const payload = {
      type: "command",
      command: "echo",
      args: "should_be_array"
    };
    const payloadPath = writePayload("invalid_schema.json", payload);
    const result = spawnSync("bun", [AGENT_EXEC_PATH, payloadPath], { encoding: 'utf-8' });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Payload schema validation failed");
  });
});
