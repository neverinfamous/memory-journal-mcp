import { expect, test } from "bun:test";
import { buildCommand } from "../command-builder.js";
import { ExecPayload } from "../schema.js";

test("eval payload with pwsh interpreter properly routes and sets arguments", () => {
  const payload: ExecPayload = {
    type: "eval",
    code: "Write-Output 'hello'",
    interpreter: "pwsh",
    cwd: "."
  };
  
  const { cmd, args } = buildCommand(payload, process.cwd());
  
  expect(cmd.toLowerCase()).toContain("pwsh");
  expect(args).toContain("-ExecutionPolicy");
  expect(args).toContain("Bypass");
  expect(args).toContain("-NonInteractive");
  expect(args).toContain("-NoProfile");
  expect(args).toContain("-File");
});
