// @ts-nocheck
import { z } from 'zod';

export const PayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command"),
    command: z.string().min(1, "command must not be empty"),
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
