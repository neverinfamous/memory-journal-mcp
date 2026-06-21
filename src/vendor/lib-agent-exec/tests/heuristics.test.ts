import { expect, test, describe, beforeAll, afterEach } from "bun:test";
import { checkPrompt } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/prompt-detector.ts";
import { dockerInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/docker-interceptor.ts";
import { gitInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/git-interceptor.ts";
import { ExecutionContext } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/types.ts";

describe("Prompt Detector Heuristics", () => {
    test("Complex package manager queries (inquirer.js)", () => {
        const inquirer1 = "? What would you like to do? › - Use arrow-keys. Return to submit.";
        expect(checkPrompt(inquirer1)).toBe(true);

        const inquirer2 = "? Select a package manager: » npm";
        expect(checkPrompt(inquirer2)).toBe(true);
        
        const inquirer3 = "✔ Select an option … option 1";
        expect(checkPrompt(inquirer3)).toBe(true);

        const inquirer4 = "? Are you sure you want to overwrite? (y/N) ";
        expect(checkPrompt(inquirer4)).toBe(true);

        // y/n prompts
        const yn1 = "Do you want to continue? [Y/n]";
        expect(checkPrompt(yn1)).toBe(true);

        const yn2 = "Overwrite file.txt? (y/n[n])";
        expect(checkPrompt(yn2)).toBe(true);
        
        // npm prompts
        const npm1 = "npm notice \nnpm notice New minor version of npm available! 10.5.0 -> 10.8.1\nnpm notice Changelog: https://github.com/npm/cli/releases/tag/v10.8.1\nnpm notice Run npm install -g npm@10.8.1 to update!\nnpm notice \n";
        expect(checkPrompt(npm1)).toBe(false);
    });
});

describe("Interceptors Heuristics", () => {
    let originalExit: typeof process.exit;
    let exitCalls: number;
    let lastExitCode: number | undefined;
    
    beforeAll(() => {
        originalExit = process.exit;
    });

    afterEach(() => {
        process.exit = originalExit;
        exitCalls = 0;
        lastExitCode = undefined;
    });

    test("git rebase -i blocking", () => {
        exitCalls = 0;
        process.exit = ((code?: number | string | null) => { exitCalls++; lastExitCode = Number(code); throw new Error(`exited with code ${code}`); }) as unknown as typeof process.exit;

        const ctx: ExecutionContext = { 
            cmdBasename: "git", 
            args: ["rebase", "-i", "HEAD~3"], 
            envOverrides: {}, 
            payload: { type: "command", target: "windows", command: "git" } 
        };
        
        let caughtError = false;
        try {
            gitInterceptor(ctx);
        } catch (e: unknown) {
            if ((e as Error).message.includes("exited with code 1")) caughtError = true;
        }

        expect(caughtError).toBe(true);
        expect(exitCalls).toBe(1);
        expect(lastExitCode).toBe(1);
    });

    test("docker TTY flags (-t, -i) stripping", () => {
        const ctx1: ExecutionContext = { 
            cmdBasename: "docker", 
            args: ["run", "-it", "ubuntu", "bash", "-c", "echo hello"], 
            envOverrides: {}, 
            payload: { type: "command", target: "windows", command: "docker" } 
        };
        dockerInterceptor(ctx1);
        expect(ctx1.args.includes("-it")).toBe(false);
        expect(ctx1.args.includes("-i")).toBe(false);
        expect(ctx1.args.includes("-t")).toBe(false);

        const ctx2: ExecutionContext = { 
            cmdBasename: "docker", 
            args: ["exec", "-i", "-t", "container", "bash", "-c", "echo hello"], 
            envOverrides: {}, 
            payload: { type: "command", target: "windows", command: "docker" } 
        };
        dockerInterceptor(ctx2);
        expect(ctx2.args.includes("-i")).toBe(false);
        expect(ctx2.args.includes("-t")).toBe(false);
        
        const ctx3: ExecutionContext = { 
            cmdBasename: "docker", 
            args: ["run", "--interactive", "--tty", "ubuntu", "bash", "-c", "echo hello"], 
            envOverrides: {}, 
            payload: { type: "command", target: "windows", command: "docker" } 
        };
        dockerInterceptor(ctx3);
        expect(ctx3.args.includes("--interactive")).toBe(false);
        expect(ctx3.args.includes("--tty")).toBe(false);
    });
});
