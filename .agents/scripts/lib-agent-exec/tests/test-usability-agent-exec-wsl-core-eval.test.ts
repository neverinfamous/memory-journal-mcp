import { expect, test } from "bun:test";
import { buildCommand } from "../command-builder.js";
import { ExecPayload } from "../schema.js";

test("eval payload with wsl2 target defaults to sh/bash interpreter when omitted", () => {
  const payload: ExecPayload = {
    type: "eval",
    code: "uname -a",
    target: "wsl2"
  };
  
  const { cmd, args, tempScriptPath } = buildCommand(payload, process.cwd());
  
  expect(cmd).toBe("wsl.exe");
  expect(args).not.toContain("bun");
  
  // wslCmd is positioned somewhere after 'env' and env variables.
  // It should be 'sh' or 'bash'.
  const hasShell = args.includes("bash") || args.includes("sh");
  expect(hasShell).toBe(true);
  
  // script extension should be .sh
  expect(tempScriptPath?.endsWith(".sh")).toBe(true);
});
