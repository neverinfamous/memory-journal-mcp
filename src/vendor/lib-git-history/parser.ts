// @ts-nocheck
import { z } from 'zod';
import { entrySchema, fileStatusSchema, type CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { getNumstatMap } from './git-numstat.js';
import { getPatchMap } from './git-patch.js';
import { FIELD_SEPARATOR } from './git-runner.js';
import { isNoiseFile, extractIssues } from './parser-utils.js';

export type RawCommitBatchItem = {
  sha: string; parents: string[]; refs: string[]; tags: string[]; authorName: string; authorEmail: string; date: string;
  committerName: string; committerEmail: string; committerDate: string;
  subject: string; body: string; cleanSubject: string; type: string | undefined;
  scope: string | undefined; isBreaking: boolean; breakingChangeDescription: string | undefined; isRevert: boolean; revertedCommit: string | undefined;
  rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>; metadataObj: Record<string, unknown>; references: string[];
  coAuthors: string[]; reviewers: string[]; issuesMap: Map<string, string | null>;
};



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
    const { sha, parents, refs, tags, authorName, authorEmail, committerName, committerEmail, committerDate, date, type, scope, isBreaking, breakingChangeDescription, cleanSubject, subject, rawFiles, metadataObj, references, coAuthors, reviewers, issuesMap, isRevert, revertedCommit } = b;
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

export function parseGitRecord(
  commitBlock: string,
  args: CliArgs
): RawCommitBatchItem | null {
  const parts: string[] = [];
  let currentStr = commitBlock;
  
  // Extract first 9 fields (sha to subject)
  for (let i = 0; i < 9; i++) {
    const idx = currentStr.indexOf(FIELD_SEPARATOR);
    if (idx === -1) break;
    parts.push(currentStr.slice(0, idx));
    currentStr = currentStr.slice(idx + FIELD_SEPARATOR.length);
  }
  
  // Extract last 3 fields (exactTrailerBlock, rawTrailers, parentsAndFiles)
  const endParts: string[] = [];
  let tempStr = currentStr;
  for (let i = 0; i < 3; i++) {
    const idx = tempStr.lastIndexOf(FIELD_SEPARATOR);
    if (idx === -1) break;
    endParts.unshift(tempStr.slice(idx + FIELD_SEPARATOR.length));
    tempStr = tempStr.slice(0, idx);
  }
  
  // The remainder is the body
  parts.push(tempStr);
  parts.push(...endParts);

  if (parts.length < 13) return null;

  const sha = parts[0].trim();
  const refsRaw = parts[1].trim();
  const authorName = parts[2].trim();
  const authorEmail = parts[3].trim();
  const date = parts[4].trim();
  const committerName = parts[5].trim();
  const committerEmail = parts[6].trim();
  const committerDate = parts[7].trim();
  let subject = parts[8].trim();
  
  const bodyEndIdx = parts.length - 3;
  let body = parts.slice(9, bodyEndIdx).join(FIELD_SEPARATOR);
  body = body.replace(/\r$/, '');
  if (body.length > 100000) {
    let safeLen = 100000;
    while (safeLen > 0 && body.charCodeAt(safeLen - 1) >= 0xD800 && body.charCodeAt(safeLen - 1) <= 0xDBFF) {
      safeLen--;
    }
    body = (' ' + body.slice(0, safeLen) + '\n\n...[body truncated to prevent memory exhaustion]').slice(1);
  }
  body = (' ' + body.trim()).slice(1);
  const exactTrailerBlock = parts[bodyEndIdx].trim();
  const rawTrailers = parts[bodyEndIdx + 1].trim();
  
  const parentsAndFiles = parts[bodyEndIdx + 2];
  let parentsRaw: string;
  let filesBlock = '';
  const firstNewline = parentsAndFiles.indexOf('\n');
  const firstNul = parentsAndFiles.indexOf('\0');
  
  if (firstNewline !== -1 && (firstNul === -1 || firstNewline < firstNul)) {
    parentsRaw = parentsAndFiles.slice(0, firstNewline).trim();
    filesBlock = parentsAndFiles.slice(firstNewline + 1).replace(/^\r+/, '');
  } else if (firstNul !== -1) {
    parentsRaw = parentsAndFiles.slice(0, firstNul).trim();
    filesBlock = parentsAndFiles.slice(firstNul + 1);
  } else {
    parentsRaw = parentsAndFiles.trim();
  }

  const rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }> = [];
  let fileBlockIdx = 0;
  const getNextFilePart = (): string | null => {
    if (!filesBlock || fileBlockIdx >= filesBlock.length) return null;
    const nulIdx = filesBlock.indexOf('\x00', fileBlockIdx);
    if (nulIdx === -1) {
      const part = filesBlock.slice(fileBlockIdx);
      fileBlockIdx = filesBlock.length;
      return part;
    }
    const part = filesBlock.slice(fileBlockIdx, nulIdx);
    fileBlockIdx = nulIdx + 1;
    return part;
  };

  let firstStatus = getNextFilePart();
  if (firstStatus !== null) {
    firstStatus = firstStatus.replace(/^\n+/, '');
    if (firstStatus || fileBlockIdx < filesBlock.length) {
      let statusRaw: string | null = firstStatus;
      let iterations = 0;
      let emptyCount = 0;
      while (statusRaw !== null && iterations < 5000) {
        iterations++;
        if (statusRaw === '') {
          emptyCount++;
          if (emptyCount > 10) break; // Safeguard against malformed NUL floods
          statusRaw = getNextFilePart();
          continue;
        }
        emptyCount = 0;
        if (rawFiles.length >= 500) {
          // Cap parsed files to prevent OOMs on massive commits
          break;
        }
        
        const isValidStatus = /^[A-Z][A-Z\d]*$/.test(statusRaw) && statusRaw.length <= 20;
        if (!isValidStatus) {
          break; // Desynced or invalid status. Stop parsing files for this commit.
        }
        
        let status = statusRaw;
        let similarityScore;
        const digitsMatch = statusRaw.match(/(\d{1,3})$/);
        if (digitsMatch) {
          similarityScore = parseInt(digitsMatch[1], 10);
          status = statusRaw.slice(0, -digitsMatch[1].length);
        }
        
        let numOldFiles = 0;
        const statusLetters = status.replace(/\d+/g, '');
        // NOTE: In standard format (e.g. R100), length is 1, so we correctly read oldFile.
        // For combined diffs (e.g. RM, CR), length > 1. Git's combined format intentionally omits oldFile paths!
        // Do NOT change this logic to check length > 1, as it perfectly aligns with Git's combined omission.
        if (statusLetters.length === 1) {
          for (const char of statusLetters) {
            if (char === 'R' || char === 'C') numOldFiles++;
          }
        }
        
        let oldFile;
        if (numOldFiles > 0) {
          oldFile = getNextFilePart() || undefined;
          for (let j = 1; j < numOldFiles; j++) {
            getNextFilePart();
          }
        }
        const file = getNextFilePart();
        
        if (file) {
          rawFiles.push({
             status, file, ...(oldFile ? { oldFile } : {}),
             ...(similarityScore !== undefined ? { similarityScore } : {})
          });
        }
        statusRaw = getNextFilePart();
      }
    }
  }

  subject = subject.replace(/\r$/, '');
  if (subject.length > 5000) {
    let safeLen = 5000;
    while (safeLen > 0 && subject.charCodeAt(safeLen - 1) >= 0xD800 && subject.charCodeAt(safeLen - 1) <= 0xDBFF) {
      safeLen--;
    }
    subject = subject.slice(0, safeLen) + '...[subject truncated]';
  }

  const cleanStart = subject.replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u, '').replace(/^:\w+:\s*/, '');
  const convMatch = cleanStart.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/);
  let type, scope, cleanSubject = subject;
  let isBreaking = false;
  let breakingChangeDescription: string | undefined = undefined;
  if (convMatch) {
    type = convMatch[1];
    scope = convMatch[2];
    isBreaking = !!convMatch[3];
    cleanSubject = convMatch[4].trim();
  }

  const categories: string[] = [];
  const entriesParsed: string[] = [];
  const references: string[] = [];
  const coAuthors: string[] = [];
  const reviewers: string[] = [];
  const metadataObj: Record<string, unknown> = {};
  const customTrailers: Record<string, string[]> = {};

  if (rawTrailers) {
    const trailerList = rawTrailers.split('\x1C').filter(Boolean);
    for (const t of trailerList) {
      const colonIdx = t.indexOf(':');
      if (colonIdx === -1) continue;
      const key = t.slice(0, colonIdx).trim().toLowerCase();
      const rawVal = t.slice(colonIdx + 1).trim();
      const val = rawVal.replace(/\r?\n[ \t]+/g, '\n');

      if (key === 'history-category' || key === 'changelog-category' || key === 'category') {
        const titleCase = (s: string) => s.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        categories.push(...val.split(',').map(s => titleCase(s.trim())).filter(Boolean));
      }
      else if (key === 'history-entry' || key === 'changelog-entry' || key === 'entry') entriesParsed.push(val);
      else if (key === 'history-significance' || key === 'changelog-significance' || key === 'significance') metadataObj.significance = val;
      else if (key === 'history-impact' || key === 'changelog-impact' || key === 'impact') {
        const v = val.trim().toLowerCase();
        if (v === 'high') metadataObj.impact = 0.8;
        else if (v === 'medium') metadataObj.impact = 0.5;
        else if (v === 'low') metadataObj.impact = 0.2;
        else {
          const num = Number(val.trim());
          metadataObj.impact = (val.trim() === '' || isNaN(num)) ? val : num;
        }
      }
      else if (key === 'history-trust' || key === 'changelog-trust' || key === 'trust') {
        const v = val.trim().toLowerCase();
        if (v === 'high') metadataObj.trust = 0.8;
        else if (v === 'medium') metadataObj.trust = 0.5;
        else if (v === 'low') metadataObj.trust = 0.2;
        else {
          const num = Number(val.trim());
          metadataObj.trust = (val.trim() === '' || isNaN(num)) ? val : num;
        }
      }
      else if (key.match(/^(validation|history-validation|changelog-validation)(-status)?$/)) {
        let v = val.toLowerCase();
        if (['success', 'ok', 'passing'].includes(v)) v = 'passed';
        else if (['error', 'failing', 'fail'].includes(v)) v = 'failed';
        metadataObj.validation = v;
      }
      else if (key === 'breaking-change') {
        isBreaking = true;
        if (val.trim()) breakingChangeDescription = val;
      }
      else if (key === 'co-authored-by') coAuthors.push(...val.split(',').map(s => s.trim()).filter(Boolean));
      else if (key === 'reviewed-by') reviewers.push(val);
      else if (key.match(/^(acked-by|bug|cc|closes|depends-on|fixes|related-to|reported-by|resolves|see-also|signed-off-by|tested-by)$/)) {
        const niceKey = key.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
        references.push(`${niceKey}: ${val}`);
      } else {
        if (!customTrailers[key]) customTrailers[key] = [];
        const maxTrailerLen = 5000;
        let safeLen = maxTrailerLen;
        while (safeLen > 0 && val.charCodeAt(safeLen - 1) >= 0xD800 && val.charCodeAt(safeLen - 1) <= 0xDBFF) {
          safeLen--;
        }
        const safeVal = val.length > maxTrailerLen ? val.slice(0, safeLen) + '\n...[trailer truncated due to length]' : val;
        customTrailers[key].push(safeVal);
      }
    }
  }

  if (exactTrailerBlock) {
    const normalizedBody = body.replace(/\r\n/g, '\n');
    const trailerTrimmed = exactTrailerBlock.replace(/\r\n/g, '\n').trim();
    if (trailerTrimmed.length > 0) {
      const trimmedBody = normalizedBody.trimEnd();
      if (trimmedBody.endsWith(trailerTrimmed)) {
        body = trimmedBody.slice(0, -trailerTrimmed.length).trimEnd();
      } else {
        const idx = normalizedBody.lastIndexOf(trailerTrimmed);
        if (idx !== -1) {
           body = normalizedBody.slice(0, idx).trimEnd();
        }
      }
    }
  }

  const bcMatch = body.match(/BREAKING[\s-]CHANGES?:?\s+([\s\S]*)$/i);
  if (bcMatch) {
    isBreaking = true;
    breakingChangeDescription = bcMatch[1].trim();
  } else if (!isBreaking && /BREAKING[\s-]CHANGES?(?::|$)/im.test(body)) {
    isBreaking = true;
  }

  if (categories.length > 0) metadataObj.category = categories;
  if (entriesParsed.length > 0) metadataObj.entry = entriesParsed;
  if (Object.keys(customTrailers).length > 0) metadataObj.customTrailers = customTrailers;

  if (args.category && !categories.includes(args.category)) return null;
  if (args.type && type !== args.type) return null;
  if (args.breaking && !isBreaking) return null;
  if (args['changelog-only'] && entriesParsed.length === 0 && !(['feat', 'fix', 'perf', 'revert'].includes(type || '') || isBreaking)) return null;

  const refs = refsRaw ? refsRaw.split(', ').map(r => r.trim().replace(/^HEAD -> /, '')).filter(Boolean) : [];
  const tags = refs.filter(r => r.startsWith('tag: ')).map(r => r.replace(/^tag:\s*/, ''));
  const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];
  
  let isRevert = false;
  let revertedCommit: string | undefined = undefined;
  const revertMatch = body.match(/This reverts commit ([a-f0-9]{7,40})/);
  if (/^revert:? /i.test(subject) || revertMatch) {
    isRevert = true;
    if (revertMatch) revertedCommit = revertMatch[1];
  }

  const issuesMap = new Map<string, string | null>();
  extractIssues(subject, issuesMap);
  extractIssues(body, issuesMap);

  return {
    sha, parents, refs, tags, authorName, authorEmail, date, committerName, committerEmail, committerDate,
    subject, body, cleanSubject, type, scope, isBreaking, isRevert, revertedCommit, breakingChangeDescription,
    rawFiles, metadataObj, references, coAuthors, reviewers, issuesMap
  };
}
