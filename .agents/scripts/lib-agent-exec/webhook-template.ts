function hasKey<K extends PropertyKey>(obj: object, key: K): obj is Record<K, unknown> {
  return key in obj;
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

export function renderWebhookTemplate(templateStr: string, integrationContext: unknown, vars: Record<string, unknown>): string {
  try {
    const obj = JSON.parse(templateStr);
    const walk = (node: unknown): unknown => {
      if (typeof node === 'string') {
        if (node === '{{envelope.data}}') return safeGet(vars.envData, 'data') ?? null;
        if (node === '{{envelope.status}}') return safeGet(vars.envData, 'status') ?? null;
        if (node === '{{stdout}}') return vars.stdout ?? '';
        if (node === '{{stderr}}') return vars.stderr ?? '';
        if (node === '{{code}}') return vars.code ?? null;
        if (node === '{{signal}}') return vars.signal ?? null;
        if (node === '{{success}}') return vars.success ?? false;
        
        let replaced: string = node;
        if (integrationContext !== undefined) {
          const exactMatch = /^\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}$/.exec(node);
          if (exactMatch) {
            const pathStr = exactMatch[1] || '';
            const current = safeGet(integrationContext, pathStr);
            if (current !== undefined && current !== node) return current;
          }

          replaced = replaced.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
            const current = safeGet(integrationContext, pathStr || '');
            if (current === undefined) return match;
            return typeof current === 'object' ? JSON.stringify(current) : String(current);
          });
        }
        
        replaced = replaced.replace(/\{\{(stdout|stderr|code|signal|success|envelope\.data|envelope\.status)\}\}/g, (match, key) => {
          if (key === 'stdout') return String(vars.stdout ?? '');
          if (key === 'stderr') return String(vars.stderr ?? '');
          if (key === 'code') return String(vars.code ?? 'null');
          if (key === 'signal') return String(vars.signal ?? 'null');
          if (key === 'success') return vars.success ? 'true' : 'false';
          if (key === 'envelope.data') {
            const data = safeGet(vars.envData, 'data');
            return data !== undefined ? JSON.stringify(data) : 'null';
          }
          if (key === 'envelope.status') {
            const status = safeGet(vars.envData, 'status');
            return status !== undefined ? String(status) : 'null';
          }
          return match;
        });

        return replaced;
      }
      if (Array.isArray(node)) return node.map(walk);
      if (node !== null && typeof node === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node)) {
          out[k] = walk(v);
        }
        return out;
      }
      return node;
    };
    return JSON.stringify(walk(obj));
  } catch {
    // fallback to naive replace for non-JSON templates
    const replaceCtx = (str: string) => {
      if (integrationContext === undefined) return str;
      return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
        const current = safeGet(integrationContext, pathStr || '');
        if (current === undefined) return match;
        return typeof current === 'object' ? JSON.stringify(current) : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
      });
    };
    let body = replaceCtx(templateStr);
    
    body = body.replace(/\{\{(stdout|stderr|code|signal|success|envelope\.data|envelope\.status)\}\}/g, (match, key) => {
      if (key === 'stdout') return JSON.stringify(vars.stdout ?? '').slice(1, -1);
      if (key === 'stderr') return JSON.stringify(vars.stderr ?? '').slice(1, -1);
      if (key === 'code') return String(vars.code ?? 'null');
      if (key === 'signal') return String(vars.signal ?? 'null');
      if (key === 'success') return vars.success ? 'true' : 'false';
      if (key === 'envelope.data') {
        const data = safeGet(vars.envData, 'data');
        return data !== undefined ? JSON.stringify(data).slice(1, -1) : 'null';
      }
      if (key === 'envelope.status') {
        const status = safeGet(vars.envData, 'status');
        return status !== undefined ? String(status) : 'null';
      }
      return match;
    });

    return body;
  }
}

