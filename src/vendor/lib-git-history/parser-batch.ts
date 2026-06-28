// @ts-nocheck
import type { z } from 'zod';
import { entrySchema, fileStatusSchema, type CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { getNumstatMap } from './git-numstat.js';
import { getPatchMap } from './git-patch.js';
import { isNoiseFile } from './parser-utils.js';
import type { RawCommitBatchItem } from './parser-record.js';

export async function processBatch(
  batch: RawCommitBatchItem[],
  args: CliArgs,
  formattingFlags: string[]
): Promise<CommitEntry[]> {
  if (batch.length === 0) return [];
  const shas = batch.map(b => b.sha).join('\n') + '\n';
  
  const numstatMap = new Map<string, Map<string, { insertions: number; deletions: number; path: string; isBinary?: boolean }>>();
  const patchMap = new Map<string, { patch: string; truncated: boolean }>();
  
  const [nMap, pMapResult] = await Promise.all([
    getNumstatMap(formattingFlags, shas).catch((err) => {
      console.warn('Warning: Failed to get numstat map (This may cause missing file stats for this batch):', err instanceof Error ? err.message : String(err));
      return new Map();
    }),
    args['include-patch'] ? getPatchMap(formattingFlags, args, shas).catch((err) => {
      console.warn('Warning: Failed to get patch map (This may cause missing patches for this batch):', err instanceof Error ? err.message : String(err));
      return undefined;
    }) : Promise.resolve(undefined)
  ]);
  for (const [k, v] of nMap.entries()) numstatMap.set(k, v);
  
  if (pMapResult && typeof pMapResult.entries === 'function') {
    for (const [k, v] of pMapResult.entries()) patchMap.set(k, v);
  }

  const processed: CommitEntry[] = [];
  const parsedMaxBodyLen = args['max-body-length'] ? parseInt(args['max-body-length'], 10) : undefined;
  const maxBodyLen = (parsedMaxBodyLen !== undefined && !Number.isNaN(parsedMaxBodyLen) && parsedMaxBodyLen >= 0) ? parsedMaxBodyLen : 10000;
  const maxFilesPerCommit = 100;

  for (const b of batch) {
    const { sha, parents, refs, tags, authorName, authorEmail, committerName, committerEmail, committerDate, date, type, scope, isBreaking, breakingChangeDescription, cleanSubject, subject, rawFiles, metadataObj, trailersObj, references, coAuthors, reviewers, issuesMap, isRevert, revertedCommit } = b;
    let body = b.body;

    const parsedFiles: z.infer<typeof fileStatusSchema>[] = [];
    const statsForCommit = numstatMap.get(sha) || new Map();
    const fileLines = rawFiles;
    
    let commitInsertions = 0, commitDeletions = 0;
    let nonNoiseInsertions = 0, nonNoiseDeletions = 0;

    const uniqueStats = new Set(statsForCommit.values());
    for (const stats of uniqueStats) {
      commitInsertions += stats.insertions;
      commitDeletions += stats.deletions;
      if (!isNoiseFile(stats.path)) {
        nonNoiseInsertions += stats.insertions;
        nonNoiseDeletions += stats.deletions;
      }
    }

    const trueFileCount = Math.max(fileLines.length, uniqueStats.size);

    for (const line of fileLines) {
      const { status, file, oldFile, similarityScore } = line;

      let stats = statsForCommit.get(file);
      if (!stats && oldFile) stats = statsForCommit.get(oldFile);

      if (parsedFiles.length < maxFilesPerCommit) {
        parsedFiles.push({
          status, file, ...(oldFile ? { oldFile } : {}),
          ...(similarityScore !== undefined ? { similarityScore } : {}),
          ...(stats && stats.insertions !== undefined ? { insertions: stats.insertions } : {}),
          ...(stats && stats.deletions !== undefined ? { deletions: stats.deletions } : {}),
          ...(stats?.isBinary ? { isBinary: true } : {}),
        });
      }
    }

    if (trueFileCount > maxFilesPerCommit) {
      parsedFiles.push({
        status: 'M',
        file: `...and ${trueFileCount - parsedFiles.length} more files omitted`
      });
    }

    let size: string | undefined;
    const totalLines = nonNoiseInsertions + nonNoiseDeletions;
    if (totalLines > 0) {
      if (totalLines < 10) size = 'XS';
      else if (totalLines < 50) size = 'S';
      else if (totalLines < 250) size = 'M';
      else if (totalLines < 1000) size = 'L';
      else size = 'XL';
    } else if (trueFileCount > 0) {
      size = 'XS';
    }

    const cTime = committerDate ? new Date(committerDate).getTime() : NaN;
    const aTime = date ? new Date(date).getTime() : NaN;
    const isRebased = (committerEmail && authorEmail && committerEmail !== authorEmail && committerName !== 'GitHub') || 
                      (!isNaN(cTime) && !isNaN(aTime) && Math.abs(cTime - aTime) > 1000 * 60 * 60 * 24);

    const entryObj: Record<string, unknown> = {
      commit: sha || 'unknown_commit',
      ...(parents.length > 0 ? { parents } : {}),
      ...(refs.length > 0 ? { refs } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      author: authorName || 'Unknown Author',
      ...(authorEmail ? { email: authorEmail } : {}),
      ...(committerName && committerName !== authorName ? { committer: committerName } : {}),
      ...(committerEmail && committerEmail !== authorEmail ? { committerEmail } : {}),
      ...(committerDate && committerDate !== date ? { committerDate } : {}),
      date: date || new Date().toISOString(), 
      ...(type ? { type } : {}), ...(scope ? { scope } : {}), ...(isBreaking ? { isBreaking } : {}),
      subject: subject || 'No Subject',
      ...(cleanSubject !== subject ? { cleanSubject } : {}),
      ...(size ? { size } : {}),
      ...(parsedFiles.length > 0 ? { files: parsedFiles } : {}),
      ...(trueFileCount > 0 ? { fileCount: trueFileCount } : {}),
      ...(trueFileCount > maxFilesPerCommit ? { isFilesTruncated: true } : {}),
      ...(commitInsertions !== undefined ? { totalInsertions: commitInsertions } : {}),
      ...(commitDeletions !== undefined ? { totalDeletions: commitDeletions } : {}),
    };

    if (issuesMap.size > 0) {
      entryObj.associatedIssues = Array.from(issuesMap.entries()).map(([issue, action]) => ({ issue, action }));
    }

    if (args['include-patch'] && patchMap.has(sha)) {
      const patchData = patchMap.get(sha)!;
      entryObj.patch = patchData.patch;
      if (patchData.truncated) entryObj.isPatchTruncated = true;
    }

    if (Object.keys(metadataObj).length > 0) entryObj.metadata = metadataObj;
    if (references.length > 0) entryObj.references = references;
    if (coAuthors.length > 0) entryObj.coAuthors = coAuthors;
    if (reviewers.length > 0) entryObj.reviewers = reviewers;
    if (trailersObj && Object.keys(trailersObj).length > 0) entryObj.trailersObj = trailersObj;

    if (isRevert) entryObj.isRevert = true;
    if (revertedCommit) entryObj.revertedCommit = revertedCommit;
    if (isBreaking) entryObj.isBreaking = true;
    if (breakingChangeDescription) entryObj.breakingChangeDescription = breakingChangeDescription;
    if (isRebased) entryObj.isRebased = true;

    body = body.replace(/(?:\r?\n){3,}/g, '\n\n');
    
    if (body.length > maxBodyLen) {
      let safeLen = maxBodyLen;
    while (safeLen > 0 && body.charCodeAt(safeLen - 1) >= 0xD800 && body.charCodeAt(safeLen - 1) <= 0xDBFF) {
      safeLen--;
    }
    const truncated = body.slice(0, safeLen);
      const lastNewline = Math.max(truncated.lastIndexOf('\n\n'), truncated.lastIndexOf('\n'));
      let newBody = lastNewline > 0 ? truncated.slice(0, lastNewline).trim() : truncated.trim();
      
      const codeMatches = newBody.match(/```/g);
      if (codeMatches && codeMatches.length % 2 !== 0) {
         newBody += '\n```';
      }
      const tildeMatches = newBody.match(/~~~/g);
      if (tildeMatches && tildeMatches.length % 2 !== 0) {
         newBody += '\n~~~';
      }
      body = (' ' + newBody + '\n\n...[truncated to protect context]').slice(1);
    }
    if (body) entryObj.body = (' ' + body).slice(1);

    const parseResult = entrySchema.safeParse(entryObj);
    if (parseResult.success) {
      processed.push(parseResult.data);
    } else {
      const coercedObj = { ...entryObj } as Record<string, unknown>;
      for (const issue of parseResult.error.issues) {
        if (issue.path.length === 1) {
          delete coercedObj[issue.path[0] as string];
        } else if (issue.path.length === 2 && issue.path[0] === 'metadata') {
          const meta = { ...(coercedObj.metadata as Record<string, unknown>) };
          delete meta[issue.path[1] as string];
          coercedObj.metadata = meta;
        } else if (issue.path[0] === 'files') {
          delete coercedObj.files;
        }
      }
      const retryResult = entrySchema.safeParse(coercedObj);
      if (retryResult.success) {
        const finalData = retryResult.data;
        (finalData as Record<string, unknown>).validationErrors = parseResult.error.issues;
        processed.push(finalData);
      } else {
        const fallbackData = coercedObj as z.infer<typeof entrySchema>;
        if (!fallbackData.commit) (fallbackData as Record<string, unknown>).commit = sha || 'unknown_commit';
        if (!fallbackData.subject) (fallbackData as Record<string, unknown>).subject = subject || 'No Subject';
        if (!fallbackData.date) (fallbackData as Record<string, unknown>).date = date || new Date().toISOString();
        if (!fallbackData.author) (fallbackData as Record<string, unknown>).author = authorName || 'Unknown Author';
        (fallbackData as Record<string, unknown>).validationErrors = parseResult.error.issues;
        (fallbackData as Record<string, unknown>).isCorrupted = true;
        processed.push(fallbackData);
      }
    }
  }
  return processed;
}
