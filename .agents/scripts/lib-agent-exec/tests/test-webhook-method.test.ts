import { test, expect, describe } from 'bun:test';
import { PayloadSchema } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";

describe("Webhook Method Schema Validation", () => {
    test("Accepts standard HTTP methods", () => {
        const payload = {
            type: "command",
            command: "echo",
            args: ["hello"],
            webhookMethod: "POST"
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    test("Rejects invalid HTTP methods", () => {
        const payload = {
            type: "command",
            command: "echo",
            args: ["hello"],
            webhookMethod: "INVALID"
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].path.includes("webhookMethod")).toBe(true);
        }
    });

    test("Accepts empty webhookMethod (defaults to optional)", () => {
        const payload = {
            type: "command",
            command: "echo",
            args: ["hello"]
        };
        const result = PayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});
