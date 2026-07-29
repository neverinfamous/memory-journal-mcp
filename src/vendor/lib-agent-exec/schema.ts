// @ts-nocheck
import { z } from 'zod';

const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .transform(val => val.replace(/\r/g, ''))
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");
const maxString = (max: number) => z.string().max(max).pipe(safeString);

const safeStringArray = z.array(safeString).max(1000);

const lenientBoolean = z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform(val => val === true || val === "true");

const basePayloadSchema = z.object({
  args: safeStringArray.optional(),
  cwd: maxString(1024).optional(),
  env: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  integrationContext: z.record(z.string(), z.unknown()).optional(),
  templateOverride: maxString(1024).optional(),
  target: z.preprocess(val => {
    if (typeof val === 'string') {
      const v = val.toLowerCase();
      if (['wsl', 'linux', 'ubuntu'].includes(v)) return 'wsl2';
      if (['native', 'win', 'win32'].includes(v)) return 'windows';
    }
    return val;
  }, z.union([z.literal("windows"), z.literal("wsl2")])).optional(),
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

const rawPayloadUnion = z.discriminatedUnion("type", [
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
    code: noNullString.max(10 * 1024 * 1024, "code exceeds maximum allowed length of 10MB").refine(val => val.trim().length > 0, "code must not be empty"),
    interpreter: safeString.optional(),
  })
]);

export const PayloadSchema = z.preprocess(val => {
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (!obj.type) {
      if ('command' in obj && typeof obj.command === 'string') {
        return { ...obj, type: 'command' };
      }
      if ('scriptPath' in obj && typeof obj.scriptPath === 'string') {
        return { ...obj, type: 'script' };
      }
      if ('code' in obj && typeof obj.code === 'string') {
        return { ...obj, type: 'eval' };
      }
    }
  }
  return val;
}, rawPayloadUnion);

export type ExecPayload = z.infer<typeof PayloadSchema>;

export const agentExecCliArgsSchema = z.object({
  interceptors: z.union([maxString(1024), z.array(maxString(1024)).max(100)]).optional(),
  plugin: maxString(1024).optional(),
  help: z.boolean().optional(),
  json: z.boolean().optional(),
  payloadPath: maxString(1024).optional(),
  target: maxString(1024).optional(),
  n: maxString(1024).optional(),
});

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;

export const JsonEnvelopeSchema = z.object({
  status: z.union([z.literal("success"), z.literal("error")]),
  exit_code: z.number().int().optional(),
}).passthrough();
