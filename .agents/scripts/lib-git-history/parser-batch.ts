import type { z } from 'zod';
import { entrySchema, fileStatusSchema, type CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { getNumstatMap } from './git-numstat.js';
import { getPatchMap } from './git-patch.js';
import { isNoiseFile, getSlackMap, getLanguage, truncateSafely, flattenString } from './parser-utils.js';
import { DEFAULT_MAX_BODY_LEN, MAX_FILES_PER_COMMIT, MS_PER_DAY } from './constants.js';
import type { RawCommitBatchItem } from './parser-record.js';

const SIZE_XS_THRESHOLD = 10;
const SIZE_S_THRESHOLD = 50;
const SIZE_M_THRESHOLD = 250;
const SIZE_L_THRESHOLD = 1000;

function parseWithFallbacks(entryObj: Record<string, unknown>, sha: string, subject: string, date: string, authorName: string): CommitEntry | null {
  const parseResult = entrySchema.safeParse(entryObj);
  if (parseResult.success) return parseResult.data;

  const coercedObj: Record<string, unknown> = { ...entryObj };
  for (const issue of parseResult.error.issues) {
    if (issue.path.length === 1) {
      delete coercedObj[String(issue.path[0])];
    } else if (issue.path.length === 2 && issue.path[0] === 'metadata') {
      const rawMeta = coercedObj['metadata'];
      const meta: Record<string, unknown> = typeof rawMeta === 'object' && rawMeta !== null 
        ? { ...rawMeta } 
        : {};
      delete meta[String(issue.path[1])];
      coercedObj['metadata'] = meta;
    } else if (issue.path[0] === 'files') {
      delete coercedObj['files'];
    }
  }
  const retryResult = entrySchema.safeParse(coercedObj);
  if (retryResult.success) {
    const finalData = retryResult.data;
    finalData.validationErrors = parseResult.error.issues;
    return finalData;
  }

  coercedObj.commit = coercedObj.commit || sha || 'unknown_commit';
  coercedObj.subject = coercedObj.subject || subject || 'No Subject';
  coercedObj.date = coercedObj.date || date || new Date().toISOString();
  coercedObj.author = coercedObj.author || authorName || 'Unknown Author';
  coercedObj.validationErrors = parseResult.error.issues;
  coercedObj.isCorrupted = true;
  
  const fallbackResult = entrySchema.safeParse(coercedObj);
  return fallbackResult.success ? fallbackResult.data : null;
}

function computeCommitSize(totalLines: number, trueFileCount: number): string | undefined {
  if (totalLines > 0) {
    if (totalLines < SIZE_XS_THRESHOLD) return 'XS';
    if (totalLines < SIZE_S_THRESHOLD) return 'S';
    if (totalLines < SIZE_M_THRESHOLD) return 'M';
    if (totalLines < SIZE_L_THRESHOLD) return 'L';
    return 'XL';
  } else if (trueFileCount > 0) {
    return 'XS';
  }
  return undefined;
}

function truncateBodyWithContext(body: string, maxBodyLen: number): string {
  if (!body || body.length <= maxBodyLen) return body;
  const truncated = truncateSafely(body, maxBodyLen, '');
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
  return flattenString(newBody + '\n\n...[truncated to protect context]');
}

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
    (args.summary) ? Promise.resolve(new Map()) : getNumstatMap(formattingFlags, shas).catch((err) => {
      console.warn('Warning: Failed to get numstat map (This may cause missing file stats for this batch):', err instanceof Error ? err.message : String(err));
      return new Map();
    }),
    ((args['include-patch'] || args['diff-context'] !== undefined) && !args.summary) ? getPatchMap(formattingFlags, args, shas).catch((err) => {
      console.warn('Warning: Failed to get patch map (This may cause missing patches for this batch):', err instanceof Error ? err.message : String(err));
      return undefined;
    }) : Promise.resolve(undefined)
  ]);
  for (const [k, v] of nMap.entries()) numstatMap.set(k, v);
  
  if (pMapResult && typeof pMapResult.entries === 'function') {
    for (const [k, v] of pMapResult.entries()) patchMap.set(k, v);
  }

  const processed: CommitEntry[] = [];
  const parsedMaxBodyLen = args['max-body-length'];
  const maxBodyLen = (parsedMaxBodyLen !== undefined && !Number.isNaN(parsedMaxBodyLen) && parsedMaxBodyLen >= 0) ? parsedMaxBodyLen : DEFAULT_MAX_BODY_LEN;
  const maxFilesPerCommit = MAX_FILES_PER_COMMIT;

  for (const b of batch) {
    const { sha, parents, refs, tags, authorName, authorEmail, committerName, committerEmail, committerDate, date, type, scope, isBreaking, breakingChangeDescription, cleanSubject, subject, rawFiles, metadataObj, trailersObj, references, coAuthors, reviewers, issuesMap, isRevert, revertedCommit } = b;
    let body = b['body'];

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

    const trueFileCount = b.trueFileCount !== undefined ? Math.max(b.trueFileCount, uniqueStats.size) : Math.max(fileLines.length, uniqueStats.size);

    for (const line of fileLines) {
      const { status, file, oldFile, similarityScore } = line;

      let stats = statsForCommit.get(file);
      if (!stats && oldFile) stats = statsForCommit.get(oldFile);

      if (parsedFiles.length < maxFilesPerCommit) {
        const language = getLanguage(file);
        parsedFiles.push({
          status, file, ...(oldFile ? { oldFile } : {}),
          ...(similarityScore !== undefined ? { similarityScore } : {}),
          ...(stats && stats.insertions !== undefined ? { insertions: stats.insertions } : {}),
          ...(stats && stats.deletions !== undefined ? { deletions: stats.deletions } : {}),
          ...(stats?.isBinary ? { isBinary: true } : {}),
          ...(language ? { language } : {}),
        });
      }
    }

    if (trueFileCount > maxFilesPerCommit) {
      parsedFiles.push({
        status: 'M',
        file: `...and ${trueFileCount - parsedFiles.length} more files omitted`
      });
    }

    const size = computeCommitSize(nonNoiseInsertions + nonNoiseDeletions, trueFileCount);

    const cTime = committerDate ? new Date(committerDate).getTime() : NaN;
    const aTime = date ? new Date(date).getTime() : NaN;
    const isRebased = (committerEmail && authorEmail && committerEmail !== authorEmail && committerName !== 'GitHub') || 
                      (!isNaN(cTime) && !isNaN(aTime) && Math.abs(cTime - aTime) > MS_PER_DAY);

    const map = getSlackMap(args);
    const slackId = (authorEmail && map[authorEmail]) ? map[authorEmail] : (authorName && map[authorName] ? map[authorName] : undefined);

    const entryObj: Record<string, unknown> = {
      commit: sha || 'unknown_commit',
      ...(parents.length > 0 ? { parents } : {}),
      ...(refs.length > 0 ? { refs } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      author: authorName || 'Unknown Author',
      ...(authorEmail ? { email: authorEmail } : {}),
      ...(slackId ? { slackId } : {}),
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

    if ((args['include-patch'] || args['diff-context'] !== undefined) && patchMap.has(sha)) {
      const patchData = patchMap.get(sha);
      if (patchData) {
        entryObj.patch = patchData.patch;
        if (patchData.truncated) entryObj.isPatchTruncated = true;
      }
    }

    if (Object.keys(metadataObj).length > 0) entryObj['metadata'] = metadataObj;
    if (references.length > 0) entryObj.references = references;
    if (coAuthors.length > 0) entryObj.coAuthors = coAuthors;
    if (reviewers.length > 0) entryObj.reviewers = reviewers;
    if (trailersObj && Object.keys(trailersObj).length > 0) entryObj['trailersObj'] = trailersObj;

    if (isRevert) entryObj['isRevert'] = true;
    if (revertedCommit) entryObj['revertedCommit'] = revertedCommit;
    if (isBreaking) entryObj['isBreaking'] = true;
    if (breakingChangeDescription) entryObj['breakingChangeDescription'] = breakingChangeDescription;
    if (isRebased) entryObj['isRebased'] = true;

    body = body.replace(/(?:\r?\n){3,}/g, '\n\n');
    
    if (body.length > maxBodyLen) {
      body = truncateBodyWithContext(body, maxBodyLen);
      entryObj['isBodyTruncated'] = true;
    }
    if (body) entryObj['body'] = flattenString(body);

    const parsedEntry = parseWithFallbacks(entryObj, sha, subject, date, authorName);
    if (parsedEntry) processed.push(parsedEntry);
  }
  return processed;
}
