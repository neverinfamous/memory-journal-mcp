// @ts-nocheck
import { z } from 'zod';

const safeString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");

export const PayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: safeString.min(1, "command must not be empty"),
    args: z.array(safeString).optional(),
    cwd: safeString.optional(),
    env: z.record(safeString, safeString).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: z.string().optional(),
    stdoutFile: z.string().optional(),
    stderrFile: z.string().optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("script"),
    scriptPath: z.string().min(1, "scriptPath must not be empty"),
    interpreter: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: z.string().optional(),
    stdoutFile: z.string().optional(),
    stderrFile: z.string().optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("eval"),
    code: z.string().min(1, "code must not be empty"),
    interpreter: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
    stdin: z.string().optional(),
    stdoutFile: z.string().optional(),
    stderrFile: z.string().optional(),
    maxBuffer: z.number().positive().optional(),
    truncateOutputLength: z.number().positive().optional(),
    keepPayload: z.boolean().optional(),
    stallTimeoutMs: z.number().int().nonnegative().optional(),
  })
]);

export type ExecPayload = z.infer<typeof PayloadSchema>;
