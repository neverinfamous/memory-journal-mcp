// @ts-nocheck
import { z } from 'zod';

const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .refine(val => !val.includes('\r'), "Must not contain carriage returns")
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");

const safeStringArray = z.array(safeString).max(1000);

export const PayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: safeString.min(1, "command must not be empty"),
    args: safeStringArray.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    integrationContext: z.record(z.string(), z.any()).optional(),
    target: z.enum(["windows", "wsl2"]).optional(),
    timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
    bypassInterceptors: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("script"),
    scriptPath: safeString.min(1, "scriptPath must not be empty"),
    interpreter: safeString.optional(),
    args: safeStringArray.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    integrationContext: z.record(z.string(), z.any()).optional(),
    target: z.enum(["windows", "wsl2"]).optional(),
    timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
    bypassInterceptors: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("eval"),
    code: noNullString.min(1, "code must not be empty"),
    interpreter: safeString.optional(),
    args: safeStringArray.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    integrationContext: z.record(z.string(), z.any()).optional(),
    templateOverride: safeString.optional(),
    target: z.enum(["windows", "wsl2"]).optional(),
    timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
    bypassInterceptors: z.boolean().optional(),
  })
]);

export type ExecPayload = z.infer<typeof PayloadSchema>;
