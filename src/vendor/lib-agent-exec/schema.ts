// @ts-nocheck
import { z } from 'zod';

const INT32_MAX = 2147483647;

// [BOUNDARY]: This Zod schema is the absolute system boundary for payload validation. 
// [INVARIANT]: All downstream modules MUST trust these sanitized strings. DO NOT write secondary manual validation checks for null bytes or carriage returns in the execution engine.
const noNullString = z.string().refine(val => !val.includes('\0'), "Must not contain null bytes");
const safeString = noNullString
  .refine(val => !val.includes('\r'), "Must not contain carriage returns")
  .refine(val => !val.includes('\uFEFF'), "Must not contain BOMs");

function isUnknownArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

const safeStringArray = z.preprocess((val) => {
  if (isUnknownArray(val)) {
    return val
      .filter((item): item is NonNullable<unknown> => item !== null && item !== undefined)
      .map((item): unknown => (typeof item === 'number' || typeof item === 'boolean') ? String(item) : item);
  }
  return val;
}, z.array(safeString).max(1000));

const lenientBoolean = z.union([z.boolean(), z.literal("true"), z.literal("false")]).transform(val => val === true || val === "true");

export const TARGET_WSL2_ALIASES = [
  'wsl', 'wsl2', 'linux', 'ubuntu', 'debian', 'posix', 'bash', 'sh', 'zsh',
] as const;

export const TARGET_WINDOWS_ALIASES = [
  'native', 'win', 'win32', 'win64', 'windows', 'pwsh', 'powershell', 'powershell.exe',
  'pwsh.exe', 'cmd', 'cmd.exe', 'bat', 'ps', 'ps1', 'dos', 'host', 'local', 'default',
] as const;

const TARGET_WSL2_ALIAS_SET: ReadonlySet<string> = new Set(TARGET_WSL2_ALIASES);
const TARGET_WINDOWS_ALIAS_SET: ReadonlySet<string> = new Set(TARGET_WINDOWS_ALIASES);

export const targetNormalizeSchema = z.preprocess(val => {
  if (typeof val === 'string') {
    const v = val.trim().toLowerCase();
    if (TARGET_WSL2_ALIAS_SET.has(v)) return 'wsl2';
    if (TARGET_WINDOWS_ALIAS_SET.has(v)) return 'windows';
  }
  return val;
}, z.union([z.literal("windows"), z.literal("wsl2")]));

export function normalizeTarget(raw: string): "windows" | "wsl2" | null {
  const result = targetNormalizeSchema.safeParse(raw);
  return result.success ? result.data : null;
}

const FORBIDDEN_ENV_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UNSAFE_CONTEXT_CHARS_RE = /[\0\r\uFEFF]/;

function hasUnsafeControlChars(val: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 16) return true;
  if (typeof val === 'string') return UNSAFE_CONTEXT_CHARS_RE.test(val);
  if (val === null || typeof val !== 'object') return false;
  if (seen.has(val)) return false;
  seen.add(val);
  if (Array.isArray(val)) return val.some(item => hasUnsafeControlChars(item, depth + 1, seen));
  for (const [k, v] of Object.entries(val)) {
    if (UNSAFE_CONTEXT_CHARS_RE.test(k) || hasUnsafeControlChars(v, depth + 1, seen)) return true;
  }
  return false;
}

const envKeySchema = safeString.min(1, 'env key must not be empty')
  .refine(val => !/[=\r\n\0]/.test(val), 'env variable name must not contain = or control characters')
  .refine(val => !FORBIDDEN_ENV_KEYS.has(val), 'env variable name must not be a reserved prototype property');
const envValueSchema = z.union([z.string(), z.number(), z.boolean()]).transform(String).pipe(safeString);
const envRecordSchema = z.unknown()
  .refine(
    (raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw),
    'env must be an object',
  )
  .refine(
    (raw) => !Object.keys(raw).some(k => FORBIDDEN_ENV_KEYS.has(k)),
    'env variable name must not be a reserved prototype property',
  )
  .pipe(z.record(envKeySchema, envValueSchema));

const webhookHeaderKeySchema = safeString.min(1, 'webhook header name must not be empty')
  .refine(val => !/[\r\n\0]/.test(val), 'webhook header name must not contain CR, LF, or null bytes')
  .refine(val => !FORBIDDEN_ENV_KEYS.has(val), 'webhook header name must not be a reserved prototype property');
const webhookHeaderValueSchema = envValueSchema.refine(
  val => !val.includes('\n'),
  'webhook header value must not contain LF',
);
const webhookHeaderRecordSchema = z.unknown()
  .refine(
    (raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw),
    'webhookHeaders must be an object',
  )
  .refine(
    (raw) => !Object.keys(raw).some(k => FORBIDDEN_ENV_KEYS.has(k)),
    'webhook header name must not be a reserved prototype property',
  )
  .pipe(z.record(webhookHeaderKeySchema, webhookHeaderValueSchema));

