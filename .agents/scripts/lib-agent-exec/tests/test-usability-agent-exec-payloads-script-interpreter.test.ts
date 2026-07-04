import { expect, test } from "bun:test";
import { buildCommand } from "../command-builder.js";
import { ExecPayload } from "../schema.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

test("script payload respects explicit interpreter over default extension mapping", () => {
  const scratchDir = path.join(os.tmpdir(), "agent-exec-test");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const dummyScript = path.join(scratchDir, `dummy-${crypto.randomUUID()}.ts`);
  fs.writeFileSync(dummyScript, "console.log('hello')", "utf8");

  const payload: ExecPayload = {
    type: "script",
    scriptPath: dummyScript,
    interpreter: "tsx", // Overrides default 'bun' for .ts
  };

  const { cmd, args } = buildCommand(payload, process.cwd());
  
  // Clean up
  fs.unlinkSync(dummyScript);

  // The interpreter should be "tsx" or its resolved path (like tsx.cmd)
  const basename = path.basename(cmd).toLowerCase().replace(/\.(cmd|bat|exe)$/, '');
  expect(basename).toBe("tsx");
  
  // The first argument should be the script path, formatted appropriately
  expect(args[0].replace(/\\/g, '/')).toBe(dummyScript.replace(/\\/g, '/'));
});
