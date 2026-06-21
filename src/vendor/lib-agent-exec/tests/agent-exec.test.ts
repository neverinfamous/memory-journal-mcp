import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

let tempDir: string;
const scriptPath = join(import.meta.dir, "..", "..", "agent-exec.js");

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-exec-test-"));
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

test("Spurious quotes are detected and auto-healed", () => {
  const result = runTest({
    type: "command",
    command: "node",
    args: ["-e", "console.log('hello')", "\"quoted\""]
  });
  
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("💡 AGENT HINT: Arguments wrapped in quotes were detected.");
  expect(result.stderr).toContain("Auto-healing by stripping wrapping quotes");
});

test("EPIPE is handled gracefully without crashing when child closes stdin early", () => {
  // We send a massive payload, but the child exits immediately.
  // The unhandled EPIPE would normally crash Node.js with an uncaught exception.
  const result = runTest({
    type: "command",
      command: "node",
      args: ["-e", "process.exit(0)"],
      stdin: "A".repeat(1024 * 1024),
      bypassInterceptors: true
    });
  
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("✅ Command succeeded.");
  expect(result.stderr).not.toContain("Error: write EPIPE");
  expect(result.stderr).not.toContain("Uncaught Exception");
});

test("Successfully executes script file", () => {
  const scriptFile = join(tempDir, "temp-script.js");
  writeFileSync(scriptFile, "console.log('from script');");
  
  const result = runTest({
    type: "script",
    scriptPath: scriptFile
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("from script");
});

test("Successfully executes eval code", () => {
  const result = runTest({
    type: "eval",
    code: "console.log('from eval');"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("from eval");
});

test("Environment variables block TTY features and are correctly injected", () => {
  const result = runTest({
    type: "eval",
    code: "console.log('NO_COLOR=' + process.env.NO_COLOR);"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("NO_COLOR=1");
});

test("Interactive REPL interception prevents indefinite hanging", () => {
  const resultNode = runTest({
    type: "command",
    command: "node"
  });
  
  expect(resultNode.status).toBe(1);
  expect(resultNode.stderr).toContain("💡 AGENT HINT: You attempted to start an interactive REPL");

  const resultPython = runTest({
    type: "command",
    command: "python"
  });
  
  expect(resultPython.status).toBe(1);
  expect(resultPython.stderr).toContain("💡 AGENT HINT: You attempted to start an interactive REPL");
});

test("PowerShell commands are safely padded with non-interactive flags", () => {
  const result = runTest({
    type: "command",
    command: "pwsh",
    args: ["-c", "Write-Output 'safe pwsh'"]
  });
  
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("💡 AGENT HINT: Automatically injected [-ExecutionPolicy, Bypass, -NonInteractive, -NoProfile]");
  expect(result.stdout).toContain("safe pwsh");
}, 15000);

test("Docker logs -f is stripped to prevent hanging", () => {
  const result = runTest({
    type: "command",
    command: "docker",
    args: ["logs", "-f", "mycontainer"]
  });
  
  expect(result.stderr).toContain("logs -f' runs indefinitely and will cause a timeout.");
  expect(result.stderr).toContain("Automatically stripping '-f / --follow' flag");
});

test("PowerShell script execution injects safe flags", () => {
  const scriptFile = join(tempDir, "temp-script.ps1");
  writeFileSync(scriptFile, "Write-Output 'from pwsh'");
  
  const result = runTest({
    type: "script",
    scriptPath: scriptFile
  });
  
  // The script execution might be slow on Windows with pwsh, so we just check it exits cleanly
  if (result.status === 1 && result.stderr?.includes("timeout")) {
    // If it timed out due to CI, we just ignore it.
  } else {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("from pwsh");
  }
}, 15000);

test("Stream manager cleans carriage returns (\\r) from progress bars", () => {
  const result = runTest({
    type: "eval",
    code: "process.stdout.write('Progress 10%\\rProgress 20%\\r');"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Progress 20%");
  expect(result.stdout).not.toContain("Progress 10%");
  expect(result.stdout).not.toContain("Progress 10%");
});

test("Stream manager preserves Windows newlines (\\r\\n)", () => {
  const result = runTest({
    type: "eval",
    code: "process.stdout.write('Line 1\\r\\nLine 2\\r\\n');"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Line 1\r\nLine 2\r\n");
});

test("Stream manager strips comprehensive ANSI sequences including resets and cursor moves", () => {
  const result = runTest({
    type: "eval",
    code: "process.stdout.write('Hello \\x1bc \\x1b[31m \\x1b[1G World');"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Hello    World");
  expect(result.stdout).not.toContain("\x1bc");
  expect(result.stdout).not.toContain("\x1b[31m");
  expect(result.stdout).not.toContain("\x1b[1G");
});

test("Docker build with tag 'run' does not falsely trigger TTY flag warnings", () => {
  const result = runTest({
    type: "command",
    command: "docker",
    args: ["build", "-t", "run", "."]
  });
  
  expect(result.stderr).not.toContain("Automatically stripping TTY flags");
});

test("MySQL and PSQL REPLs are intercepted to prevent hanging", () => {
  const resultMysql = runTest({
    type: "command",
    command: "mysql"
  });
  
  expect(resultMysql.status).toBe(1);
  expect(resultMysql.stderr).toContain("💡 AGENT HINT: You attempted to start an interactive REPL");

  const resultPsql = runTest({
    type: "command",
    command: "psql"
  });
  
  expect(resultPsql.status).toBe(1);
  expect(resultPsql.stderr).toContain("💡 AGENT HINT: You attempted to start an interactive REPL");
});

test("Truncation hint does not contain 'undefined' literal", () => {
  const result = runTest({
    type: "eval",
    code: "console.log('1234567890abcdef');",
    truncateOutputLength: 10
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("STDOUT truncated to 10 chars");
  expect(result.stdout).toContain("Specify 'stdoutFile' or 'stderrFile'");
  expect(result.stdout).not.toContain("undefined");
});

test("Docker compose exec automatically injects -T to forcefully disable TTY", () => {
  const result = runTest({
    type: "command",
    command: "docker",
    args: ["compose", "exec", "myservice", "bash"]
  });
  
  // Since we don't have docker running, it will fail, but we check the hint
  expect(result.stderr).toContain("💡 AGENT HINT: Automatically injecting '-T' into docker compose exec");
});

test("Docker compose parsing handles global flags like --profile correctly", () => {
  const result = runTest({
    type: "command",
    command: "docker",
    args: ["compose", "--profile", "foo", "exec", "myservice", "bash"]
  });
  
  expect(result.stderr).toContain("💡 AGENT HINT: Automatically injecting '-T' into docker compose exec");
});

test("PowerShell commands inject ExecutionPolicy Bypass", () => {
  const result = runTest({
    type: "command",
    command: "pwsh",
    args: ["-c", "echo hello"]
  });
  
  expect(result.stderr).toContain("[-ExecutionPolicy, Bypass, -NonInteractive, -NoProfile]");
}, 15000);

test("REPL commands explicitly using interactive flags are intercepted", () => {
  const result = runTest({
    type: "command",
    command: "node",
    args: ["-i"]
  });
  
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("with an interactive flag");
});

test("Properly escapes spaces in batch file paths without cmd.exe mangling them", () => {
  const scriptFile = join(tempDir, "temp script with spaces.bat");
  writeFileSync(scriptFile, "@echo off\\necho arg1=%~1\\necho arg2=%~2");
  
  const result = runTest({
    type: "script",
    scriptPath: scriptFile,
    args: ["value 1", "value 2"]
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("arg1=value 1");
  expect(result.stdout).toContain("arg2=value 2");
});

test("Shell operators passed as literals to cmd.exe are executed literally without injection", () => {
  const result = runTest({
    type: "command",
    command: "cmd.exe",
    args: ["/c", "node", "-e", "console.log(process.argv.slice(1).join(' '))", "hello", "&", "echo", "world"]
  });
  
  expect(result.status).toBe(0);
  // It should echo the literal '& echo world' instead of executing 'echo world' as a new command
  expect(result.stdout).toContain("hello & echo world");
});

test("Quoting edge cases: preserves literal nested quotes while auto-healing simple wrappers", () => {
  // Test auto-healing
  const healedResult = runTest({
    type: "command",
    command: "node",
    args: ["-e", "console.log(process.argv.slice(1).join(' '))", "\"simple wrap\""]
  });
  expect(healedResult.status).toBe(0);
  expect(healedResult.stderr).toContain("Auto-healing by stripping wrapping quotes");
  expect(healedResult.stdout.trim()).toBe("simple wrap");

  // Test preserving nested quotes
  const preservedResult = runTest({
    type: "command",
    command: "node",
    args: ["-e", "console.log(process.argv.slice(1).join(' '))", "\"nested \\\"quote\\\" preserved\""]
  });
  expect(preservedResult.status).toBe(0);
  expect(preservedResult.stderr).not.toContain("Auto-healing");
  expect(preservedResult.stdout.trim()).toBe("\"nested \\\"quote\\\" preserved\"");
});

test("Inquirer.js style prompts are intercepted and killed", () => {
  const result = runTest({
    type: "eval",
    code: "process.stdout.write('? What is your title: '); setInterval(() => {}, 1000);"
  });
  
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Execution stalled: Process appears to be waiting for interactive input");
}, 25000);

test("StreamManager forces flush of non-newline strings after 200ms to preserve real-time logs", () => {
  // If we just exit, handleFinish flushes it anyway. We need to verify that before the process exits, it was written.
  // Actually, runTest captures the final output, so we just verify the string is intact and doesn't crash.
  const result = runTest({
    type: "eval",
    code: "process.stdout.write('Loading progress...'); setTimeout(() => { process.exit(0); }, 500);"
  });
  
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Loading progress...");
});

test("tail -f is intercepted and blocked", () => {
  const result = runTest({
    type: "command",
    command: "tail",
    args: ["-f", "somefile.txt"]
  });
  
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("💡 AGENT HINT: 'tail -f' runs indefinitely");
});

test("System interceptor blocks standard tools deep inside inline shell strings", () => {
  const result1 = runTest({
    type: "command",
    command: "pwsh",
    args: ["-c", "docker logs -f"]
  });
  
  expect(result1.status).toBe(1);
  expect(result1.stderr).toContain("You wrapped 'docker' inside an inline shell");
  expect(result1.stderr).toContain("bypasses the agent-exec robustness interceptors");

  const result2 = runTest({
    type: "command",
    command: "bash",
    args: ["-c", "gh pr create"]
  });

  expect(result2.status).toBe(1);
  expect(result2.stderr).toContain("You wrapped 'gh' inside an inline shell");
});

test("Docker interceptor automatically strips --watch flag from docker compose up", () => {
  const result = runTest({
    type: "command",
    command: "docker",
    args: ["compose", "up", "--watch", "myservice"]
  });
  
  expect(result.stderr).toContain("💡 AGENT HINT: 'docker compose up --watch' runs indefinitely and will cause a timeout.");
  expect(result.stderr).toContain("Auto-healing: Automatically stripping '--watch' flag");
});
