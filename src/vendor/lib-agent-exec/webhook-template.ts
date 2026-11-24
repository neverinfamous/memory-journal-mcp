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

const COMBINED_PLACEHOLDER_RE = /\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}|\{\{(stdout|stderr|code|signal|success|envelope\.data|envelope\.status)\}\}/g;
const EXACT_CONTEXT_PLACEHOLDER_RE = /^\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}$/;

function formatJsonStringFragment(value: string, escapeForRawJson: boolean): string {
  return escapeForRawJson ? JSON.stringify(value).slice(1, -1) : value;
}

function resolveContextToken(match: string, pathStr: string | undefined, integrationContext: unknown, escapeForRawJson: boolean): string {
  if (integrationContext === undefined) return match;
  const current = safeGet(integrationContext, typeof pathStr === 'string' ? pathStr : '');
  if (current === undefined) return match;
  if (typeof current === 'object') {
    const serialized = JSON.stringify(current);
    return escapeForRawJson ? formatJsonStringFragment(serialized, true) : serialized;
  }
  return typeof current === 'string' ? formatJsonStringFragment(current, escapeForRawJson) : String(current);
}

function resolveVarPlaceholder(key: string, vars: Record<string, unknown>, escapeForRawJson: boolean): string | null {
  if (key === 'stdout') return formatJsonStringFragment(String(vars['stdout'] ?? ''), escapeForRawJson);
  if (key === 'stderr') return formatJsonStringFragment(String(vars['stderr'] ?? ''), escapeForRawJson);
  if (key === 'code') return String(vars['code'] ?? 'null');
  if (key === 'signal') {
    const sig = vars['signal'];
    return typeof sig === 'string' ? formatJsonStringFragment(sig, escapeForRawJson) : (sig !== undefined && sig !== null ? String(sig) : 'null');
  }
  if (key === 'success') return vars['success'] === true ? 'true' : 'false';
  if (key === 'envelope.data') {
    const data = safeGet(vars['envData'], 'data');
    if (data === undefined) return 'null';
    const serialized = JSON.stringify(data);
    return escapeForRawJson && typeof data === 'string' ? serialized.slice(1, -1) : serialized;
  }
  if (key === 'envelope.status') {
    const status = safeGet(vars['envData'], 'status');
    if (status === undefined || status === null) return 'null';
    return typeof status === 'string' ? formatJsonStringFragment(status, escapeForRawJson) : String(status);
  }
  return null;
}

function replaceAllPlaceholdersSinglePass(
  input: string,
  integrationContext: unknown,
  vars: Record<string, unknown>,
  escapeForRawJson: boolean,
): string {
  return input.replace(COMBINED_PLACEHOLDER_RE, (match, ctxPath?: string, varKey?: string) => {
    if (varKey !== undefined) return resolveVarPlaceholder(varKey, vars, escapeForRawJson) ?? match;
    return resolveContextToken(match, ctxPath, integrationContext, escapeForRawJson);
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
  return replaceAllPlaceholdersSinglePass(node, integrationContext, vars, false);
}

function walkTemplateNode(node: unknown, integrationContext: unknown, vars: Record<string, unknown>): unknown {
  if (typeof node === 'string') return substituteTemplateString(node, integrationContext, vars);
  if (Array.isArray(node)) return node.map((item) => walkTemplateNode(item, integrationContext, vars));
  if (node !== null && typeof node === 'object') {
    const out = Object.create(null) as Record<string, unknown>;
    for (const [k, v] of Object.entries(node)) {
      out[k] = walkTemplateNode(v, integrationContext, vars);
    }
    return out;
  }
  return node;
}

function renderFallbackTemplate(templateStr: string, integrationContext: unknown, vars: Record<string, unknown>): string {
  return replaceAllPlaceholdersSinglePass(templateStr, integrationContext, vars, true);
}

export function renderWebhookTemplate(templateStr: string, integrationContext: unknown, vars: Record<string, unknown>): string {
  try {
    const obj: unknown = JSON.parse(templateStr);
    return JSON.stringify(walkTemplateNode(obj, integrationContext, vars));
  } catch {
    return renderFallbackTemplate(templateStr, integrationContext, vars);
  }
}

