import { match, P } from 'ts-pattern';
import type { CliArgs } from './cli.js';
import { FIELD_SEPARATOR } from './git-runner.js';
import { extractIssues, getLanguage, truncateSafely, flattenString } from './parser-utils.js';
import { extractNumericMetadata, evaluateNumericFilter } from './parser-metadata.js';
import { MAX_BODY_LENGTH, MAX_SUBJECT_LENGTH, MAX_TRAILER_LENGTH, EXPECTED_RECORD_PARTS, MAX_STATUS_ITERATIONS, MAX_EMPTY_STATUS_COUNT, MAX_PARSED_FILES, MAX_ARRAY_LENGTH, RECORD_START_FIELDS, RECORD_END_FIELDS, REGEX_FILE_STATUS, REGEX_CONVENTIONAL_COMMIT, REGEX_VALIDATION_TRAILER, REGEX_REFERENCE_TRAILER, REGEX_BREAKING_CHANGE, REGEX_REVERT_COMMIT } from './constants.js';

export type RawCommitBatchItem = {
  sha: string; parents: string[]; refs: string[]; tags: string[]; authorName: string; authorEmail: string; date: string;
  committerName: string; committerEmail: string; committerDate: string;
  subject: string; body: string; cleanSubject: string; type: string | undefined;
  scope: string | undefined; isBreaking: boolean; breakingChangeDescription: string | undefined; isRevert: boolean; revertedCommit: string | undefined;
  rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>; metadataObj: Record<string, unknown>; trailersObj?: Record<string, string>; references: string[];
  coAuthors: string[]; reviewers: string[]; issuesMap: Map<string, string | null>;
  trueFileCount: number;
};

function extractRecordParts(commitBlock: string): string[] | null {
  const parts: string[] = [];
  let currentStr = commitBlock;
  
  for (let i = 0; i < RECORD_START_FIELDS; i++) {
    const idx = currentStr.indexOf(FIELD_SEPARATOR);
    if (idx === -1) break;
    parts.push(currentStr.slice(0, idx));
    currentStr = currentStr.slice(idx + FIELD_SEPARATOR.length);
  }
  
  const endParts: string[] = [];
  let tempStr = currentStr;
  for (let i = 0; i < RECORD_END_FIELDS; i++) {
    const idx = tempStr.lastIndexOf(FIELD_SEPARATOR);
    if (idx === -1) break;
    endParts.unshift(tempStr.slice(idx + FIELD_SEPARATOR.length));
    tempStr = tempStr.slice(0, idx);
  }
  
  parts.push(tempStr);
  parts.push(...endParts);
  
  if (parts.length < EXPECTED_RECORD_PARTS) {
    console.warn(`[lib-git-history] Warning: Dropping malformed git record with only ${parts.length} parts (expected at least ${EXPECTED_RECORD_PARTS}).`);
    return null;
  }
  return parts;
}

function parseFilesBlock(filesBlock: string, sha: string): { rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }>, trueFileCount: number } {
  const rawFiles: Array<{ status: string; file: string; oldFile?: string; similarityScore?: number }> = [];
  let trueFileCount = 0;
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
      while (statusRaw !== null && iterations < MAX_STATUS_ITERATIONS) {
        iterations++;
        if (statusRaw === '') {
          emptyCount++;
          if (emptyCount > MAX_EMPTY_STATUS_COUNT) break; // Safeguard against malformed NUL floods
          statusRaw = getNextFilePart();
          continue;
        }
        emptyCount = 0;
        const shouldPush = rawFiles.length < MAX_PARSED_FILES;
        
        const isValidStatus = REGEX_FILE_STATUS.test(statusRaw) && statusRaw.length <= 20;
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
          trueFileCount++;
          if (shouldPush) {
            const flatFile = flattenString(file);
            const flatStatus = flattenString(status);
            const flatOldFile = oldFile ? flattenString(oldFile) : undefined;
            const lang = getLanguage(flatFile);
            rawFiles.push({
               status: flatStatus, file: flatFile, ...(flatOldFile ? { oldFile: flatOldFile } : {}),
               ...(lang ? { language: lang } : {}),
               ...(similarityScore !== undefined ? { similarityScore } : {})
            });
          }
        }
        statusRaw = getNextFilePart();
      }
    }
  }
  return { rawFiles, trueFileCount };
}

