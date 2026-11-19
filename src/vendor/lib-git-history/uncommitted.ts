// @ts-nocheck
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import type { entrySchema, FileStatus } from './schema.js';
import type { CliArgs } from './cli.js';
import { GIT_CMD_MAX_BUFFER } from './constants.js';
import { flattenString, getLanguage } from './parser-utils.js';

const MAX_UNTRACKED_STAT_BYTES = 5 * 1024 * 1024;
const BINARY_PEEK_BYTES = 8192;

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
      if (peekBuf.subarray(0, bytesRead).includes(0)) {
        return 0;
      }
    } finally {
      fs.closeSync(fd);
    }
    const content = fs.readFileSync(fullPath);
    if (content.length === 0) return 0;
    let newlines = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 0x0a) newlines++;
    }
    return content[content.length - 1] === 0x0a ? newlines : newlines + 1;
  } catch {
    return 0;
  }
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

  const numstatsMap = new Map<string, { insertions: number, deletions: number }>();
  if (numstat) {
    const parts = numstat.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const tab1 = part.indexOf('\t');
      if (tab1 !== -1) {
        const tab2 = part.indexOf('\t', tab1 + 1);
        if (tab2 !== -1) {
           const ins = part.slice(0, tab1);
           const del = part.slice(tab1 + 1, tab2);
           let file = part.slice(tab2 + 1);
           if (file === '') {
             i += 2;
             file = parts[i];
           }
           numstatsMap.set(file, {
             insertions: ins === '-' ? 0 : parseInt(ins, 10) || 0,
             deletions: del === '-' ? 0 : parseInt(del, 10) || 0
           });
        }
      }
    }
  }

  const files: FileStatus[] = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  if (nameStatus) {
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
      else if (xy[0] !== ' ' && xy[0] !== '?') mappedStatus = xy[0];
      else if (xy[1] !== ' ') mappedStatus = xy[1];

      const numstat = numstatsMap.get(file);
      const stats = numstat ?? {
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
        deletions: stats.deletions
      });
      totalInsertions += stats.insertions;
      totalDeletions += stats.deletions;
    }
  }

  let author = 'Unknown';
  let email = 'unknown@example.com';
  try {
    const resAuthor = spawnSync('git', ['config', 'user.name'], execOpts);
    if (!resAuthor.error && resAuthor.status === 0 && resAuthor.stdout.trim()) author = resAuthor.stdout.trim();
    
    const resEmail = spawnSync('git', ['config', 'user.email'], execOpts);
    if (!resEmail.error && resEmail.status === 0 && resEmail.stdout.trim()) email = resEmail.stdout.trim();
  } catch { /* ignore */ }

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
    patch: patch || undefined
  };
}
