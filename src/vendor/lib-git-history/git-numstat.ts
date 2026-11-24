// @ts-nocheck

import { spawnGitBinaryStream } from './git-runner.js';
import { extractShaFromBuffer } from './parser-utils.js';
import {
  CHAR_NEWLINE,
  CHAR_NULL,
  GIT_STREAM_BUFFER_DEFAULT,
  NUMSTAT_BOUNDARY_STR,
  NUMSTAT_MAPS_WITH_ALIASES,
  parseNumstatLineIntoMap,
  type NumstatEntry,
  type NumstatCommitMap,
} from './constants.js';

export { NUMSTAT_MAPS_WITH_ALIASES, parseNumstatLineIntoMap, type NumstatEntry, type NumstatCommitMap };

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
