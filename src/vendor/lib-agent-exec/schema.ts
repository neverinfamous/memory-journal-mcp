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

export const TARGET_WSL2_ALIASES = [
  'wsl', 'wsl2', 'linux', 'ubuntu', 'debian', 'posix', 'bash', 'sh', 'zsh',
] as const;

export const TARGET_WINDOWS_ALIASES = [
  'native', 'win', 'win32', 'win64', 'windows', 'pwsh', 'powershell', 'powershell.exe',
  'pwsh.exe', 'cmd', 'cmd.exe', 'bat', 'ps', 'ps1', 'dos', 'host', 'local', 'default',
] as const;

export const targetNormalizeSchema = z.preprocess(val => {
  if (typeof val === 'string') {
    const v = val.trim().toLowerCase();
    if ((TARGET_WSL2_ALIASES as readonly string[]).includes(v)) return 'wsl2';
    if ((TARGET_WINDOWS_ALIASES as readonly string[]).includes(v)) return 'windows';
  }
  return val;
}, z.union([z.literal("windows"), z.literal("wsl2")]));

export function normalizeTarget(raw: string): "windows" | "wsl2" | null {
  const result = targetNormalizeSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const basePayloadSchema = z.object({
  args: safeStringArray.optional(),
  cwd: safeString.max(1024).optional(),
  env: z.record(safeString, z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString)).optional(),
  integrationContext: z.record(z.string(), z.unknown()).optional(),
  templateOverride: safeString.max(1024).optional(),
  target: targetNormalizeSchema.optional(),
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

    if ('target' in obj && typeof obj.target === 'string') {
      const norm = normalizeTarget(obj.target);
      if (norm !== null) {
        obj.target = norm;
      }
    }

    // Auto-heal direct search query payloads (e.g. { query: "...", path: "...", regex: ..., case_insensitive: ... })
    const hasSearchPatternKey = 'query' in obj || 'searchPattern' in obj || 'search_pattern' in obj || 'pattern' in obj;
    const hasExplicitExec = ('command' in obj && typeof obj.command === 'string' && obj.command.length > 0) ||
      ('code' in obj && typeof obj.code === 'string' && obj.code.length > 0) ||
      ('scriptPath' in obj && typeof obj.scriptPath === 'string' && obj.scriptPath.length > 0);

    if (hasSearchPatternKey && !hasExplicitExec) {
      const patternVal = String(obj.query ?? obj.pattern ?? obj.searchPattern ?? obj.search_pattern ?? '');
      const pathVal = String(obj.path ?? obj.searchPath ?? obj.search_path ?? obj.dir ?? '.');
      const isCaseInsensitive = obj.case_insensitive === true || obj.caseInsensitive === true || String(obj.case_insensitive).toLowerCase() === 'true' || String(obj.caseInsensitive).toLowerCase() === 'true';
      const isRegex = obj.regex === true || obj.isRegex === true || String(obj.regex).toLowerCase() === 'true' || String(obj.isRegex).toLowerCase() === 'true';
      const isWord = obj.word === true || obj.isWord === true || String(obj.word).toLowerCase() === 'true' || String(obj.isWord).toLowerCase() === 'true';

      console.error(`\n   💡 AGENT HINT: Search parameters passed directly as JSON payload.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating search payload to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);

      obj.type = 'command';
      obj.command = 'rg';
      obj.target = 'wsl2';
      const rgArgs = ['-n'];
      if (isCaseInsensitive) rgArgs.push('-i');
      if (!isRegex && ('regex' in obj || 'isRegex' in obj)) rgArgs.push('-F');
      if (isWord) rgArgs.push('-w');
      rgArgs.push(patternVal);
      rgArgs.push(pathVal);
      obj.args = rgArgs;
    }

    // Clean stray search keys if present
    const searchKeysToClean = ['query', 'path', 'searchPath', 'search_path', 'searchPattern', 'search_pattern', 'pattern', 'regex', 'isRegex', 'case_insensitive', 'caseInsensitive', 'word', 'isWord', 'dir'];
    for (const sk of searchKeysToClean) {
      if (sk in obj && !knownKeys.has(sk)) {
        delete obj[sk];
      }
    }
    // Normalize common field synonyms
    if ('cmd' in obj && !('command' in obj) && typeof obj.cmd === 'string') {
      obj.command = obj.cmd;
      delete obj.cmd;
    }
    if ('script_path' in obj && !('scriptPath' in obj) && typeof obj.script_path === 'string') {
      obj.scriptPath = obj.script_path;
      delete obj.script_path;
    }
    if ('script_file' in obj && !('scriptPath' in obj) && typeof obj.script_file === 'string') {
      obj.scriptPath = obj.script_file;
      delete obj.script_file;
    }
    if ('scriptFile' in obj && !('scriptPath' in obj) && typeof obj.scriptFile === 'string') {
      obj.scriptPath = obj.scriptFile;
      delete obj.scriptFile;
    }
    if ('command_line' in obj && !('command' in obj) && typeof obj.command_line === 'string') {
      const trimmed = obj.command_line.trim();
      if (!('args' in obj) && /\s+/.test(trimmed)) {
        const parts = trimmed.split(/\s+/);
        obj.command = parts[0] ?? trimmed;
        obj.args = parts.slice(1);
      } else {
        obj.command = trimmed;
      }
      delete obj.command_line;
    }
    if ('script_code' in obj && !('code' in obj) && typeof obj.script_code === 'string') {
      obj.code = obj.script_code;
      delete obj.script_code;
    }
    if ('scriptCode' in obj && !('code' in obj) && typeof obj.scriptCode === 'string') {
      obj.code = obj.scriptCode;
      delete obj.scriptCode;
    }
    if ('script' in obj && !('scriptPath' in obj) && !('code' in obj) && typeof obj.script === 'string') {
      if (obj.script.includes('\n') || obj.script.includes(';')) {
        obj.code = obj.script;
      } else {
        obj.scriptPath = obj.script;
      }
      delete obj.script;
    }

    const knownTypes = ['command', 'script', 'eval'];
    if (typeof obj.type === 'string') {
      const normalizedType = obj.type.trim().toLowerCase();
      if (knownTypes.includes(normalizedType)) {
        obj.type = normalizedType;
      } else if (['exec', 'execute', 'run', 'shell', 'cli', 'cmd'].includes(normalizedType)) {
        if ('code' in obj && typeof obj.code === 'string') {
          obj.type = 'eval';
        } else if ('scriptPath' in obj && typeof obj.scriptPath === 'string') {
          obj.type = 'script';
        } else {
          obj.type = 'command';
        }
      } else if (['eval_code', 'evaluation', 'evaluate'].includes(normalizedType)) {
        obj.type = 'eval';
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
        } else if (!('code' in obj) && !('scriptPath' in obj)) {
          obj.command = normalizedType;
          obj.type = 'command';
        } else if (Array.isArray(obj.args) && obj.args.length > 0 && typeof obj.args[0] === 'string') {
          obj.type = 'command';
          obj.command = obj.args[0];
          obj.args = obj.args.slice(1);
        }
      }
    } else {
      if ('command' in obj && typeof obj.command === 'string') {
        obj.type = 'command';
      } else if ('scriptPath' in obj && typeof obj.scriptPath === 'string') {
        obj.type = 'script';
      } else if ('code' in obj && typeof obj.code === 'string') {
        obj.type = 'eval';
      } else if (Array.isArray(obj.args) && obj.args.length > 0 && typeof obj.args[0] === 'string') {
        obj.type = 'command';
        obj.command = obj.args[0];
        obj.args = obj.args.slice(1);
      } else {
        if ('code' in obj) {
          obj.type = 'eval';
        } else if ('scriptPath' in obj) {
          obj.type = 'script';
        } else {
          obj.type = 'command';
          if (!('command' in obj)) {
            obj.command = obj.target === 'wsl2' ? 'bash' : 'pwsh';
          }
        }
      }
    }

    if (obj.type === 'command' && 'interpreter' in obj) {
      delete obj.interpreter;
    }
    if (obj.type === 'eval' && 'command' in obj && !('code' in obj)) {
      obj.code = String(obj.command);
      delete obj.command;
    } else if (obj.type === 'eval' && 'command' in obj) {
      delete obj.command;
    }
    if (obj.type === 'script' && 'command' in obj && !('scriptPath' in obj)) {
      obj.scriptPath = String(obj.command);
      delete obj.command;
    } else if (obj.type === 'script' && 'command' in obj) {
      delete obj.command;
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
  version: z.boolean().optional(),
  json: z.boolean().optional(),
  payload: z.string().optional(),
  payloadPath: z.string().max(1024).optional(),
  target: z.string().max(1024).optional(),
  cwd: z.string().max(1024).optional(),
  timeout: z.union([z.string(), z.number()]).optional(),
  timeoutMs: z.union([z.string(), z.number()]).optional(),
});

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;

export const JsonEnvelopeSchema = z.object({
  status: z.union([z.literal("success"), z.literal("error")]),
  exit_code: z.number().int().optional(),
}).passthrough();
