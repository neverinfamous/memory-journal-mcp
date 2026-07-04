import { test, expect } from 'bun:test';
import { checkPrompt } from "../prompt-detector.js";

test("Prompt detector false positives", () => {
  expect(checkPrompt("Downloading data for user username ")).toBe(false);
  expect(checkPrompt("Processing body ")).toBe(false);
  expect(checkPrompt("Found valid token")).toBe(false);
  
  // Real prompts should still trigger
  expect(checkPrompt("username:")).toBe(true);
  expect(checkPrompt("Password: ")).toBe(true);
});


