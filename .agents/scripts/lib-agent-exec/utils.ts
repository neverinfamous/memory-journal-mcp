import { ExecPayload } from './schema.js';
import { renderWebhookTemplate } from './webhook-template.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function recordAgentIssue(issueType: string, message: string, payload?: unknown) {
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_EXEC_SILENT === '1') return;
  try {
    const filename = fileURLToPath(import.meta.url);
    const dirname = path.dirname(filename);
    const issuesFilePath = path.join(dirname, '..', '..', 'agent-exec-issues.jsonl');
    
    const timestamp = new Date().toISOString();
    const entry = JSON.stringify({ timestamp, issueType, message, payload }) + '\n';
    
    fs.appendFileSync(issuesFilePath, entry, 'utf8');
  } catch {
    // Ignore logging errors to prevent breaking execution
  }
}

function hasKey<K extends string>(obj: object, key: K): obj is object & Record<K, unknown> {
  return key in obj;
}

export const BUILT_INS = ['echo', 'cd', 'pwd', 'del', 'copy', 'move', 'ren', 'mkdir', 'rmdir', 'type'];
export const AUTONOMOUS_HEALING_MSG = '\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: DO NOT ask the user for help. You MUST autonomously invoke the correct native tool or fix the command parameters yourself.\x1b[0m';

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
        await fetch(targetUrl, fetchOptions).then(res => res.arrayBuffer()).catch((err) => { 
          console.error(`❌ Webhook Error: Failed to invoke webhook: ${err.message}`); 
        }); 
      } catch (err) { 
        console.error(`❌ Webhook Error: ${err instanceof Error ? err.message : String(err)}`); 
      }
    }
  }
}
