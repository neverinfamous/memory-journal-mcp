import { test, mock } from 'bun:test';
import { executeCommand } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/execution-engine.ts";

test("Built-in cmd executed directly triggers hint", async () => {
    const originalExit = process.exit;
    const originalConsoleError = console.error;
    const exitMock = mock((_code?: number | string | null | undefined) => {
      return undefined as never;
    });
    process.exit = exitMock as unknown as typeof process.exit;
    const errorOutputs: string[] = [];
    console.error = (...args: unknown[]) => {
      errorOutputs.push(args.map(String).join(" "));
    };

    const payload = {
      type: "command",
      command: "dir",
      args: []
    } as unknown as import("../schema.ts").ExecPayload;

    executeCommand(payload, process.cwd(), (payload as { command: string, args: string[] }).command, (payload as { command: string, args: string[] }).args, process.env as Record<string, string | undefined>);

    await new Promise(resolve => setTimeout(resolve, 500));

    console.error = originalConsoleError;
    process.exit = originalExit;

    console.log("ERRORS:", errorOutputs.join("\n"));
    console.log("CALLED:", exitMock.mock.calls);
});


