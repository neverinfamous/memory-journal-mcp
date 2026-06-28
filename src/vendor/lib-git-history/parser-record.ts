// @ts-nocheck
import { match, P } from 'ts-pattern';
import type { CliArgs } from './cli.js';
import { FIELD_SEPARATOR } from './git-runner.js';
import { extractIssues, getLanguage } from './parser-utils.js';
import { extractNumericMetadata } from './parser-metadata.js';

export type RawCommitBatchItem = {
  sha: string; parents: string[]; refs: string[]; tags: string[]; authorName: string; authorEmail: string; date: string;
  committerName: string; committerEmail: string; committerDate: string;
  subject: string; body: string; cleanSubject: string; type: string | undefined;
  scope: string | undefined; isBreaking: boolean; breakingChangeDescription: string | undefined; isRevert: boolean; revertedCommit: string | undefined;
  rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>; metadataObj: Record<string, unknown>; trailersObj?: Record<string, string>; references: string[];
  coAuthors: string[]; reviewers: string[]; issuesMap: Map<string, string | null>;
};

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
  if (parts.length < 13) {
    console.warn(`[lib-git-history] Warning: Dropping malformed git record with only ${parts.length} parts (expected at least 13).`);
    return null;
  }
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
  body = body.replace(/\r\n/g, '\n');
  if (body.length > 100000) {
    let safeLen = 100000;
    while (safeLen > 0 && body.charCodeAt(safeLen - 1) >= 0xD800 && body.charCodeAt(safeLen - 1) <= 0xDBFF) {
      safeLen--;
    }
    body = (' ' + body.slice(0, safeLen) + '\n\n...[body truncated to prevent memory exhaustion]').slice(1);
  }
  const hasBOM = body.startsWith('\uFEFF');
  body = body.trim();
  if (hasBOM && !body.startsWith('\uFEFF')) {
    body = '\uFEFF' + body;
  }
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
          console.warn(`[lib-git-history] Warning: Desynced or invalid file status "${statusRaw}" in commit ${sha}. Stopping file parsing for this commit.`);
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
          const flatFile = (' ' + file).slice(1);
          const flatStatus = (' ' + status).slice(1);
          const flatOldFile = oldFile ? (' ' + oldFile).slice(1) : undefined;
          const lang = getLanguage(flatFile);
          rawFiles.push({
             status: flatStatus, file: flatFile, ...(flatOldFile ? { oldFile: flatOldFile } : {}),
             ...(lang ? { language: lang } : {}),
             ...(similarityScore !== undefined ? { similarityScore } : {})
          });
        }
        statusRaw = getNextFilePart();
      }
    }
  }

  subject = subject.replace(/\r\n/g, '\n').replace(/\n$/, '');
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
  const metadataObj: Record<string, unknown> = Object.create(null);
  const customTrailers: Record<string, string[]> = Object.create(null);
  const trailersObj: Record<string, string> = Object.create(null);

  if (rawTrailers) {
    const trailerList = rawTrailers.split('\x1C').filter(Boolean);
    for (const t of trailerList) {
      const colonIdx = t.indexOf(':');
      const keyRaw = colonIdx === -1 ? t.trim() : t.slice(0, colonIdx).trim();
      const key = keyRaw.toLowerCase().replace(/\s+/g, '-');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const rawVal = colonIdx === -1 ? '' : t.slice(colonIdx + 1).trim();
      let val = rawVal.replace(/\r?\n[ \t]+/g, '\n');
      
      if (val.length > 5000) {
        let safeLen = 5000;
        while (safeLen > 0 && val.charCodeAt(safeLen - 1) >= 0xD800 && val.charCodeAt(safeLen - 1) <= 0xDBFF) { safeLen--; }
        val = val.slice(0, safeLen) + '\n...[trailer truncated due to length]';
      }
      
      trailersObj[keyRaw] = val;

      match(key)
        .with(P.union('history-category', 'changelog-category', 'category'), () => {
          const titleCase = (s: string) => s.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const splitVals: string[] = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < val.length; i++) {
            const char = val[i];
            if (char === '"') inQuotes = !inQuotes;
            if (char === ',' && !inQuotes) {
              splitVals.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          splitVals.push(current);
          categories.push(...splitVals.map(s => titleCase(s.trim().replace(/^"|"$/g, ''))).filter(Boolean));
        })
        .with(P.union('history-entry', 'changelog-entry', 'entry'), () => { entriesParsed.push(val); })
        .with(P.union('history-significance', 'changelog-significance', 'significance'), () => { metadataObj.significance = val; })
        .with(P.union('history-impact', 'changelog-impact', 'impact'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj.impact = ext;
        })
        .with(P.union('history-confidence', 'changelog-confidence', 'confidence'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj.confidence = ext;
        })
        .with(P.union('history-trust', 'changelog-trust', 'trust'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj.trust = ext;
        })
        .with(P.when((k: string) => /^(validation|history-validation|changelog-validation)(-status)?$/.test(k)), () => {
          let v = val.toLowerCase();
          if (['success', 'ok', 'passing'].includes(v)) v = 'passed';
          else if (['error', 'failing', 'fail'].includes(v)) v = 'failed';
          metadataObj.validation = v;
        })
        .with('breaking-change', () => {
          isBreaking = true;
          if (val.trim()) breakingChangeDescription = val;
        })
        .with('co-authored-by', () => { coAuthors.push(...val.split(',').map(s => s.trim()).filter(Boolean)); })
        .with('reviewed-by', () => { if (val) reviewers.push(val); })
        .with(P.when((k: string) => /^(acked-by|bug|cc|closes|depends-on|fixes|related-to|reported-by|resolves|see-also|signed-off-by|tested-by)$/.test(k)), () => {
          const niceKey = key.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
          if (val) references.push(`${niceKey}: ${val}`);
        })
        .otherwise(() => {
          if (colonIdx === -1) return; // Skip malformed custom trailers missing colons
          if (!customTrailers[key]) customTrailers[key] = [];
          customTrailers[key].push(val);
        });
    }
  }

  if (categories.length > 50) categories.length = 50;
  if (entriesParsed.length > 50) entriesParsed.length = 50;
  if (references.length > 50) references.length = 50;
  if (coAuthors.length > 50) coAuthors.length = 50;
  if (reviewers.length > 50) reviewers.length = 50;
  for (const k of Object.keys(customTrailers)) {
    if (customTrailers[k].length > 50) customTrailers[k].length = 50;
  }

  if (exactTrailerBlock) {
    const normalizedBody = body.replace(/\r\n?/g, '\n');
    const trailerTrimmed = exactTrailerBlock.replace(/\r\n?/g, '\n').trim();
    if (trailerTrimmed.length > 0) {
      const trimmedBody = normalizedBody.trimEnd();
      if (trimmedBody.endsWith(trailerTrimmed)) {
        body = trimmedBody.slice(0, -trailerTrimmed.length).trimEnd();
      }
    }
  }

  const bcMatch = body.match(/BREAKING[\s-]CHANGES?:?[ \t]*\n?([\s\S]*?)(?:\n\n|$)/i);
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
  extractIssues(subject, issuesMap, args['issue-pattern']);
  extractIssues(body, issuesMap, args['issue-pattern']);

  return {
    sha: (' ' + sha).slice(1), parents, refs, tags, 
    authorName: (' ' + authorName).slice(1), authorEmail: (' ' + authorEmail).slice(1), 
    date: (' ' + date).slice(1), committerName: (' ' + committerName).slice(1), 
    committerEmail: (' ' + committerEmail).slice(1), committerDate: (' ' + committerDate).slice(1),
    subject: (' ' + subject).slice(1), body, cleanSubject: (' ' + cleanSubject).slice(1), 
    type: type ? (' ' + type).slice(1) : undefined, scope: scope ? (' ' + scope).slice(1) : undefined, 
    isBreaking, isRevert, 
    revertedCommit: revertedCommit ? (' ' + revertedCommit).slice(1) : undefined, 
    breakingChangeDescription: breakingChangeDescription ? (' ' + breakingChangeDescription).slice(1) : undefined,
    rawFiles, metadataObj, trailersObj, references, coAuthors, reviewers, issuesMap
  };
}