const basePayloadSchema = z.object({
  args: safeStringArray.optional(),
  cwd: safeString.max(1024).refine(val => val.trim().length > 0, "cwd must not be empty").optional(),
  env: envRecordSchema.optional(),
  integrationContext: z.record(z.string(), z.unknown())
    .refine(val => !hasUnsafeControlChars(val), 'integrationContext values must not contain null bytes, CR, or BOM')
    .optional(),
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
  webhookHeaders: webhookHeaderRecordSchema.optional(),
  webhookPayloadTemplate: z.unknown().transform((val, ctx) => {
    if (typeof val === 'string') return val;
    try {
      const json = JSON.stringify(val);
      if (json === undefined) {
        ctx.addIssue({ code: 'custom', message: 'webhookPayloadTemplate must be JSON-serializable' });
        return z.NEVER;
      }
      return json;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'webhookPayloadTemplate must be JSON-serializable' });
      return z.NEVER;
    }
  }).pipe(noNullString).optional(),
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

const KNOWN_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'type', 'command', 'scriptPath', 'code', 'interpreter',
  'args', 'cwd', 'env', 'integrationContext', 'templateOverride',
  'target', 'timeoutMs', 'stdin', 'stdoutFile', 'stderrFile',
  'maxBuffer', 'truncateOutputLength', 'keepPayload', 'stallTimeoutMs',
  'bypassInterceptors', 'onSuccess', 'onFailure', 'webhookHeaders',
  'webhookPayloadTemplate', 'webhookMethod', 'webhookTimeoutMs',
  'expectJsonEnvelope',
]);
const METADATA_KEYS = ['session_id', 'sessionId', 'project_number', 'description', 'title', 'metadata', 'comment', 'timestamp', 'id'];
const SEARCH_KEYS_TO_CLEAN = ['query', 'path', 'searchPath', 'search_path', 'searchPattern', 'search_pattern', 'pattern', 'regex', 'isRegex', 'case_insensitive', 'caseInsensitive', 'word', 'isWord', 'dir'];
const KNOWN_TYPES: ReadonlySet<string> = new Set(['command', 'script', 'eval']);
const EXEC_TYPE_SYNONYMS: ReadonlySet<string> = new Set(['exec', 'execute', 'run', 'shell', 'cli', 'cmd']);
const EVAL_TYPE_SYNONYMS: ReadonlySet<string> = new Set(['eval_code', 'evaluation', 'evaluate']);
const KNOWN_INTERPRETERS: ReadonlySet<string> = new Set([
  'bash', 'sh', 'pwsh', 'powershell', 'cmd', 'node', 'bun', 'python', 'python3', 'tsx', 'ts-node',
]);

