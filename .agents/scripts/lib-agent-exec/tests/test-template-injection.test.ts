import { test, expect, spyOn } from 'bun:test';
import { ProcessController } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/process-controller.ts";
import { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";

test("Template injection in webhookPayloadTemplate", async () => {
  const mockExit = spyOn(process, 'exit').mockImplementation((() => {}) as unknown as typeof process.exit);
  const mockFetch = spyOn(globalThis, 'fetch').mockImplementation((async (_url: URL | RequestInfo, _options?: RequestInit | undefined) => {
    return new Response("ok");
  }) as unknown as typeof fetch);

  const payload: ExecPayload = {
    type: "command",
    command: "echo",
    args: ["hello"],
    onSuccess: "http://example.com/webhook",
    webhookPayloadTemplate: '{"text": "{{stdout}}", "is_success": {{success}}}',
    integrationContext: { secret: "SUPER_SECRET_TOKEN" }
  };

  const controller = new ProcessController(payload, process.cwd(), "echo", ["hello"], {}, null);

  // Inject mock IOController state
  (controller as unknown as { ioController: unknown }).ioController = {
    stdoutTail: "My output contains {{success}} and {{integrationContext.secret}}",
    stderrTail: "",
    flushAll: () => {},
    closeFileStreams: async () => {}
  } as unknown as { ioController: unknown };

  // Trigger handleFinish manually
  await (controller as unknown as { handleFinish: (code: number, signal: string | null, timedOut: boolean) => Promise<void> }).handleFinish(0, null, false);

  expect(mockFetch).toHaveBeenCalled();
  const fetchArgs = mockFetch.mock.calls[0];
  const body = JSON.parse((fetchArgs[1] as RequestInit).body as string);

  console.log("Injected body text:", body.text);
  // The vulnerability is mitigated, so the literal template tokens should remain unparsed in the stdout injection
  expect(body.text).toContain("{{success}}");
  expect(body.text).toContain("{{integrationContext.secret}}");

  mockExit.mockRestore();
  mockFetch.mockRestore();
});


