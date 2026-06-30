// @ts-nocheck
import { z } from 'zod';

const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .refine(val => !val.includes('\r'), "Must not contain carriage returns")
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");

const safeStringArray = z.array(safeString).max(1000);

const basePayloadSchema = z.object({
  args: safeStringArray.optional(),
  cwd: safeString.optional(),
  env: z.record(safeString, safeString).optional(),
  integrationContext: z.record(z.string(), z.unknown()).optional(),
  templateOverride: safeString.optional(),
  target: z.enum(["windows", "wsl2"]).optional(),
  timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
  stdin: noNullString.optional(),
  stdoutFile: safeString.optional(),
  stderrFile: safeString.optional(),
  maxBuffer: z.number().positive().optional(),
  truncateOutputLength: z.number().positive().optional(),
  keepPayload: z.boolean().optional(),
  stallTimeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
  bypassInterceptors: z.boolean().optional(),
  onSuccess: z.union([safeString, safeStringArray]).optional(),
  onFailure: z.union([safeString, safeStringArray]).optional(),
  webhookHeaders: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  webhookPayloadTemplate: noNullString.optional(),
  webhookMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  webhookTimeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
  expectJsonEnvelope: z.boolean().optional(),
});

export const PayloadSchema = z.discriminatedUnion("type", [
  basePayloadSchema.extend({
    type: z.literal("command"),
    command: safeString.refine(val => val.trim().length > 0, "command must not be empty"),
  }),
  basePayloadSchema.extend({
    type: z.literal("script"),
    scriptPath: safeString.refine(val => val.trim().length > 0, "scriptPath must not be empty"),
    interpreter: safeString.optional(),
  }),
  basePayloadSchema.extend({
    type: z.literal("eval"),
    code: noNullString.refine(val => val.trim().length > 0, "code must not be empty"),
    interpreter: safeString.optional(),
  })
]);

export type ExecPayload = z.infer<typeof PayloadSchema>;

export const agentExecCliArgsSchema = z.object({
  interceptors: z.string().optional(),
  plugin: z.string().optional(),
  help: z.boolean().optional(),
  json: z.boolean().optional(),
  payloadPath: z.string().optional(),
});

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;
