import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";

let tempDir: string;
const scriptPath = resolve(__dirname, "../../agent-exec.js");

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-exec-edge-"));
});

afterAll(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function runTest(payload: Record<string, unknown>) {
  const payloadPath = join(tempDir, `payload-${Date.now()}-${Math.random()}.json`);
  writeFileSync(payloadPath, JSON.stringify(payload));
  
  const result = spawnSync("bun", [scriptPath, payloadPath], { encoding: "utf-8" });
  return { 
    status: result.status ?? (result.error ? 1 : 0), 
    stdout: result.stdout || "", 
    stderr: result.stderr || (result.error?.message || "") 
  };
}

test("Deep directory structures, long paths, spaces, non-ASCII characters", () => {
  let deepPath = tempDir;
  const parts = ["folder with spaces", "æ¸¬è©¦", "espaÃ±ol", "ðŸš€", "long_name_".repeat(10)];
  
  for (const part of parts) {
    deepPath = join(deepPath, part);
    mkdirSync(deepPath, { recursive: true });
  }

  const targetScript = join(deepPath, "test script.js");
  writeFileSync(targetScript, "console.log('Success from deep path');");

  const result = runTest({
    type: "script",
    scriptPath: targetScript,
    cwd: deepPath
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Success from deep path");
});

test("Execution via Symlink / Junction", () => {
  const targetDir = join(tempDir, "target_dir");
  mkdirSync(targetDir, { recursive: true });
  
  const symlinkDir = join(tempDir, "symlink_dir");
  try { symlinkSync(targetDir, symlinkDir, "junction"); } catch { /* ignore if not supported */ }

  const targetScript = join(targetDir, "symlink_test.js");
  writeFileSync(targetScript, "console.log('Success from symlink', process.cwd());");

  const result = runTest({
    type: "script",
    scriptPath: join(targetDir, "symlink_test.js"),
    cwd: targetDir
  });

  expect(result.status).toBe(0);
});

test("Command payload with extremely long CWD path", () => {
  let deepPath = tempDir;
  for (let i = 0; i < 10; i++) {
    deepPath = join(deepPath, "extremely_long_dir");
    mkdirSync(deepPath, { recursive: true });
  }

  const result = runTest({
    type: "command",
    command: "node",
    args: ["-e", "console.log(process.cwd())"],
    cwd: deepPath
  });

  expect(result.status).toBe(0);
});

test("Command payload with path exceeding MAX_PATH (260)", () => {
  let deepPath = tempDir;
  for (let i = 0; i < 20; i++) {
    deepPath = join(deepPath, "super_extreme_long_path_segment");
    mkdirSync(deepPath, { recursive: true });
  }

  const result = runTest({
    type: "command",
    command: "node",
    args: ["-e", "console.log(process.cwd().includes('super_extreme_long_path_segment'))"],
    cwd: deepPath
  });

  if (process.platform === 'win32' && result.status !== 0) {
     expect(result.stderr).toContain("Your working directory path exceeds the Windows MAX_PATH limit");
  } else {
     expect(result.status).toBe(0);
  }
});
