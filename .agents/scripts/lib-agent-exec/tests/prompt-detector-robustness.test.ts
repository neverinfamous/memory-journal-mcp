import { expect, test, describe } from 'bun:test';
import { checkPrompt } from "../prompt-detector.js";

describe("lib-agent-exec: Prompt Detector Heuristics Audit", () => {
    test("Inquirer.js and Complex Package Manager Queries", () => {
        // These should pass
        expect(checkPrompt("? Choose a template: › - Use arrow-keys. Return to submit.")).toBe(true);
        expect(checkPrompt("? Are you sure you want to overwrite? (y/N)")).toBe(true);
        expect(checkPrompt("? Select features: (Press <space> to select)")).toBe(true);
        expect(checkPrompt("\x1B[32m?\x1B[39m \x1B[1mSelect a package manager\x1B[22m \x1B[90m»\x1B[39m ")).toBe(true);
        
        // This is expected to FAIL based on the current regex heuristics
        expect(checkPrompt("? What is your name? ")).toBe(true);
    });

    test("Y/N Prompts", () => {
        expect(checkPrompt("Do you want to continue? [Y/n] ")).toBe(true);
        expect(checkPrompt("Proceed? (y/n) ")).toBe(true);
        expect(checkPrompt("Overwrite C:\\Users\\user\\file.txt? (y/n[n])")).toBe(true);
    });

    test("Git Rebase -i Blocking", () => {
        expect(checkPrompt("hint: Waiting for your editor to close the file...")).toBe(true);
    });

    test("Forced TTY flags (-t, -i)", () => {
        expect(checkPrompt("root@hostname:~# ")).toBe(true);
        expect(checkPrompt("user@ubuntu:~$ ")).toBe(true);
        expect(checkPrompt("docker@default:/$ ")).toBe(true);
    });
});


