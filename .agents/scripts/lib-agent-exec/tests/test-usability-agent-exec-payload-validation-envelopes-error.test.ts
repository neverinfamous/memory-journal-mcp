import { expect, test, describe } from "bun:test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

describe("Agent-Exec JSON output on invalid payload", () => {
  const scratchDir = __dirname;
  const payloadPath = path.join(scratchDir, "malformed-test.json");
  const scriptPath = path.resolve(__dirname, "../../agent-exec.ts");

  test("should output a JSON envelope when `--json` is provided and payload is invalid JSON", () => {
    fs.writeFileSync(payloadPath, "{ invalid json }");
    try {
      execSync(`bun ${scriptPath} --json ${payloadPath}`, { encoding: "utf-8", stdio: "pipe" });
      expect().fail("Should have exited with code 1");
    } catch (err: unknown) {
      expect((err as { status?: number }).status).toBe(1);
      const stdout = (err as { stdout?: string }).stdout || "";
      let parsed = false;
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        try {
          const json = JSON.parse(line.trim());
          if (json.status === "error") {
            expect(json.message).toBeDefined();
            parsed = true;
          }
        } catch { /* ignore */ }
      }
      expect(parsed).toBe(true);
    } finally {
      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath);
      }
    }
  });

  test("should output a JSON envelope when `--json` is provided and payload schema is invalid", () => {
    fs.writeFileSync(payloadPath, JSON.stringify({ type: "command" }));
    try {
      execSync(`bun ${scriptPath} --json ${payloadPath}`, { encoding: "utf-8", stdio: "pipe" });
      expect().fail("Should have exited with code 1");
    } catch (err: unknown) {
      expect((err as { status?: number }).status).toBe(1);
      const stdout = (err as { stdout?: string }).stdout || "";
      let parsed = false;
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        try {
          const json = JSON.parse(line.trim());
          if (json.status === "error") {
            expect(json.message).toContain("Payload schema validation failed");
            parsed = true;
          }
        } catch { /* ignore */ }
      }
      expect(parsed).toBe(true);
    } finally {
      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath);
      }
    }
  });
});
