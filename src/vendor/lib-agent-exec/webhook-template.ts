// @ts-nocheck
function hasKey<K extends PropertyKey>(obj: object, key: K): obj is Record<K, unknown> {
  return Object.hasOwn(obj, key);
}

function safeGet(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let current = obj;
  for (const key of path.split('.')) {
    if (typeof current === 'object' && current !== null && hasKey(current, key)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

const CONTEXT_PLACEHOLDER_RE = /\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g;
const EXACT_CONTEXT_PLACEHOLDER_RE = /^\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}$/;
const VAR_PLACEHOLDER_RE = /\{\{(stdout|stderr|code|signal|success|envelope\.data|envelope\.status)\}\}/g;

function formatJsonStringFragment(value: string, escapeForRawJson: boolean): string {
  return escapeForRawJson ? JSON.stringify(value).slice(1, -1) : value;
}

function replaceContextPlaceholders(
  input: string,
  integrationContext: unknown,
  escapeForRawJson: boolean,
): string {
  if (integrationContext === undefined) return input;
  return input.replace(CONTEXT_PLACEHOLDER_RE, (match, pathStr) => {
    const current = safeGet(integrationContext, typeof pathStr === 'string' ? pathStr : '');
    if (current === undefined) return match;
    if (typeof current === 'object') return JSON.stringify(current);
    return typeof current === 'string'
      ? formatJsonStringFragment(current, escapeForRawJson)
      : String(current);
  });
}

function resolveVarPlaceholder(key: string, vars: Record<string, unknown>, escapeForRawJson: boolean): string | null {
  if (key === 'stdout') return formatJsonStringFragment(String(vars['stdout'] ?? ''), escapeForRawJson);
  if (key === 'stderr') return formatJsonStringFragment(String(vars['stderr'] ?? ''), escapeForRawJson);
  if (key === 'code') return String(vars['code'] ?? 'null');
  if (key === 'signal') return String(vars['signal'] ?? 'null');
  if (key === 'success') return vars['success'] ? 'true' : 'false';
  if (key === 'envelope.data') {
    const data = safeGet(vars['envData'], 'data');
    if (data === undefined) return 'null';
    const serialized = JSON.stringify(data);
    return escapeForRawJson && typeof data === 'string' ? serialized.slice(1, -1) : serialized;
  }
  if (key === 'envelope.status') {
    const status = safeGet(vars['envData'], 'status');
    return status !== undefined ? String(status) : 'null';
  }
  return null;
}

function replaceVarPlaceholders(input: string, vars: Record<string, unknown>, escapeForRawJson: boolean): string {
  return input.replace(VAR_PLACEHOLDER_RE, (match, key) => {
    if (typeof key !== 'string') return match;
    return resolveVarPlaceholder(key, vars, escapeForRawJson) ?? match;
  });
}

function substituteTemplateString(node: string, integrationContext: unknown, vars: Record<string, unknown>): unknown {
  if (node === '{{envelope.data}}') return safeGet(vars['envData'], 'data') ?? null;
  if (node === '{{envelope.status}}') return safeGet(vars['envData'], 'status') ?? null;
  if (node === '{{stdout}}') return vars['stdout'] ?? '';
  if (node === '{{stderr}}') return vars['stderr'] ?? '';
  if (node === '{{code}}') return vars['code'] ?? null;
  if (node === '{{signal}}') return vars['signal'] ?? null;
  if (node === '{{success}}') return vars['success'] ?? false;

  if (integrationContext !== undefined) {
    const exactMatch = EXACT_CONTEXT_PLACEHOLDER_RE.exec(node);
    if (exactMatch) {
      const current = safeGet(integrationContext, exactMatch[1] ?? '');
      if (current !== undefined && current !== node) return current;
    }
  }
  const withContext = replaceContextPlaceholders(node, integrationContext, false);
  return replaceVarPlaceholders(withContext, vars, false);
}

function walkTemplateNode(node: unknown, integrationContext: unknown, vars: Record<string, unknown>): unknown {
  if (typeof node === 'string') return substituteTemplateString(node, integrationContext, vars);
  if (Array.isArray(node)) return node.map((item) => walkTemplateNode(item, integrationContext, vars));
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = walkTemplateNode(v, integrationContext, vars);
    }
    return out;
  }
  return node;
}

function renderFallbackTemplate(templateStr: string, integrationContext: unknown, vars: Record<string, unknown>): string {
  const withContext = replaceContextPlaceholders(templateStr, integrationContext, true);
  return replaceVarPlaceholders(withContext, vars, true);
}

export function renderWebhookTemplate(templateStr: string, integrationContext: unknown, vars: Record<string, unknown>): string {
  try {
    const obj: unknown = JSON.parse(templateStr);
    return JSON.stringify(walkTemplateNode(obj, integrationContext, vars));
  } catch {
    return renderFallbackTemplate(templateStr, integrationContext, vars);
  }
}