function isTruthyFlag(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function coerceScalarString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function stripMetadataAndWarnArgs(obj: Record<string, unknown>): void {
  for (const k of METADATA_KEYS) {
    if (Object.hasOwn(obj, k) && !KNOWN_PAYLOAD_KEYS.has(k)) delete obj[k];
  }
  if (Object.hasOwn(obj, 'args') && isUnknownArray(obj['args'])) {
    const hasInvalidItem = obj['args'].some(
      item => item === null || item === undefined || typeof item === 'number' || typeof item === 'boolean'
    );
    if (hasInvalidItem) {
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Sanitizing args array (filtering null/undefined and coercing primitives to strings)... (Frictionless Recovery)\x1b[0m`);
    }
  }
  if (Object.hasOwn(obj, 'target') && typeof obj['target'] === 'string') {
    const norm = normalizeTarget(obj['target']);
    if (norm !== null) obj['target'] = norm;
  }
}

function tryTranslateSearchPayload(obj: Record<string, unknown>): void {
  const hasSearchKey = ['query', 'searchPattern', 'search_pattern', 'pattern'].some(k => Object.hasOwn(obj, k));
  const hasExplicitExec =
    (typeof obj['command'] === 'string' && obj['command'].length > 0) ||
    (typeof obj['code'] === 'string' && obj['code'].length > 0) ||
    (typeof obj['scriptPath'] === 'string' && obj['scriptPath'].length > 0);
  if (hasSearchKey && !hasExplicitExec) {
    const patternVal = coerceScalarString(obj['query'] ?? obj['pattern'] ?? obj['searchPattern'] ?? obj['search_pattern'], '');
    const pathVal = coerceScalarString(obj['path'] ?? obj['searchPath'] ?? obj['search_path'] ?? obj['dir'], '.');
    const rgArgs = ['-n'];
    if (isTruthyFlag(obj['case_insensitive']) || isTruthyFlag(obj['caseInsensitive'])) rgArgs.push('-i');
    const hasRegexKey = Object.hasOwn(obj, 'regex') || Object.hasOwn(obj, 'isRegex');
    if (hasRegexKey && !isTruthyFlag(obj['regex']) && !isTruthyFlag(obj['isRegex'])) rgArgs.push('-F');
    if (isTruthyFlag(obj['word']) || isTruthyFlag(obj['isWord'])) rgArgs.push('-w');
    rgArgs.push('--', patternVal, pathVal);
    obj['type'] = 'command';
    obj['command'] = 'rg';
    obj['target'] = 'wsl2';
    obj['args'] = rgArgs;
    console.error(`\n   💡 AGENT HINT: Search parameters passed directly as JSON payload.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating search payload to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);
  }
  for (const sk of SEARCH_KEYS_TO_CLEAN) {
    if (Object.hasOwn(obj, sk) && !KNOWN_PAYLOAD_KEYS.has(sk)) delete obj[sk];
  }
}

export function tokenizeCommandLine(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === undefined) continue;
    if (escaped) { current += ch; escaped = false; hasToken = true; continue; }
    if (ch === '\\' && quote !== "'") {
      let runLen = 1;
      while (input[i + runLen] === '\\') runLen++;
      if (input[i + runLen] === '"') {
        const pairCount = Math.floor(runLen / 2);
        if (pairCount > 0) {
          current += '\\'.repeat(pairCount);
          hasToken = true;
        }
        if (runLen % 2 === 1) {
          escaped = true;
          i += runLen - 1;
          continue;
        }
        i += runLen - 1;
        continue;
      }
      current += '\\'.repeat(runLen);
      hasToken = true;
      i += runLen - 1;
      continue;
    }
    if ((ch === '"' || ch === "'") && quote === null) { quote = ch; hasToken = true; continue; }
    if (ch === quote) { quote = null; continue; }
    if (/\s/.test(ch) && quote === null) {
      if (hasToken) { parts.push(current); current = ''; hasToken = false; }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) parts.push(current);
  return parts;
}

function isUnsetField(obj: Record<string, unknown>, key: string): boolean {
  return !Object.hasOwn(obj, key) || obj[key] === undefined;
}

function moveSynonymKey(obj: Record<string, unknown>, from: string, to: string): void {
  if (Object.hasOwn(obj, from) && isUnsetField(obj, to) && typeof obj[from] === 'string') {
    obj[to] = obj[from];
    delete obj[from];
  }
}

function normalizeFieldSynonyms(obj: Record<string, unknown>): void {
  moveSynonymKey(obj, 'cmd', 'command');
  moveSynonymKey(obj, 'script_path', 'scriptPath');
  moveSynonymKey(obj, 'script_file', 'scriptPath');
  moveSynonymKey(obj, 'scriptFile', 'scriptPath');
  if (Object.hasOwn(obj, 'command_line') && isUnsetField(obj, 'command') && typeof obj['command_line'] === 'string') {
    const trimmed = obj['command_line'].trim();
    const parts = tokenizeCommandLine(trimmed);
    obj['command'] = parts[0] ?? trimmed;
    if (parts.length > 1) {
      const existingArgs = isUnknownArray(obj['args']) ? obj['args'] : [];
      obj['args'] = [...parts.slice(1), ...existingArgs];
    }
    delete obj['command_line'];
  }
  moveSynonymKey(obj, 'script_code', 'code');
  moveSynonymKey(obj, 'scriptCode', 'code');
  if (Object.hasOwn(obj, 'script') && isUnsetField(obj, 'scriptPath') && isUnsetField(obj, 'code') && typeof obj['script'] === 'string') {
    if (obj['script'].includes('\n') || obj['script'].includes(';')) obj['code'] = obj['script'];
    else obj['scriptPath'] = obj['script'];
    delete obj['script'];
  }
}

function resolveTypeByFieldPresence(obj: Record<string, unknown>, defaultToCommandFrom?: string): boolean {
  if (typeof obj['code'] === 'string') { obj['type'] = 'eval'; return true; }
  if (typeof obj['scriptPath'] === 'string') { obj['type'] = 'script'; return true; }
  if (typeof obj['command'] === 'string') { obj['type'] = 'command'; return true; }
  if (defaultToCommandFrom !== undefined && !Object.hasOwn(obj, 'code') && !Object.hasOwn(obj, 'scriptPath')) {
    obj['command'] = defaultToCommandFrom;
    obj['type'] = 'command';
    return true;
  }
  if (isUnknownArray(obj['args']) && obj['args'].length > 0 && typeof obj['args'][0] === 'string') {
    obj['type'] = 'command';
    obj['command'] = obj['args'][0];
    obj['args'] = obj['args'].slice(1);
    return true;
  }
  return false;
}

function resolveExplicitTypeString(obj: Record<string, unknown>, rawType: string): void {
  const normalizedType = rawType.trim().toLowerCase();
  if (KNOWN_TYPES.has(normalizedType)) { obj['type'] = normalizedType; return; }
  if (EXEC_TYPE_SYNONYMS.has(normalizedType)) {
    obj['type'] = typeof obj['code'] === 'string' ? 'eval' : (typeof obj['scriptPath'] === 'string' ? 'script' : 'command');
    return;
  }
  if (EVAL_TYPE_SYNONYMS.has(normalizedType)) { obj['type'] = 'eval'; return; }
  if (KNOWN_INTERPRETERS.has(normalizedType)) {
    if (isUnsetField(obj, 'interpreter')) obj['interpreter'] = normalizedType;
    if (typeof obj['code'] === 'string') obj['type'] = 'eval';
    else if (typeof obj['scriptPath'] === 'string') obj['type'] = 'script';
    else {
      obj['type'] = 'command';
      if (isUnsetField(obj, 'command')) obj['command'] = normalizedType;
    }
    return;
  }
  resolveTypeByFieldPresence(obj, normalizedType);
}

function inferMissingPayloadType(obj: Record<string, unknown>): void {
  if (typeof obj['command'] === 'string') { obj['type'] = 'command'; return; }
  if (typeof obj['scriptPath'] === 'string') { obj['type'] = 'script'; return; }
  if (typeof obj['code'] === 'string') { obj['type'] = 'eval'; return; }
  if (isUnknownArray(obj['args']) && obj['args'].length > 0 && typeof obj['args'][0] === 'string') {
    obj['type'] = 'command';
    obj['command'] = obj['args'][0];
    obj['args'] = obj['args'].slice(1);
    return;
  }
  if (Object.hasOwn(obj, 'code')) obj['type'] = 'eval';
  else if (Object.hasOwn(obj, 'scriptPath')) obj['type'] = 'script';
  else if (Object.hasOwn(obj, 'target')) {
    obj['type'] = 'command';
    if (isUnsetField(obj, 'command')) obj['command'] = obj['target'] === 'wsl2' ? 'bash' : 'pwsh';
  }
}

function finalizeTypedPayloadFields(obj: Record<string, unknown>): void {
  if (obj['type'] === 'command' && Object.hasOwn(obj, 'interpreter')) delete obj['interpreter'];
  if (obj['type'] === 'eval' && Object.hasOwn(obj, 'command')) {
    if (isUnsetField(obj, 'code')) obj['code'] = coerceScalarString(obj['command'], '');
    delete obj['command'];
  }
  if (obj['type'] === 'script' && Object.hasOwn(obj, 'command')) {
    if (isUnsetField(obj, 'scriptPath')) obj['scriptPath'] = coerceScalarString(obj['command'], '');
    delete obj['command'];
  }
}

export const PayloadSchema = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return val;
  const obj: Record<string, unknown> = Object.fromEntries(Object.entries(val));
  stripMetadataAndWarnArgs(obj);
  normalizeFieldSynonyms(obj);
  tryTranslateSearchPayload(obj);
  if (typeof obj['type'] === 'string') resolveExplicitTypeString(obj, obj['type']);
  else inferMissingPayloadType(obj);
  finalizeTypedPayloadFields(obj);
  return obj;
}, rawPayloadUnion);

