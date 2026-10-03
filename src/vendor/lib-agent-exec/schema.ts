// @ts-nocheck
import { z } from 'zod';

const INT32_MAX = 2147483647;

// [BOUNDARY]: This Zod schema is the absolute system boundary for payload validation. 
// [INVARIANT]: All downstream modules MUST trust these sanitized strings. DO NOT write secondary manual validation checks for null bytes or carriage returns in the execution engine.
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
  target: z.preprocess(val => {
    if (typeof val === 'string') {
      const v = val.toLowerCase();
      if (['wsl', 'linux', 'ubuntu'].includes(v)) return 'wsl2';
      if (['native', 'win', 'win32'].includes(v)) return 'windows';
    }
    return val;
  }, z.union([z.literal("windows"), z.literal("wsl2")])).optional(),
  timeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, INT32_MAX)).optional(),
  stdin: z.string().max(10 * 1024 * 1024).optional(),
  stdoutFile: safeString.optional(),
  stderrFile: safeString.optional(),
  maxBuffer: z.number().int().positive().max(INT32_MAX).optional(),
  truncateOutputLength: z.number().int().positive().max(INT32_MAX).optional(),
  keepPayload: lenientBoolean.optional(),
  stallTimeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, INT32_MAX)).optional(),
  bypassInterceptors: lenientBoolean.optional(),
  onSuccess: z.union([safeString, safeStringArray]).optional(),
  onFailure: z.union([safeString, safeStringArray]).optional(),
  webhookHeaders: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  webhookPayloadTemplate: z.unknown().transform(val => typeof val === 'string' ? val : JSON.stringify(val)).pipe(noNullString).optional(),
  webhookMethod: z.union([z.literal("GET"), z.literal("POST"), z.literal("PUT"), z.literal("PATCH"), z.literal("DELETE")]).optional(),
  webhookTimeoutMs: z.number().int().nonnegative().transform(val => Math.min(val, INT32_MAX)).optional(),
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

export const PayloadSchema = z.preprocess((val) => {
  if (typeof val === 'object' && val !== null) {
    const obj = { ...(val as Record<string, unknown>) };
    const knownKeys = new Set([
      'type', 'command', 'scriptPath', 'code', 'interpreter',
      'args', 'cwd', 'env', 'integrationContext', 'templateOverride',
      'target', 'timeoutMs', 'stdin', 'stdoutFile', 'stderrFile',
      'maxBuffer', 'truncateOutputLength', 'keepPayload', 'stallTimeoutMs',
      'bypassInterceptors', 'onSuccess', 'onFailure', 'webhookHeaders',
      'webhookPayloadTemplate', 'webhookMethod', 'webhookTimeoutMs',
      'expectJsonEnvelope'
    ]);
    const metadataKeys = ['session_id', 'sessionId', 'project_number', 'description', 'title', 'metadata', 'comment', 'timestamp', 'id'];
    for (const k of metadataKeys) {
      if (k in obj && !knownKeys.has(k)) {
        delete obj[k];
      }
    }
    const knownTypes = ['command', 'script', 'eval'];
    if (typeof obj.type === 'string') {
      const normalizedType = obj.type.trim().toLowerCase();
      if (knownTypes.includes(normalizedType)) {
        obj.type = normalizedType;
      } else {
        const knownInterpreters = ['bash', 'sh', 'pwsh', 'powershell', 'cmd', 'node', 'bun', 'python', 'python3', 'tsx', 'ts-node'];
        if (knownInterpreters.includes(normalizedType)) {
          if (!('interpreter' in obj)) {
            obj.interpreter = normalizedType;
          }
          if ('code' in obj && typeof obj.code === 'string') {
            obj.type = 'eval';
          } else if ('scriptPath' in obj && typeof obj.scriptPath === 'string') {
            obj.type = 'script';
          } else {
            obj.type = 'command';
            if (!('command' in obj)) {
              obj.command = normalizedType;
            }
          }
        } else if ('code' in obj && typeof obj.code === 'string') {
          obj.type = 'eval';
        } else if ('scriptPath' in obj && typeof obj.scriptPath === 'string') {
          obj.type = 'script';
        } else if ('command' in obj && typeof obj.command === 'string') {
          obj.type = 'command';
        }
      }
    } else if (!('type' in obj)) {
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
    return obj;
  }
  return val;
}, rawPayloadUnion);

export type ExecPayload = z.infer<typeof rawPayloadUnion>;

export const agentExecCliArgsSchema = z.object({
  interceptors: z.union([z.string().max(1024), z.array(z.string().max(1024)).max(100)]).optional(),
  plugin: z.string().max(1024).optional(),
  help: z.boolean().optional(),
  json: z.boolean().optional(),
  payload: z.string().optional(),
  payloadPath: z.string().max(1024).optional(),
  target: z.string().max(1024).optional(),
  cwd: z.string().max(1024).optional(),
  timeout: z.union([z.string(), z.number()]).optional(),
  timeoutMs: z.union([z.string(), z.number()]).optional(),
});

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;

const targetNormalizeSchema = z.preprocess(val => {
  if (typeof val === 'string') {
    const v = val.toLowerCase();
    if (['wsl', 'linux', 'ubuntu'].includes(v)) return 'wsl2';
    if (['native', 'win', 'win32'].includes(v)) return 'windows';
  }
  return val;
}, z.union([z.literal("windows"), z.literal("wsl2")]));

export function normalizeTarget(raw: string): "windows" | "wsl2" | null {
  const result = targetNormalizeSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export const JsonEnvelopeSchema = z.object({
  status: z.union([z.literal("success"), z.literal("error")]),
  exit_code: z.number().int().optional(),
}).passthrough();
