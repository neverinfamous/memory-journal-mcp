// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertToWslPath, getPositionalArgs } from '../command-utils.js';
import type { ExecutionContext } from './types.js';

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
    return { cleaned: tagMatch[2].trim(), reason: 'tags', tagName: tagMatch[1] };
  }
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1] !== undefined) {
    return { cleaned: fenceMatch[1].trim(), reason: 'fence' };
  }
  if (raw.includes('[WARNING:') || raw.includes('<database_output>')) {
    const cleaned = raw
      .replace(/\[WARNING:[^\]]*\]/gi, '')
      .replace(/<database_output>/gi, '')
      .replace(/<\/database_output>/gi, '')
      .trim();
    if (cleaned !== raw) return { cleaned, reason: 'warning' };
  }
  return { cleaned: raw, reason: null };
}

function sanitizeJqStdin(ctx: ExecutionContext): void {
  if (typeof ctx.payload.stdin !== 'string' || ctx.payload.stdin.length === 0) return;
  const result = stripJqPreambleNoise(ctx.payload.stdin);
  if (result.reason === 'tags') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags (<${result.tagName}>) from jq stdin... (Frictionless Recovery)\x1b[0m`);
  } else if (result.reason === 'fence') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped markdown code fences from jq stdin... (Frictionless Recovery)\x1b[0m`);
  } else if (result.reason === 'warning') {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped warning preambles from jq stdin... (Frictionless Recovery)\x1b[0m`);
  }
  ctx.payload.stdin = result.cleaned;
}

function resolveJqFileArg(fileArg: string, cwd: string): { isWslPath: boolean; resolvedFile: string } {
  const rawFile = fileArg.replace(/^['"]|['"]$/g, '');
  const isWslPath = rawFile.startsWith('/mnt/');
  const wslNormalized = isWslPath
    ? rawFile.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_m, drive: string, rest: string) => `${drive.toUpperCase()}:/${rest}`)
    : rawFile;
  const resolvedFile = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);
  return { isWslPath, resolvedFile };
}

export function sanitizeJqInvocation(ctx: ExecutionContext, args: string[]): void {
  const hasStdin = ctx.payload.stdin !== undefined && ctx.payload.stdin.length > 0;
  if (hasStdin && getPositionalArgs('jq', args).length === 0) {
    console.error(`\n   💡 AGENT HINT: 'jq' requires a filter argument when reading from stdin.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '.' filter... (Frictionless Recovery)\x1b[0m`);
    ctx.args.push('.');
  }
  sanitizeJqStdin(ctx);

  const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
    ? path.resolve(ctx.payload.cwd)
    : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());
  const posArgs = getPositionalArgs('jq', ctx.args);
  const hasFilterFile = ctx.args.some(a => a === '-f' || a === '--from-file');
  const fileArgCandidates = hasFilterFile ? posArgs : posArgs.slice(1);

  for (const fileArg of fileArgCandidates) {
    if (!fileArg || fileArg.startsWith('-')) continue;
    const { isWslPath, resolvedFile } = resolveJqFileArg(fileArg, cwd);
    if (!fs.existsSync(resolvedFile)) continue;
    try {
      const rawContent = fs.readFileSync(resolvedFile, 'utf8');
      const result = stripJqPreambleNoise(rawContent);
      if (result.reason === null || result.cleaned === rawContent) continue;

      const tmpSanitized = path.join(os.tmpdir(), `.agent_sanitized_jq_${crypto.randomUUID()}_${path.basename(resolvedFile)}`);
      fs.writeFileSync(tmpSanitized, result.cleaned, { encoding: 'utf8', mode: 0o600 });
      registerJqTempFile(tmpSanitized);
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags / warning preambles from jq input file '${fileArg}'... (Frictionless Recovery)\x1b[0m`);

      const newFileArg = isWslPath ? convertToWslPath(tmpSanitized) : tmpSanitized;
      const idx = ctx.args.indexOf(fileArg);
      if (idx !== -1) ctx.args[idx] = newFileArg;
      if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
        const pIdx = ctx.payload.args.indexOf(fileArg);
        if (pIdx !== -1) ctx.payload.args[pIdx] = newFileArg;
      }
    } catch {
      // Ignore read/write errors on candidate file
    }
  }
}
