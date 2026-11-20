// @ts-nocheck

import { spawnGitBinaryStream, NUMSTAT_BOUNDARY_STR } from './git-runner.js';
import { extractShaFromBuffer } from './parser-utils.js';
import { CHAR_NEWLINE, CHAR_NULL, GIT_STREAM_BUFFER_DEFAULT } from './constants.js';

type NumstatEntry = { insertions: number; deletions: number; path: string; isBinary?: boolean };

function parseNumstatRecord(recordBuf: Buffer, shaEnd: number): Map<string, NumstatEntry> {
  const currentMap = new Map<string, NumstatEntry>();
  let i = shaEnd;
  if (i < recordBuf.length && (recordBuf[i] === CHAR_NEWLINE || recordBuf[i] === CHAR_NULL)) i++;

  const readUntilNul = (): string => {
    if (i >= recordBuf.length) return '';
    const nulIdx = recordBuf.indexOf(0, i);
    const endIdx = nulIdx !== -1 ? nulIdx : recordBuf.length;
    const str = recordBuf.toString('utf-8', i, endIdx);
    i = endIdx < recordBuf.length && recordBuf[endIdx] === 0 ? endIdx + 1 : endIdx;
    return str;
  };

  while (i < recordBuf.length) {
    if (recordBuf[i] === 0) {
      i++;
      continue;
    }

    const firstStr = readUntilNul().replace(/^[\r\n]+/, '');
    if (!firstStr) continue;

    const parts = firstStr.split('\t');
    if (parts.length < 2) continue;

    const p0 = parts[0] ?? '';
    const p1 = parts[1] ?? '';
    const isBinary = p0 === '-' || p1 === '-';
    const ins = Math.min(parseInt(p0, 10) || 0, Number.MAX_SAFE_INTEGER);
    const del = Math.min(parseInt(p1, 10) || 0, Number.MAX_SAFE_INTEGER);

    let oldPath: string | undefined;
    let newPath: string;
    if (parts.length > 2 && parts[2] !== '') {
      newPath = parts.slice(2).join('\t');
    } else {
      oldPath = readUntilNul();
      newPath = readUntilNul();
    }

    if (!newPath) newPath = 'unknown_path_due_to_malformed_buffer';
    const stats: NumstatEntry = { insertions: ins, deletions: del, path: newPath, ...(isBinary ? { isBinary: true } : {}) };
    currentMap.set(newPath, stats);
    if (oldPath) currentMap.set(oldPath, stats);
  }

  return currentMap;
}

export async function getNumstatMap(lockedArgs: string[], stdinShas?: string, cwd: string = process.cwd()) {
  const numstatArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '--numstat', '-z', `--pretty=format:${NUMSTAT_BOUNDARY_STR}%H`];
  if (stdinShas) numstatArgs.push('--stdin', '--no-walk');
  numstatArgs.push(...lockedArgs);

  const map = new Map<string, Map<string, NumstatEntry>>();
  for await (const recordBuf of spawnGitBinaryStream(numstatArgs, NUMSTAT_BOUNDARY_STR, stdinShas, GIT_STREAM_BUFFER_DEFAULT, cwd)) {
    const { sha: currentSha, shaEnd } = extractShaFromBuffer(recordBuf);
    if (!currentSha) continue;
    map.set(currentSha, parseNumstatRecord(recordBuf, shaEnd));
  }

  return map;
}
