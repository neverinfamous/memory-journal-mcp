// @ts-nocheck
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { z } from 'zod';
import type { entrySchema, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { GIT_CMD_MAX_BUFFER, GIT_TIMEOUT_MS } from './constants.js';
import { flattenString, getLanguage } from './parser-utils.js';

const execFileAsync = promisify(execFile);
const MAX_UNTRACKED_STAT_BYTES = 5 * 1024 * 1024;
const BINARY_PEEK_BYTES = 8192;

function countNewlinesInBuffer(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let newlines = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) newlines++;
  }
  return buf[buf.length - 1] === 0x0a ? newlines : newlines + 1;
}

function countUntrackedLines(cwd: string, relFile: string): number {
  try {
    const fullPath = path.resolve(cwd, relFile);
    const stat = fs.lstatSync(fullPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_UNTRACKED_STAT_BYTES) {
      return 0;
    }
    const peekLen = Math.min(stat.size, BINARY_PEEK_BYTES);
    const fd = fs.openSync(fullPath, 'r');
    try {
      const peekBuf = Buffer.allocUnsafe(peekLen);
      const bytesRead = fs.readSync(fd, peekBuf, 0, peekLen, 0);
      const peekSlice = peekBuf.subarray(0, bytesRead);
      if (peekSlice.includes(0)) {
        return 0;
      }
      if (stat.size <= BINARY_PEEK_BYTES) {
        return countNewlinesInBuffer(peekSlice);
      }
      const fullBuf = Buffer.allocUnsafe(stat.size);
      peekSlice.copy(fullBuf, 0);
      let offset = bytesRead;
      while (offset < stat.size) {
        const readNow = fs.readSync(fd, fullBuf, offset, stat.size - offset, offset);
        if (readNow <= 0) break;
        offset += readNow;
      }
      return countNewlinesInBuffer(fullBuf.subarray(0, offset));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 0;
  }
}

function parseGitUserConfig(stdout: string): { author: string; email: string } {
  let author = 'Unknown';
  let email = 'unknown@example.com';
  if (!stdout) return { author, email };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('user.name ')) {
      const val = line.slice('user.name '.length).trim();
      if (val) author = val;
    } else if (line.startsWith('user.email ')) {
      const val = line.slice('user.email '.length).trim();
      if (val) email = val;
    }
  }
  return { author, email };
}

function parseUncommittedNumstat(numstat: string): Map<string, { insertions: number; deletions: number }> {
  const numstatsMap = new Map<string, { insertions: number; deletions: number }>();
  if (!numstat) return numstatsMap;
  const parts = numstat.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const tab1 = part.indexOf('\t');
    if (tab1 === -1) continue;
    const tab2 = part.indexOf('\t', tab1 + 1);
    if (tab2 === -1) continue;
    const ins = part.slice(0, tab1);
    const del = part.slice(tab1 + 1, tab2);
    let file = part.slice(tab2 + 1);
    if (file === '') {
      i += 2;
      file = parts[i] ?? '';
    }
    numstatsMap.set(file, {
      insertions: ins === '-' ? 0 : parseInt(ins, 10) || 0,
      deletions: del === '-' ? 0 : parseInt(del, 10) || 0,
    });
  }
  return numstatsMap;
}

function parseUncommittedFiles(
  cwd: string,
  nameStatus: string,
  numstatsMap: Map<string, { insertions: number; deletions: number }>,
): { files: FileStatus[]; totalInsertions: number; totalDeletions: number } {
  const files: FileStatus[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;
  if (!nameStatus) return { files, totalInsertions, totalDeletions };

  const parts = nameStatus.split('\0');
  for (let i = 0; i < parts.length - 1; i++) {
    const statusLine = parts[i];
    if (!statusLine) continue;

    const xy = statusLine.slice(0, 2);
    const file = statusLine.slice(3);
    let oldFile: string | undefined;

    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      i++;
      oldFile = parts[i];
    }

    let mappedStatus = xy;
    if (xy === '??') mappedStatus = 'U';
    else if (xy[0] !== ' ' && xy[0] !== '?') mappedStatus = xy[0] ?? xy;
    else if (xy[1] !== ' ') mappedStatus = xy[1] ?? xy;

    const stats = numstatsMap.get(file) ?? {
      insertions: mappedStatus === 'U' ? countUntrackedLines(cwd, file) : 0,
      deletions: 0,
    };

    const flatFile = flattenString(file);
    const flatStatus = flattenString(mappedStatus);
    const flatOldFile = oldFile ? flattenString(oldFile) : undefined;
    const lang = getLanguage(flatFile);

    files.push({
      status: flatStatus,
      file: flatFile,
      ...(flatOldFile ? { oldFile: flatOldFile } : {}),
      ...(lang ? { language: lang } : {}),
      insertions: stats.insertions,
      deletions: stats.deletions,
    });
    totalInsertions += stats.insertions;
    totalDeletions += stats.deletions;
  }

  return { files, totalInsertions, totalDeletions };
}

