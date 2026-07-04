import { expect, test } from "bun:test";
import { buildCommand } from "../command-builder.js";
import { ExecPayload } from "../schema.js";
import fs from "node:fs";

test("wsl2 eval payload with CRLF line endings translates to LF", () => {
  const payload: ExecPayload = {
    type: "eval",
    target: "wsl2",
    code: "if [ -z \"\" ]; then\r\n  echo \"empty\"\r\nfi"
  };

  const { tempScriptPath } = buildCommand(payload, process.cwd());
  
  expect(tempScriptPath).not.toBeNull();
  
  const content = fs.readFileSync(tempScriptPath!, "utf-8");
  expect(content).not.toContain("\r\n");
  expect(content).toContain("echo \"empty\"\nfi");
});
