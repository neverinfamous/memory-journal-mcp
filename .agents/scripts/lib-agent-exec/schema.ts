import { z } from 'zod';

const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .refine(val => !val.includes('\r'), "Must not contain carriage returns")
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");

const safeStringArray = z.array(safeString).max(1000);

const lenientBoolean = z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform(val => val === true || val === "true");

const basePayloadSchema = z.object({
  args: safeStringArray.optional(),
  cwd: safeString.max(1024).optional(),
  env: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  integrationContext: z.record(z.string(), z.unknown()).optional(),
  templateOverride: safeString.max(1024).optional(),
  target: z.union([z.literal("windows"), z.literal("wsl2")]).optional(),
  timeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, 2147483647)).optional(),
  stdin: z.string().max(10 * 1024 * 1024).optional(),
  stdoutFile: safeString.optional(),
  stderrFile: safeString.optional(),
  maxBuffer: z.number().int().positive().max(2147483647).optional(),
  truncateOutputLength: z.number().int().positive().max(2147483647).optional(),
  keepPayload: lenientBoolean.optional(),
  stallTimeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, 2147483647)).optional(),
  bypassInterceptors: lenientBoolean.optional(),
  onSuccess: z.union([safeString, safeStringArray]).optional(),
  onFailure: z.union([safeString, safeStringArray]).optional(),
  webhookHeaders: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  webhookPayloadTemplate: z.unknown().transform(val => typeof val === 'string' ? val : JSON.stringify(val)).pipe(noNullString).optional(),
  webhookMethod: z.union([z.literal("GET"), z.literal("POST"), z.literal("PUT"), z.literal("PATCH"), z.literal("DELETE")]).optional(),
  webhookTimeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, 2147483647)).optional(),
  expectJsonEnvelope: lenientBoolean.optional(),
}).strict();

export const PayloadSchema = z.discriminatedUnion("type", [
  basePayloadSchema.extend({
    type: z.literal("command"),
    command: safeString.min(1, "command must not be empty").refine(val => val.trim().length > 0, "command must not be empty"),
  }),
  basePayloadSchema.extend({
    type: z.literal("script"),
    scriptPath: safeString.refine(val => val.trim().length > 0, "scriptPath must not be empty"),
    interpreter: safeString.optional(),
  }),
  basePayloadSchema.extend({
    type: z.literal("eval"),
    code: noNullString.max(10 * 1024 * 1024, "code exceeds maximum allowed length of 10MB").refine(val => val.trim().length > 0, "code must not be empty"),
    interpreter: safeString.optional(),
  })
]);

export type ExecPayload = z.infer<typeof PayloadSchema>;

export const agentExecCliArgsSchema = z.object({
  interceptors: z.union([z.string().max(1024), z.array(z.string().max(1024)).max(100)]).optional(),
  plugin: z.string().max(1024).optional(),
  help: z.boolean().optional(),
  json: z.boolean().optional(),
  payloadPath: z.string().max(1024).optional(),
});

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;

export const JsonEnvelopeSchema = z.object({
  status: z.union([z.literal("success"), z.literal("error")]),
  exit_code: z.number().int().optional(),
}).passthrough();