function buildUncommittedEntry(
  cwd: string,
  nameStatus: string,
  numstat: string,
  patch: string | undefined,
  userConfigRaw: string,
): z.infer<typeof entrySchema> {
  const numstatsMap = parseUncommittedNumstat(numstat);
  const { files, totalInsertions, totalDeletions } = parseUncommittedFiles(cwd, nameStatus, numstatsMap);
  const { author, email } = parseGitUserConfig(userConfigRaw);

  return {
    commit: 'UNCOMMITTED',
    author: flattenString(author),
    email: flattenString(email),
    date: new Date().toISOString(),
    subject: 'Uncommitted Changes',
    cleanSubject: 'Uncommitted Changes',
    files: files.length > 0 ? files : undefined,
    fileCount: files.length,
    totalInsertions,
    totalDeletions,
    patch: patch || undefined,
  };
}

export function getUncommittedState(args: CliArgs, cwd: string = process.cwd()): z.infer<typeof entrySchema> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, windowsHide: true };
  const pathFilter = args.path ? ['--', args.path] : [];

  let nameStatus = '';
  try {
    const res = spawnSync('git', ['--no-pager', 'status', '-z', '--porcelain', '-uall', ...pathFilter], execOpts);
    if (!res.error && res.status === 0) nameStatus = res.stdout;
  } catch { /* ignore */ }

  let numstat = '';
  try {
    const res = spawnSync('git', ['--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter], execOpts);
    if (!res.error && res.status === 0) numstat = res.stdout;
  } catch { /* ignore */ }

  let patch: string | undefined;
  if (args['include-patch']) {
    try {
      const res = spawnSync('git', ['--no-pager', 'diff', 'HEAD', ...pathFilter], execOpts);
      if (!res.error && res.status === 0) patch = res.stdout;
    } catch { /* ignore */ }
  }

  let userConfigRaw = '';
  try {
    const res = spawnSync('git', ['config', '--get-regexp', '^user\\.(name|email)$'], execOpts);
    if (!res.error && res.status === 0) userConfigRaw = res.stdout;
  } catch { /* ignore */ }

  return buildUncommittedEntry(cwd, nameStatus, numstat, patch, userConfigRaw);
}

/**
 * [INTENT]: Concurrent async variant of `getUncommittedState` used by the CLI to eliminate
 * sequential Windows `git.exe` spawn waterfalls via `Promise.allSettled`.
 */
export async function getUncommittedStateAsync(args: CliArgs, cwd: string = process.cwd()): Promise<z.infer<typeof entrySchema>> {
  const execOpts = { cwd, encoding: 'utf-8' as const, maxBuffer: GIT_CMD_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true };
  const pathFilter = args.path ? ['--', args.path] : [];

  const runGit = (gitArgs: string[]): Promise<string> =>
    execFileAsync('git', gitArgs, execOpts).then(r => r.stdout);

  const [statusRes, numstatRes, patchRes, configRes] = await Promise.allSettled([
    runGit(['--no-pager', 'status', '-z', '--porcelain', '-uall', ...pathFilter]),
    runGit(['--no-pager', 'diff', '--numstat', '-z', 'HEAD', ...pathFilter]),
    args['include-patch']
      ? runGit(['--no-pager', 'diff', 'HEAD', ...pathFilter])
      : Promise.resolve<string | undefined>(undefined),
    runGit(['config', '--get-regexp', '^user\\.(name|email)$']),
  ]);

  const nameStatus = statusRes.status === 'fulfilled' ? statusRes.value : '';
  const numstat = numstatRes.status === 'fulfilled' ? numstatRes.value : '';
  const patch = patchRes.status === 'fulfilled' ? patchRes.value : undefined;
  const userConfigRaw = configRes.status === 'fulfilled' ? configRes.value : '';

  return buildUncommittedEntry(cwd, nameStatus, numstat, patch, userConfigRaw);
}