export function parseGitRecord(
  commitBlock: string,
  args: CliArgs
): RawCommitBatchItem | null {
  const parts = extractRecordParts(commitBlock);
  if (!parts) return null;

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
  if (body.length > MAX_BODY_LENGTH) {
    body = truncateSafely(body, MAX_BODY_LENGTH, '\n\n...[body truncated to prevent memory exhaustion]');
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

  const { rawFiles, trueFileCount } = parseFilesBlock(filesBlock, sha);

  subject = subject.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (subject.length > MAX_SUBJECT_LENGTH) {
    subject = truncateSafely(subject, MAX_SUBJECT_LENGTH, '...[subject truncated]');
  }

  const cleanStart = subject.replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u, '').replace(/^:\w+:\s*/, '');
  const convMatch = cleanStart.match(REGEX_CONVENTIONAL_COMMIT);
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
      let val = rawVal.replace(/\r?\n[ \t]+/g, '\n').replace(/\u200B/g, '');
      
      if (val.length > MAX_TRAILER_LENGTH) {
        val = truncateSafely(val, MAX_TRAILER_LENGTH, '\n...[trailer truncated due to length]');
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
        .with(P.union('history-significance', 'changelog-significance', 'significance'), () => { metadataObj['significance'] = val; })
        .with(P.union('history-impact', 'changelog-impact', 'impact'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj['impact'] = ext;
        })
        .with(P.union('history-confidence', 'changelog-confidence', 'confidence'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj['confidence'] = ext;
        })
        .with(P.union('history-trust', 'changelog-trust', 'trust'), () => {
          const ext = extractNumericMetadata(val);
          if (ext !== undefined) metadataObj['trust'] = ext;
        })
        .with(P.when((k: string) => REGEX_VALIDATION_TRAILER.test(k)), () => {
          let v = val.toLowerCase();
          if (['success', 'ok', 'passing'].includes(v)) v = 'passed';
          else if (['error', 'failing', 'fail'].includes(v)) v = 'failed';
          metadataObj['validation'] = v;
        })
        .with(P.union('breaking-change', 'breaking-changes'), () => {
          isBreaking = true;
          if (val.trim()) breakingChangeDescription = val;
        })
        .with('co-authored-by', () => { coAuthors.push(...val.split(',').map(s => s.trim()).filter(Boolean)); })
        .with('reviewed-by', () => { if (val) reviewers.push(val); })
        .with(P.when((k: string) => REGEX_REFERENCE_TRAILER.test(k)), () => {
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

  const enforceMaxArray = (arr: unknown[], name: string) => {
    if (arr.length > MAX_ARRAY_LENGTH) {
      console.warn(`[lib-git-history] Warning: Array ${name} truncated from ${arr.length} to ${MAX_ARRAY_LENGTH} items in commit ${sha}`);
      arr.length = MAX_ARRAY_LENGTH;
    }
  };

  enforceMaxArray(categories, 'categories');
  enforceMaxArray(entriesParsed, 'entriesParsed');
  enforceMaxArray(references, 'references');
  enforceMaxArray(coAuthors, 'coAuthors');
  enforceMaxArray(reviewers, 'reviewers');
  for (const k of Object.keys(customTrailers)) {
    enforceMaxArray(customTrailers[k], `customTrailers[${k}]`);
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

  const bcMatch = body.match(REGEX_BREAKING_CHANGE);
  match(bcMatch)
    .with(P.not(P.nullish), (m) => {
      isBreaking = true;
      if (!breakingChangeDescription) {
        breakingChangeDescription = m[1].trim();
      }
    })
    .otherwise(() => {
      if (!isBreaking && /^BREAKING[\s-]CHANGES?(?::|$)/im.test(body)) {
        isBreaking = true;
      }
    });

  if (categories.length > 0) metadataObj['category'] = categories;
  if (entriesParsed.length > 0) metadataObj['entry'] = entriesParsed;
  if (Object.keys(customTrailers).length > 0) metadataObj['customTrailers'] = customTrailers;

  const filterCategories = categories.length > 0 ? categories : (type ? [type.charAt(0).toUpperCase() + type.slice(1)] : ['Uncategorized']);
  if (args['category']) {
    const allowedCategories = args['category'].split(',').map(c => c.trim().toLowerCase());
    if (!filterCategories.some(c => allowedCategories.includes(c.toLowerCase()))) return null;
  }
  if (args.type) {
    const allowedTypes = args.type.split(',').map(t => t.trim().toLowerCase());
    if (!type || !allowedTypes.includes(type.toLowerCase())) return null;
  }
  if (args.breaking && !isBreaking) return null;
  if (args['changelog-only'] && entriesParsed.length === 0 && !(['feat', 'fix', 'perf', 'revert'].includes(type || '') || isBreaking)) return null;

  if (args['impact']) {
    const rawImpact = metadataObj['impact'];
    const pass = evaluateNumericFilter(args['impact'], typeof rawImpact === 'number' ? rawImpact : undefined);
    if (!pass) return null;
  }

  if (args['confidence']) {
    const rawConfidence = metadataObj['confidence'];
    const pass = evaluateNumericFilter(args['confidence'], typeof rawConfidence === 'number' ? rawConfidence : undefined);
    if (!pass) return null;
  }

  const refs = refsRaw ? refsRaw.split(', ').map(r => r.trim().replace(/^HEAD -> /, '')).filter(Boolean) : [];
  const tags = refs.filter(r => r.startsWith('tag: ')).map(r => r.replace(/^tag:\s*/, ''));
  const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];
  
  let isRevert = false;
  let revertedCommit: string | undefined = undefined;
  const revertMatch = body.match(REGEX_REVERT_COMMIT);
  if (/^revert:? /i.test(subject) || revertMatch) {
    isRevert = true;
    if (revertMatch) revertedCommit = revertMatch[1];
  }

  const issuesMap = new Map<string, string | null>();
  extractIssues(subject, issuesMap, args['issue-pattern']);
  extractIssues(body, issuesMap, args['issue-pattern']);

  if (args['issue-tracker']) {
    const tracker = args['issue-tracker'];
    const newIssuesMap = new Map<string, string | null>();
    for (const [issue, action] of issuesMap.entries()) {
      let finalIssue = issue;
      if (issue.startsWith('#')) {
        finalIssue = tracker + (tracker.endsWith('/') ? '' : '') + issue.slice(1);
      } else if (!issue.startsWith('http')) {
        finalIssue = tracker.endsWith('/') ? tracker + issue : tracker + '/' + issue;
      }
      newIssuesMap.set(finalIssue, action);
    }
    issuesMap.clear();
    for (const [k, v] of newIssuesMap.entries()) {
      issuesMap.set(k, v);
    }
  }

  return {
    sha: flattenString(sha), parents, refs, tags, 
    authorName: flattenString(authorName), authorEmail: flattenString(authorEmail), 
    date: flattenString(date), committerName: flattenString(committerName), 
    committerEmail: flattenString(committerEmail), committerDate: flattenString(committerDate),
    subject: flattenString(subject), body, cleanSubject: flattenString(cleanSubject), 
    type: type ? flattenString(type) : undefined, scope: scope ? flattenString(scope) : undefined, 
    isBreaking, isRevert, 
    revertedCommit: revertedCommit ? flattenString(revertedCommit) : undefined, 
    breakingChangeDescription: breakingChangeDescription ? flattenString(breakingChangeDescription) : undefined,
    rawFiles, metadataObj, trailersObj, references, coAuthors, reviewers, issuesMap, trueFileCount
  };
}
