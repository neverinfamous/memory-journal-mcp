// @ts-nocheck

import { spawnGitBinaryStream, PATCH_BOUNDARY_STR } from './git-runner.js';
import type { CliArgs } from './cli.js';
import { DEFAULT_MAX_PATCH_LEN, GIT_EXCLUDE_PATTERNS, GIT_STREAM_BUFFER_DEFAULT } from './constants.js';
import { extractShaFromBuffer, truncateSafely } from './parser-utils.js';

const DIFF_HEADER_NL = Buffer.from('\ndiff --git ');
const DIFF_HEADER_START = Buffer.from('diff --git ');

function truncateOversizedPatch(
  recordBuf: Buffer,
  startOffset: number,
  maxPatchLen: number,
): { patch: string; truncated: boolean } {
  const processedDiffs: string[] = [];
  let searchStart = startOffset;
  let truncated = false;
  let remainingBudget = maxPatchLen;

  const probeEnd = Math.min(recordBuf.length, searchStart + 10 + DIFF_HEADER_START.length);
  const firstDiff = recordBuf.subarray(searchStart, probeEnd).indexOf(DIFF_HEADER_START);
  if (firstDiff !== -1 && firstDiff < 10) {
    searchStart += firstDiff;
  }

  while (searchStart < recordBuf.length) {
    if (remainingBudget <= 0) {
      truncated = true;
      processedDiffs.push('...[remaining file patches truncated due to length]');
      break;
    }

    const nextDiff = recordBuf.indexOf(DIFF_HEADER_NL, searchStart + 1);
    const diffEnd = nextDiff !== -1 ? nextDiff : recordBuf.length;

    const maxBytes = remainingBudget * 4 + 64;
    const decodeEnd = diffEnd - searchStart > maxBytes ? searchStart + maxBytes : diffEnd;
    const diffText = recordBuf.toString('utf-8', searchStart, decodeEnd).trim();

    if (decodeEnd < diffEnd || diffText.length > remainingBudget) {
      truncated = true;
      processedDiffs.push(truncateSafely(diffText, remainingBudget, '\n...[patch truncated due to length]'));
      remainingBudget = 0;
    } else if (diffText.length > 0) {
      processedDiffs.push(diffText);
      remainingBudget -= diffText.length;
    }

    if (nextDiff === -1) break;
    searchStart = nextDiff + 1;
  }

  return { patch: processedDiffs.filter(Boolean).join('\n'), truncated };
}

export function wantsPatchOutput(args: CliArgs): boolean {
  return Boolean(
    (args['include-patch'] || args['diff-context'] !== undefined) &&
    !args.summary &&
    !args['no-body'] &&
    !args.stats,
  );
}

export async function getPatchMap(lockedArgs: string[], args: CliArgs, stdinShas?: string, cwd: string = process.cwd()) {
  if (!wantsPatchOutput(args)) return new Map();
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

  for await (const recordBuf of spawnGitBinaryStream(patchArgs, PATCH_BOUNDARY_STR, stdinShas, GIT_STREAM_BUFFER_DEFAULT, cwd)) {
    const { sha: hash, shaEnd: hashEnd } = extractShaFromBuffer(recordBuf);
    if (!hash) continue;
    const patchByteLen = recordBuf.length - (hashEnd + 1);
    if (patchByteLen > maxPatchLen) {
      map.set(hash, truncateOversizedPatch(recordBuf, hashEnd + 1, maxPatchLen));
    } else {
      map.set(hash, { patch: recordBuf.toString('utf-8', hashEnd + 1).trim(), truncated: false });
    }
  }

  return map;
}
