
import { spawnGitBinaryStream, PATCH_BOUNDARY_STR } from './git-runner.js';
import type { CliArgs } from './cli.js';
import { DEFAULT_MAX_PATCH_LEN, GIT_EXCLUDE_PATTERNS } from './constants.js';
import { extractShaFromBuffer } from './parser-utils.js';

export async function getPatchMap(lockedArgs: string[], args: CliArgs, stdinShas?: string) {
  if (!args['include-patch'] && args['diff-context'] === undefined) return new Map();
  const patchBaseArgs = [...lockedArgs];
  const excludes = GIT_EXCLUDE_PATTERNS;
  if (patchBaseArgs.includes('--')) {
    patchBaseArgs.push(...excludes);
  } else {
    patchBaseArgs.push('--', ...excludes);
  }
  const patchArgs = ['--no-pager', '-c', 'core.quotePath=false', 'log', '-p', args['diff-context'] !== undefined ? `-U${args['diff-context']}` : '-U1', `--pretty=format:${PATCH_BOUNDARY_STR}%H%x0A`];
  if (stdinShas) patchArgs.push('--stdin', '--no-walk');
  patchArgs.push(...patchBaseArgs);

  const map = new Map<string, { patch: string; truncated: boolean }>();
  const parsedMaxPatchLen = args['max-patch-length'];
  const maxPatchLen = (parsedMaxPatchLen !== undefined && !Number.isNaN(parsedMaxPatchLen) && parsedMaxPatchLen >= 0) ? parsedMaxPatchLen : DEFAULT_MAX_PATCH_LEN;

  for await (const recordBuf of spawnGitBinaryStream(patchArgs, PATCH_BOUNDARY_STR, stdinShas)) {
    const { sha: hash, shaEnd: hashEnd } = extractShaFromBuffer(recordBuf);
    if (hash) {
      const patchByteLen = recordBuf.length - (hashEnd + 1);
      
      if (patchByteLen > maxPatchLen) {
        const DIFF_HEADER = Buffer.from('\ndiff --git ');
        const processedDiffs: string[] = [];
        let searchStart = hashEnd + 1;
        let truncated = false;
        
        // Handle the first diff --git which might not have a leading newline
        if (searchStart < recordBuf.length && recordBuf.subarray(searchStart, searchStart + 11).toString('utf-8') !== 'diff --git ') {
           // It's possible there is some preamble before the first diff, though usually it starts right away.
        }
        
        const firstDiff = recordBuf.indexOf(Buffer.from('diff --git '), searchStart);
        if (firstDiff !== -1 && firstDiff - searchStart < 10) {
           searchStart = firstDiff;
        }

        while (searchStart < recordBuf.length) {
          const nextDiff = recordBuf.indexOf(DIFF_HEADER, searchStart + 1);
          const diffEnd = nextDiff !== -1 ? nextDiff : recordBuf.length;
          
          const diffLen = diffEnd - searchStart;
          if (diffLen > maxPatchLen) {
            truncated = true;
            processedDiffs.push(recordBuf.toString('utf-8', searchStart, searchStart + maxPatchLen).trim() + '\n...[patch truncated due to length]');
          } else {
            processedDiffs.push(recordBuf.toString('utf-8', searchStart, diffEnd).trim());
          }
          
          if (nextDiff === -1) break;
          searchStart = nextDiff + 1; // skip the leading newline so it starts with 'diff --git '
        }
        
        map.set(hash, { patch: processedDiffs.filter(Boolean).join('\n'), truncated });
      } else {
        const patch = recordBuf.toString('utf-8', hashEnd + 1).trim();
        map.set(hash, { patch, truncated: false });
      }
    }
  }

  return map;
}
