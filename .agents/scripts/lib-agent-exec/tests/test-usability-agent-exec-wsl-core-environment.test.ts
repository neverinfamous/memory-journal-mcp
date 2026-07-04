import { describe, it, expect } from 'bun:test';
import { buildCommand } from "../command-builder.ts";
import { buildEnvironment } from "../environment.ts";
import type { ExecPayload } from "../schema.ts";
import { spawnSync } from "node:child_process";

describe("WSL2 Core Environment Integration Tests", () => {

  it("should propagate agent core protective environment variables to WSL2", () => {
    // The agent-exec execution engine builds an environment containing crucial defaults
    // like NO_COLOR=1, TERM=dumb, GIT_TERMINAL_PROMPT=0, etc.
    // These must be present in the WSL2 execution environment.
    
    const payload: ExecPayload = {
      type: "command",
      command: "env",
      target: "wsl2",
      env: {
        "MY_CUSTOM_TEST_VAR": "HELLO"
      }
    };

    const testCwd = "C:\\Users";
    
    // Simulating what agent-exec.ts does:
    const { cmd, args, envOverrides } = buildCommand(payload, testCwd);
    const env = { ...buildEnvironment(payload.env), ...(envOverrides || {}) };

    expect(cmd).toBe("wsl.exe");

    // Execute to check the actual WSL environment
    const proc = spawnSync(cmd, args, { encoding: "utf8", env });
    expect(proc.status).toBe(0);
    
    const output = proc.stdout.trim();
    
    // Custom var from payload should be there
    expect(output).toContain("MY_CUSTOM_TEST_VAR=HELLO");
    
    // Protective env overrides from buildCommand should ALSO be there
    expect(output).toContain("CI=1");
    expect(output).toContain("NPM_CONFIG_YES=true");
    expect(output).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(output).toContain("PAGER=");
  });

  it("should safely propagate complex environment variables without corruption or injection", () => {
    const payload: ExecPayload = {
      type: "command",
      command: "env",
      target: "wsl2",
      env: {
        "MY_COMPLEX_VAR": "VALUE WITH SPACES AND \"QUOTES\" AND \nNEWLINES",
        "INJECTION_VAR": "(); echo VULNERABLE",
      }
    };

    const testCwd = "C:\\Users";
    const { cmd, args, envOverrides } = buildCommand(payload, testCwd);
    const env = { ...buildEnvironment(payload.env), ...(envOverrides || {}) };

    const proc = spawnSync(cmd, args, { encoding: "utf8", env });
    expect(proc.status).toBe(0);
    
    const output = proc.stdout.trim();
    
    expect(output).toContain("MY_COMPLEX_VAR=VALUE WITH SPACES AND \"QUOTES\" AND \nNEWLINES");
    expect(output).toContain("INJECTION_VAR=(); echo VULNERABLE");
  });
});
