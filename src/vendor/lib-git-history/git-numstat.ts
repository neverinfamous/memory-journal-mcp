// @ts-nocheck

import { spawnGitBinaryStream, NUMSTAT_BOUNDARY_STR } from './git-runner.js';
import { extractShaFromBuffer } from './parser-utils.js';
import { CHAR_NEWLINE, CHAR_NULL, GIT_STREAM_BUFFER_DEFAULT } from './constants.js';

export async function getNumstatMap(lockedArgs: string[], stdinShas?: string, cwd: string = process.cwd()) {
  const numstatArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '--numstat', '-z', `--pretty=format:${NUMSTAT_BOUNDARY_STR}%H`];
  if (stdinShas) numstatArgs.push('--stdin', '--no-walk');
  numstatArgs.push(...lockedArgs);

  const map = new Map<string, Map<string, { insertions: number; deletions: number; path: string; isBinary?: boolean }>>();
  
  for await (const recordBuf of spawnGitBinaryStream(numstatArgs, NUMSTAT_BOUNDARY_STR, stdinShas, GIT_STREAM_BUFFER_DEFAULT, cwd)) {
      const { sha: currentSha, shaEnd } = extractShaFromBuffer(recordBuf);
      if (!currentSha) continue;

      const currentMap = new Map();
      map.set(currentSha, currentMap);

      let i = shaEnd;
      if (i < recordBuf.length && (recordBuf[i] === CHAR_NEWLINE || recordBuf[i] === CHAR_NULL)) i++;
      
      const readUntilNul = () => {
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

        let firstStr = readUntilNul();
        firstStr = firstStr.replace(/^[\r\n]+/, '');
        if (!firstStr) continue;

        const parts = firstStr.split('\t');
        if (parts.length >= 2) {
          const pathStartIndex = 2;
          let isBinary = false;
          let ins = 0;
          let del = 0;
          for (let j = 0; j < pathStartIndex - 1; j += 2) {
             const p0 = parts[j] ?? '';
             const p1 = parts[j+1] ?? '';
             if (p0 === '-' || p1 === '-') isBinary = true;
             const parsedIns = parseInt(p0, 10) || 0;
             const parsedDel = parseInt(p1, 10) || 0;
             ins += Math.min(parsedIns, Number.MAX_SAFE_INTEGER);
             del += Math.min(parsedDel, Number.MAX_SAFE_INTEGER);
          }
          
          let oldPath: string | undefined;
          let newPath: string;
          
          if (pathStartIndex < parts.length && parts[pathStartIndex] === '') {
            oldPath = readUntilNul();
            newPath = readUntilNul();
          } else if (pathStartIndex < parts.length) {
            newPath = parts.slice(pathStartIndex).join('\t');
          } else {
            oldPath = readUntilNul();
            newPath = readUntilNul();
          }
          
          if (!newPath) newPath = 'unknown_path_due_to_malformed_buffer';
          
          const stats = { insertions: ins, deletions: del, path: newPath, ...(isBinary ? { isBinary: true } : {}) };
          currentMap.set(newPath, stats);
          if (oldPath) currentMap.set(oldPath, stats);
        }
      }
  }

  return map;
}
