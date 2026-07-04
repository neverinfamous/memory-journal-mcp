import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("agent-exec deletes payload file if keepPayload is false or undefined", () => {
  const payloadPath = path.resolve(__dirname, "temp-payload-false.json");
  const payload = {
    type: "command",
    command: "echo",
    args: ["test"],
    keepPayload: false,
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  
  spawnSync("bun", [
    path.resolve(__dirname, "../../agent-exec.ts"),
    payloadPath
  ]);
  
  expect(fs.existsSync(payloadPath)).toBe(false);

  const payloadPathTrue = path.resolve(__dirname, "temp-payload-true.json");
  const payloadTrue = {
    type: "command",
    command: "echo",
    args: ["test"],
    keepPayload: true,
  };
  fs.writeFileSync(payloadPathTrue, JSON.stringify(payloadTrue));
  
  spawnSync("bun", [
    path.resolve(__dirname, "../../agent-exec.ts"),
    payloadPathTrue
  ]);
  
  expect(fs.existsSync(payloadPathTrue)).toBe(true);
  fs.unlinkSync(payloadPathTrue);
}, 15000);
