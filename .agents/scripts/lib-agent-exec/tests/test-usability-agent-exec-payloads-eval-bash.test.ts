import { expect, test } from "bun:test";
import { buildCommand } from "../command-builder.js";
import { ExecPayload } from "../schema.js";

test("eval payload with bash interpreter properly converts path on Windows", () => {
  const payload: ExecPayload = {
    type: "eval",
    code: "echo 'hello'",
    interpreter: "bash",
    cwd: "."
  };
  
  const { args } = buildCommand(payload, process.cwd());
  
  // On Windows, bash expects a converted path or is invoked via wsl.
  // We expect args[0] to NOT be a raw C:/... path if it's bash.
  if (process.platform === 'win32') {
    expect(args[0]).not.toMatch(/^[a-zA-Z]:/);
    expect(args[0]).toMatch(/^\/(mnt\/)?[a-z]\//);
  }
});
