// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertToWindowsPath, convertToWslPath, getPositionalArgIndices, getPositionalArgs } from '../command-utils.js';
import type { ExecutionContext } from './types.js';
import { hasJqShortOrLongFlag, scanJqFromFiles } from './utils.js';

const sanitizedJqTempFiles = new Set<string>();
let jqExitCleanupRegistered = false;

function registerJqTempFile(filePath: string): void {
  sanitizedJqTempFiles.add(filePath);
  if (jqExitCleanupRegistered) return;
  jqExitCleanupRegistered = true;
  process.once('exit', () => {
    for (const p of sanitizedJqTempFiles) {
      try {
        if (fs.statSync(p, { throwIfNoEntry: false }) !== undefined) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  });
}

function isValidJsonOrJsonl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Check JSONL (each non-empty line valid JSON)
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) return false;
    try {
      for (const line of lines) JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  }
}

interface SanitizedJqText {
  cleaned: string;
  reason: 'tags' | 'fence' | 'warning' | null;
  tagName?: string;
}

function stripJqPreambleNoise(raw: string): SanitizedJqText {
  if (isValidJsonOrJsonl(raw)) {
    return { cleaned: raw, reason: null };
  }
  const tagMatch = raw.match(/<([a-zA-Z0-9_-]+_output|output)>([\s\S]*?)<\/\1>/i);
  if (tagMatch?.[2] !== undefined && tagMatch[1] !== undefined) {
    const cand = tagMatch[2].trim();
    if (cand.length > 0 && cand !== raw && isValidJsonOrJsonl(cand)) {
      return { cleaned: cand, reason: 'tags', tagName: tagMatch[1] };
    }
  }
  const openIdx = raw.indexOf('```');
  if (openIdx !== -1) {
    const closeIdx = raw.lastIndexOf('```');
    if (closeIdx > openIdx + 2) {
      let inner = raw.slice(openIdx + 3, closeIdx);
      if (inner.slice(0, 4).toLowerCase() === 'json') {
        inner = inner.slice(4);
      }
      const cand = inner.trim();
      if (cand.length > 0 && cand !== raw && isValidJsonOrJsonl(cand)) {
        return { cleaned: cand, reason: 'fence' };
      }
    }
  }
  if (raw.includes('[WARNING:') || raw.includes('<database_output>')) {
    const cleaned = raw
      .replace(/\[WARNING:[^\]]*\]/gi, '')
      .replace(/<database_output>/gi, '')
      .replace(/<\/database_output>/gi, '')
      .trim();
    if (cleaned.length > 0 && cleaned !== raw && isValidJsonOrJsonl(cleaned)) {
      return { cleaned, reason: 'warning' };
    }
  }
  return { cleaned: raw, reason: null };
}

function hasJqRawInputFlag(args: readonly string[]): boolean {
  return hasJqShortOrLongFlag(args, 'R', '--raw-input');
}

function sanitizeJqStdin(ctx: ExecutionContext): void {
  if (typeof ctx.payload.stdin !== 'string' || ctx.payload.stdin.length === 0) return;
  const result = stripJqPreambleNoise(ctx.payload.stdin);
  if (result.reason === null || result.cleaned === ctx.payload.stdin) return;
  ctx.payload.stdin = result.cleaned;
  if (result.reason === 'tags') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags (<${result.tagName}>) from jq stdin... (Frictionless Recovery)\x1b[0m`);
  } else if (result.reason === 'fence') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped markdown code fences from jq stdin... (Frictionless Recovery)\x1b[0m`);
  } else if (result.reason === 'warning') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped warning preambles from jq stdin... (Frictionless Recovery)\x1b[0m`);
  }
}

function resolveJqFileArg(fileArg: string, cwd: string): { isWslPath: boolean; resolvedFile: string } {
  const rawFile = fileArg.replace(/^['"]|['"]$/g, '');
  const isWslPath = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(rawFile);
  const wslNormalized = isWslPath ? convertToWindowsPath(rawFile) : rawFile;
  const resolvedFile = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
  return { isWslPath, resolvedFile };
}

export function sanitizeJqInvocation(ctx: ExecutionContext, args: string[]): void {
  const hasStdin = ctx.payload.stdin !== undefined && ctx.payload.stdin.length > 0;
  const { hasFromFile: hasFilterFile } = scanJqFromFiles(args);
  if (hasStdin && !hasFilterFile && getPositionalArgs('jq', args).length === 0) {
    ctx.args.push('.');
    if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
      ctx.payload.args = [...ctx.args];
    }
    console.error(`\n   💡 AGENT HINT: 'jq' requires a filter argument when reading from stdin.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '.' filter... (Frictionless Recovery)\x1b[0m`);
  }
  if (hasJqRawInputFlag(ctx.args)) return;
  sanitizeJqStdin(ctx);

  const rawPayloadCwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? ctx.payload.cwd : undefined;
  if (process.platform === 'win32' && rawPayloadCwd !== undefined &&
    ((rawPayloadCwd.startsWith('/') && !/^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd)) || rawPayloadCwd.startsWith('~'))) {
    return;
  }
  const normPayloadCwd = rawPayloadCwd !== undefined && process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(rawPayloadCwd)
    ? convertToWindowsPath(rawPayloadCwd)
    : rawPayloadCwd;
  const hostCtxCwd = ctx.cwd !== undefined && ctx.cwd.length > 0 ? ctx.cwd : undefined;
  const cwd = normPayloadCwd !== undefined
    ? path.resolve(normPayloadCwd)
    : (hostCtxCwd !== undefined ? path.resolve(hostCtxCwd) : process.cwd());
  const posIndices = getPositionalArgIndices('jq', ctx.args);
  const fileIndices = hasFilterFile ? posIndices : posIndices.slice(1);

  for (const argIdx of fileIndices) {
    const fileArg = ctx.args[argIdx];
    if (!fileArg || fileArg.startsWith('-')) continue;
    if (process.platform === 'win32' && ((fileArg.startsWith('/') && !/^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(fileArg)) || fileArg.startsWith('~'))) {
      continue;
    }
    const { isWslPath, resolvedFile } = resolveJqFileArg(fileArg, cwd);
    try {
      const st = fs.statSync(resolvedFile, { throwIfNoEntry: false });
      if (st === undefined || !st.isFile() || st.size > 10 * 1024 * 1024) continue;
      const rawContent = fs.readFileSync(resolvedFile, 'utf8');
      const result = stripJqPreambleNoise(rawContent);
      if (result.reason === null || result.cleaned === rawContent) continue;

      const tmpSanitized = path.join(os.tmpdir(), `.agent_sanitized_jq_${crypto.randomUUID()}_${path.basename(resolvedFile)}`);
      fs.writeFileSync(tmpSanitized, result.cleaned, { encoding: 'utf8', mode: 0o600 });
      registerJqTempFile(tmpSanitized);

      const newFileArg = isWslPath ? convertToWslPath(tmpSanitized) : tmpSanitized;
      ctx.args[argIdx] = newFileArg;
      if ('args' in ctx.payload && Array.isArray(ctx.payload.args) && ctx.payload.args.length === ctx.args.length) {
        ctx.payload.args[argIdx] = newFileArg;
      }
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags / warning preambles from jq input file '${fileArg}'... (Frictionless Recovery)\x1b[0m`);
    } catch (err: unknown) {
      console.error(`⚠️  Failed to prepare sanitized jq input file '${fileArg}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