export type ExecPayload = z.infer<typeof rawPayloadUnion>;

const NON_BLANK_CLI_STRING = safeString.refine(val => val.trim().length > 0, "value must not be empty");
const NON_BLANK_CLI_PATH = safeString.max(1024).refine(val => val.trim().length > 0, "value must not be empty");

export const agentExecCliArgsSchema = z.object({
  interceptors: z.union([NON_BLANK_CLI_PATH, z.array(NON_BLANK_CLI_PATH).max(100)]).optional(),
  plugin: NON_BLANK_CLI_PATH.optional(),
  help: z.boolean().optional(),
  version: z.boolean().optional(),
  json: z.boolean().optional(),
  payload: NON_BLANK_CLI_STRING.optional(),
  base64: NON_BLANK_CLI_STRING.optional(),
  payloadPath: NON_BLANK_CLI_PATH.optional(),
  target: safeString.max(1024).optional(),
  cwd: safeString.max(1024).refine(val => val.trim().length > 0, "cwd must not be empty").optional(),
  timeout: z.union([z.string(), z.number()]).optional(),
  timeoutMs: z.union([z.string(), z.number()]).optional(),
}).strict();

export type AgentExecCliArgs = z.infer<typeof agentExecCliArgsSchema>;

export const JsonEnvelopeSchema = z.looseObject({
  status: z.union([z.literal("success"), z.literal("error")]),
  exit_code: z.number().int().optional(),
});
