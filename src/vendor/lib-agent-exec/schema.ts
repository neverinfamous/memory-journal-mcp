// @ts-nocheck
import { z } from 'zod';

const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .refine(val => !val.includes('\r'), "Must not contain carriage returns")
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");

const safeStringArrayOrString = z.union([z.array(safeString), safeString]).transform(val => Array.isArray(val) ? val : [val]);

export const PayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: safeString.min(1, "command must not be empty"),
    args: safeStringArrayOrString.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("script"),
    scriptPath: safeString.min(1, "scriptPath must not be empty"),
    interpreter: safeString.optional(),
    args: safeStringArrayOrString.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("eval"),
    code: noNullString.min(1, "code must not be empty"),
    interpreter: safeString.optional(),
    args: safeStringArrayOrString.optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: noNullString.optional(),
    stdoutFile: safeString.optional(),
    stderrFile: safeString.optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  })
]);

export type ExecPayload = z.infer<typeof PayloadSchema>;
