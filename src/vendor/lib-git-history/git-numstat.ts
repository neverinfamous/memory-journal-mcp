// @ts-nocheck

import { spawnGitBinaryStream, NUMSTAT_BOUNDARY_STR } from './git-runner.js';
import { extractShaFromBuffer } from './parser-utils.js';
import { CHAR_NEWLINE, CHAR_NULL, GIT_STREAM_BUFFER_DEFAULT } from './constants.js';

export type NumstatEntry = { insertions: number; deletions: number; path: string; isBinary?: boolean };
export type NumstatCommitMap = Map<string, NumstatEntry>;
export const NUMSTAT_MAPS_WITH_ALIASES = new WeakSet<NumstatCommitMap>();

const LEADING_CR_LF_RE = /^[\r\n]+/;

export function parseNumstatLineIntoMap(
  rawLine: string,
  readNextPart: () => string | null,
  currentMap: NumstatCommitMap,
): void {
  const firstCode = rawLine.charCodeAt(0);
  const firstStr = firstCode === 10 || firstCode === 13 ? rawLine.replace(LEADING_CR_LF_RE, '') : rawLine;
  if (!firstStr) return;

  const tab1 = firstStr.indexOf('\t');
  if (tab1 === -1) return;
  const tab2 = firstStr.indexOf('\t', tab1 + 1);
  if (tab2 === -1) return;

  const p0 = firstStr.slice(0, tab1);
  const p1 = firstStr.slice(tab1 + 1, tab2);
  const isBinary = p0 === '-' || p1 === '-';
  const ins = isBinary ? 0 : Math.min(parseInt(p0, 10) || 0, Number.MAX_SAFE_INTEGER);
  const del = isBinary ? 0 : Math.min(parseInt(p1, 10) || 0, Number.MAX_SAFE_INTEGER);

  let oldPath: string | undefined;
  let newPath: string;
  if (tab2 + 1 < firstStr.length) {
    newPath = firstStr.slice(tab2 + 1);
  } else {
    oldPath = readNextPart() ?? '';
    newPath = readNextPart() ?? '';
  }

  if (!newPath) newPath = 'unknown_path_due_to_malformed_buffer';
  const stats: NumstatEntry = isBinary
    ? { insertions: ins, deletions: del, path: newPath, isBinary: true }
    : { insertions: ins, deletions: del, path: newPath };
  currentMap.set(newPath, stats);
  if (oldPath) {
    currentMap.set(oldPath, stats);
    NUMSTAT_MAPS_WITH_ALIASES.add(currentMap);
  }
}

function parseNumstatRecord(recordBuf: Buffer, shaEnd: number): NumstatCommitMap {
  const currentMap: NumstatCommitMap = new Map();
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
    parseNumstatLineIntoMap(readUntilNul(), readUntilNul, currentMap);
  }

  return currentMap;
}

export async function getNumstatMap(lockedArgs: string[], stdinShas?: string, cwd: string = process.cwd()) {
  const numstatArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '--numstat', '-z', `--pretty=format:${NUMSTAT_BOUNDARY_STR}%H`];
  if (stdinShas) numstatArgs.push('--stdin', '--no-walk');
  numstatArgs.push(...lockedArgs);

  const map = new Map<string, NumstatCommitMap>();
  for await (const recordBuf of spawnGitBinaryStream(numstatArgs, NUMSTAT_BOUNDARY_STR, stdinShas, GIT_STREAM_BUFFER_DEFAULT, cwd)) {
    const { sha: currentSha, shaEnd } = extractShaFromBuffer(recordBuf);
    if (!currentSha) continue;
    map.set(currentSha, parseNumstatRecord(recordBuf, shaEnd));
  }

  return map;
}
