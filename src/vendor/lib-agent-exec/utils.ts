import { ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function recordAgentIssue(issueType: string, message: string, payload?: unknown) {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_EXEC_SILENT === '1') return;
  try {
    const filename = fileURLToPath(import.meta.url);
    let targetDir = path.join(path.dirname(filename), '..', '..');

    if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).cwd === 'string') {
      const root = findEcosystemRoot((payload as Record<string, unknown>).cwd as string);
      if (root) {
        targetDir = path.join(root, '.agents');
      }
    }
    
    const issuesFilePath = path.join(targetDir, 'agent-exec-issues.jsonl');
    
    let safePayload = payload;
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      let cloned = false;
      const truncateStr = (val: unknown) => {
        if (typeof val === 'string' && val.length > 2000) {
          return val.substring(0, 2000) + '... [truncated]';
        }
        return val;
      };

      for (const key of ['stdin', 'code', 'integrationContext']) {
        if (key in p && typeof p[key] === 'string' && (p[key] as string).length > 2000) {
          if (!cloned) {
            safePayload = { ...p };
            cloned = true;
          }
          (safePayload as Record<string, unknown>)[key] = truncateStr(p[key]);
        }
      }
    }

    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, issueType, message, payload: safePayload }) + '\n';
    
    fs.appendFileSync(issuesFilePath, entry, 'utf8');
  } catch {
    // Ignore logging errors to prevent breaking execution
  }
}

function hasKey<K extends string>(obj: object, key: K): obj is object & Record<K, unknown> {
  return key in obj;
}

export const BUILT_INS = ['echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
export const AUTONOMOUS_HEALING_MSG = '\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m';

export function replaceIntegrationContext(str: string, payload: ExecPayload): string {
  if (!('integrationContext' in payload) || !payload.integrationContext) return str;
  const contextStr = JSON.stringify(payload.integrationContext);
  return str.replace(/\{\{integrationContext(?:\.([a-zA-Z0-9_.]+))?\}\}/g, (match, pathStr) => {
    if (!pathStr) return contextStr;
    let current: unknown = payload.integrationContext;
    const keys = pathStr.split('.');
    for (const key of keys) {
      if (current == null || typeof current !== 'object' || !hasKey(current, key)) return match;
      current = current[key];
    }
    return typeof current === 'object' 
      ? JSON.stringify(current) 
      : (typeof current === 'string' ? JSON.stringify(current).slice(1, -1) : String(current));
  });
}

export async function sendWebhook(
  payload: ExecPayload,
  urls: string | string[],
  vars: { stdout: string, stderr: string, code: number | null, signal: NodeJS.Signals | null, success: boolean, envData: Record<string, unknown> | null }
) {
  const headers = { 'Content-Type': 'application/json', ...(payload.webhookHeaders || {}) };
  let body: string;

  if ('webhookPayloadTemplate' in payload && payload.webhookPayloadTemplate) {
    body = renderWebhookTemplate(
      payload.webhookPayloadTemplate,
      'integrationContext' in payload ? payload.integrationContext : null,
      vars
    );
  } else {
    body = JSON.stringify({ 
      success: vars.success, 
      code: vars.code, 
      signal: vars.signal, 
      stdout: vars.stdout, 
      stderr: vars.stderr 
    });
    body = replaceIntegrationContext(body, payload);
  }

  const urlArray = Array.isArray(urls) ? urls : [urls];
  for (const u of urlArray) {
    const targetUrl = replaceIntegrationContext(u, payload);
    const method = payload.webhookMethod || 'POST';
    const timeoutMs = payload.webhookTimeoutMs ?? 5000;

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      console.error(`❌ Webhook Error: Invalid or unsafe target URL for webhook. Only http/https allowed.`);
    } else {
      const fetchOptions: RequestInit = { method, headers };
      if (timeoutMs > 0) {
        fetchOptions.signal = AbortSignal.timeout(timeoutMs);
      }
      if (method !== 'GET') fetchOptions.body = body;
      try { 
        await fetch(targetUrl, fetchOptions).then(async res => {
          if (!res.ok) {
            console.error(`❌ Webhook Error: HTTP ${res.status} ${res.statusText}`);
          }
          return res.arrayBuffer();
        }).catch((err) => { 
          console.error(`❌ Webhook Error: Failed to invoke webhook: ${err.message}`); 
        }); 
      } catch (err) { 
        console.error(`❌ Webhook Error: ${err instanceof Error ? err.message : String(err)}`); 
      }
    }
  }
}

export function findEcosystemRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const agentsDir = path.join(current, '.agents');
    if (fs.existsSync(agentsDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function findEcosystemScript(startDir: string, scriptName: string): string | null {
  const root = findEcosystemRoot(startDir);
  if (!root) return null;
  const scriptPath = path.join(root, '.agents', 'scripts', scriptName);
  if (fs.existsSync(scriptPath)) {
    return scriptPath;
  }
  return null;
}
