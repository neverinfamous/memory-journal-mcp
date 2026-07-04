import { test, expect } from 'bun:test';
import { IOController } from '../io-controller.js';
import { ChildProcess } from 'node:child_process';
import type { ExecPayload } from '../schema.js';

type IOControllerTestDouble = {
  _stdoutTail: string;
  evaluatePromptStall: () => void;
};

test("IOController respects bypassInterceptors flag (bypasses stall)", () => {
  const payload: ExecPayload = {
    type: "command",
    command: "echo",
    bypassInterceptors: true,
  };
  
  let stalled = false;
  const controller = new IOController(
    {} as ChildProcess, payload, process.cwd(), () => { stalled = true; }, () => {});
  
  const ctrl = controller as unknown as IOControllerTestDouble;
  ctrl._stdoutTail = "\x1b[?1049h"; // TUI sequence
  ctrl.evaluatePromptStall();
  
  expect(stalled).toBe(false);
});

test("IOController stalls when bypassInterceptors is false/undefined", () => {
  const payload: ExecPayload = {
    type: "command",
    command: "echo",
  };
  
  let stalled = false;
  const controller = new IOController(
    {} as ChildProcess, payload, process.cwd(), () => { stalled = true; }, () => {});
  
  const ctrl = controller as unknown as IOControllerTestDouble;
  ctrl._stdoutTail = "\x1b[?1049h"; // TUI sequence
  ctrl.evaluatePromptStall();
  
  expect(stalled).toBe(true);
});
