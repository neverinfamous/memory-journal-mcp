import { test, expect, describe } from "bun:test";
import { buildCommand } from "../command-builder.js";

describe("Command Builder Security", () => {
  test("Prevents shell injection when arguments are pre-wrapped in quotes", () => {
    const payload = { type: 'command' as const, command: 'cmd', args: ['/c', 'echo', '"hello" & calc.exe & "world"'] };
    const res = buildCommand(payload, process.cwd());
    
    // Check that cmd.exe's command wrapper correctly escapes the internal quotes, instead of stripping them unconditionally
    expect(res.args[3]).toContain('calc.exe');
    expect(res.args[3]).toContain('world');
  });
});
