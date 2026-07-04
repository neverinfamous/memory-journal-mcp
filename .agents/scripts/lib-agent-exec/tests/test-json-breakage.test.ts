import { test, expect, spyOn } from 'bun:test';
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";

test("JSON breakage via dollar sign injection", async () => {
  const mockExit = spyOn(process, 'exit').mockImplementation((() => {}) as unknown as typeof process.exit);
  let interceptedBody = "";
  const mockFetch = spyOn(globalThis, 'fetch').mockImplementation((async (url: URL | RequestInfo, options?: RequestInit | undefined) => {
    interceptedBody = (options as RequestInit).body as string;
    return new Response("ok");
  }) as unknown as typeof fetch);

  const payload: ExecPayload = {
    type: "command",
    command: "echo",
    args: ["hello"],
    onSuccess: "http://example.com/webhook",
    webhookPayloadTemplate: '{"text": "{{stdout}}"}',
  };

  const controller = new ProcessController(payload, process.cwd(), "echo", ["hello"], {}, null);

  // If stdout contains $', String.prototype.replace replaces it with the portion of the string that follows the matched substring.
  // The string is: '{"text": "{{stdout}}"}'
  // The matched substring is '{{stdout}}'. The portion that follows is '"}'.
  // So {{stdout}} will be replaced by '"}'.
  (controller as unknown as { ioController: unknown }).ioController = {
    stdoutTail: "$'",
    stderrTail: "",
    flushAll: () => {},
    closeFileStreams: async () => {}
  } as unknown as { ioController: unknown };

  await (controller as unknown as { handleFinish: (code: number, signal: string | null, timedOut: boolean) => Promise<void> }).handleFinish(0, null, false);

  expect(mockFetch).toHaveBeenCalled();
  
  console.log("Raw intercepted body:", interceptedBody);
  
  let parsedSuccessfully = false;
  try {
    JSON.parse(interceptedBody);
    parsedSuccessfully = true;
  } catch (e: unknown) {
    console.log("Failed to parse JSON:", (e as Error).message);
  }
  
  expect(parsedSuccessfully).toBe(true); // Should parse correctly now

  mockExit.mockRestore();
  mockFetch.mockRestore();
});


