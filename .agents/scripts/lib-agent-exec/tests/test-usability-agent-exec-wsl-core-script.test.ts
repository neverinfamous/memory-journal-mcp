import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { buildCommand } from "../command-builder.ts";
import type { ExecPayload } from "../schema.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

describe("WSL2 Core Script Integration Tests", () => {
  const scratchDir = path.join(os.tmpdir(), "agent-exec-scratch-test");
  const dummyScript = path.join(scratchDir, "test-script.sh");

  beforeAll(() => {
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    // Bash scripts with CRLF will fail in WSL without auto-healing
    fs.writeFileSync(dummyScript, "#!/bin/bash\r\necho test");
  });

  afterAll(() => {
    if (fs.existsSync(dummyScript)) fs.unlinkSync(dummyScript);
  });

  it("should execute a script in WSL2 when target is wsl2", () => {
    const payload: ExecPayload = {
      type: "script",
      target: "wsl2",
      scriptPath: dummyScript,
    };

    const testCwd = "C:\\Users";
    
    const { cmd, args, tempScriptPath } = buildCommand(payload, testCwd);

    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("bash");
    
    const finalScriptPath = tempScriptPath || dummyScript;
    let expectedWslPath = finalScriptPath.split('\\').join('/');
    const drive = expectedWslPath.charAt(0).toLowerCase();
    expectedWslPath = `/mnt/${drive}/${expectedWslPath.substring(3)}`;
    expect(args).toContain(expectedWslPath);

    // Also verify actual execution output
    const proc = spawnSync(cmd, args, { encoding: "utf8" });
    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toBe("test");
  });

  it("should correctly resolve relative scriptPaths against the provided cwd", () => {
    const payload: ExecPayload = {
      type: "script",
      target: "wsl2",
      scriptPath: "test-script.sh",
    };

    const testCwd = scratchDir;
    
    // This will fail if path.resolve(p.scriptPath) is used instead of path.resolve(cwd, p.scriptPath)
    // because process.cwd() is the project root, and "test-script.sh" won't exist there.
    const { cmd, args, tempScriptPath } = buildCommand(payload, testCwd);

    expect(cmd).toBe("wsl.exe");
    expect(args).toContain("bash");
    
    const finalScriptPath = tempScriptPath || dummyScript;
    let expectedWslPath = finalScriptPath.split('\\').join('/');
    const drive = expectedWslPath.charAt(0).toLowerCase();
    expectedWslPath = `/mnt/${drive}/${expectedWslPath.substring(3)}`;
    expect(args).toContain(expectedWslPath);
  });
});
