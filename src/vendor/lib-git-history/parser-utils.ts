// @ts-nocheck
import path from 'node:path';
import type { CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { MAX_ARRAY_LENGTH, MAX_ISSUE_TEXT_LENGTH, createNullProtoRecord, flattenString, truncateSafely, getLanguage } from './constants.js';
import { isSafeCustomIssuePattern } from './security-regex.js';
import {
  encodeTrackerIssueToken, isSafeHttpUrl, isSafeRepoHost, readContainedTextFileSync,
  sanitizeLogText, sanitizeRepoPathSegments,
} from './security-utils.js';

export { flattenString, truncateSafely, getLanguage };

const EMPTY_SLACK_MAP: Record<string, string> = Object.freeze(createNullProtoRecord<string>());

export function extractShaFromBuffer(recordBuf: Buffer): { sha: string; shaEnd: number } {
  let shaEnd = recordBuf.indexOf(0x0A);
  // [INTENT]: Bound the NUL probe to bytes preceding `\n` so text patch buffers (up to 100MB) are never scanned end-to-end.
  const nullIdx = shaEnd !== -1 ? recordBuf.subarray(0, shaEnd).indexOf(0x00) : recordBuf.indexOf(0x00);
  if (shaEnd === -1 || (nullIdx !== -1 && nullIdx < shaEnd)) shaEnd = nullIdx;
  if (shaEnd === -1) shaEnd = recordBuf.length;
  return { sha: recordBuf.toString('utf-8', 0, shaEnd).trim(), shaEnd };
}

const SLACK_MAP_CACHE = new Map<string, Record<string, string>>();
const MAX_SLACK_MAP_CACHE = 16;

function parseSlackMapJson(content: string, realPath: string): Record<string, string> {
  const empty = createNullProtoRecord<string>();
  try {
    const raw: unknown = JSON.parse(content);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { console.warn(`[lib-git-history] Warning: Invalid slack-map JSON shape at ${sanitizeLogText(realPath)}`); return empty; }
    const candidate = createNullProtoRecord<string>();
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') { console.warn(`[lib-git-history] Warning: Invalid slack-map JSON shape at ${sanitizeLogText(realPath)}`); return empty; }
      if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') candidate[k] = v;
    }
    return candidate;
  } catch (err: unknown) { console.warn(`[lib-git-history] Warning: Failed to parse slack-map JSON: ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`); return empty; }
}

export function getSlackMap(args: CliArgs, cwd: string = process.cwd()): Record<string, string> {
  const rawPath = args['slack-map'];
  if (!rawPath) return EMPTY_SLACK_MAP;
  const cacheKey = `${path.resolve(cwd)}\0${rawPath}`;
  const cached = SLACK_MAP_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const res = readContainedTextFileSync(cwd, rawPath, 1024 * 1024);
  if (!res.ok) console.warn(`[lib-git-history] Warning: Failed to load slack-map JSON: ${sanitizeLogText(res.reason)}`);
  const resultMap = Object.freeze(res.ok ? parseSlackMapJson(res.content, res.realPath) : createNullProtoRecord<string>());
  if (SLACK_MAP_CACHE.size >= MAX_SLACK_MAP_CACHE) SLACK_MAP_CACHE.clear();
  SLACK_MAP_CACHE.set(cacheKey, resultMap);
  return resultMap;
}

export function hasOwnKeys(obj: Record<string, unknown>): boolean {
  for (const k in obj) { if (Object.hasOwn(obj, k)) return true; }
  return false;
}

const TRACKER_RULES_CACHE = new Map<string, Array<readonly [string, string]>>();
const MAX_TRACKER_RULES_CACHE = 32;
const PLACEHOLDER_ID_RE = /\{id\}/g;
const PLACEHOLDER_EMPTY_RE = /\{\}/g;
const SINGLE_TRACKER_RULE_RE = /^[^/=:\s]+\s*=\s*https?:\/\//i;

function getParsedTrackerRules(tracker: string): Array<readonly [string, string]> {
  const cached = TRACKER_RULES_CACHE.get(tracker);
  if (cached !== undefined) return cached;
  const rules: Array<readonly [string, string]> = [];
  for (const p of tracker.split(',')) {
    const eqIdx = p.indexOf('=');
    if (eqIdx === -1) continue;
    const prefix = p.slice(0, eqIdx).trim(), tpl = p.slice(eqIdx + 1).trim();
    if (tpl) rules.push([prefix, tpl] as const);
  }
  if (TRACKER_RULES_CACHE.size >= MAX_TRACKER_RULES_CACHE) TRACKER_RULES_CACHE.clear();
  TRACKER_RULES_CACHE.set(tracker, rules);
  return rules;
}

export function expandIssueTrackerUrl(issue: string, tracker: string): string {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return isSafeHttpUrl(issue) ? issue : '';
  let urlTemplate = tracker;
  if (urlTemplate.includes(',') || SINGLE_TRACKER_RULE_RE.test(urlTemplate)) {
    let matched = false;
    for (const [prefix, tpl] of getParsedTrackerRules(urlTemplate)) {
      if (issue.startsWith(prefix)) { urlTemplate = tpl; matched = true; break; }
    }
    if (!matched) return issue;
  }
  const encodedIssue = encodeTrackerIssueToken(issue);
  const encodedClean = encodeTrackerIssueToken(issue.startsWith('#') ? issue.slice(1) : issue);
  if (!encodedIssue || !encodedClean) return issue;
  let expanded: string;
  if (urlTemplate.includes('{id}') || urlTemplate.includes('{}')) {
    expanded = urlTemplate.replace(PLACEHOLDER_ID_RE, () => encodedClean).replace(PLACEHOLDER_EMPTY_RE, () => encodedIssue);
  } else if (issue.startsWith('#')) {
    expanded = urlTemplate + encodedClean;
  } else {
    expanded = urlTemplate.endsWith('/') ? urlTemplate + encodedIssue : urlTemplate + '/' + encodedIssue;
  }
  return isSafeHttpUrl(expanded) ? expanded : issue;
}

export function resolveIssueTrackerUrl(issue: string, repoHost: string, repoPath: string, args: CliArgs): string | null {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return isSafeHttpUrl(issue) ? issue : null;
  if (args['issue-tracker']) {
    const expanded = expandIssueTrackerUrl(issue, args['issue-tracker']);
    if (expanded !== issue && isSafeHttpUrl(expanded)) return expanded;
  }

  let candidate: string | null = null;
  if (issue.startsWith('#')) {
    const cleanRepoPath = sanitizeRepoPathSegments(repoPath);
    if (isSafeRepoHost(repoHost) && cleanRepoPath) {
      const num = encodeURIComponent(issue.slice(1));
      candidate = repoHost === 'gitlab.com' ? `https://gitlab.com/${cleanRepoPath}/-/issues/${num}` : `https://${repoHost}/${cleanRepoPath}/issues/${num}`;
    }
  } else if (issue.includes('#')) {
    const hashIdx = issue.indexOf('#');
    const cleanSlug = sanitizeRepoPathSegments(issue.slice(0, hashIdx));
    if (cleanSlug) candidate = `https://github.com/${cleanSlug}/issues/${encodeURIComponent(issue.slice(hashIdx + 1))}`;
  }
  return candidate && isSafeHttpUrl(candidate) ? candidate : null;
}

const NOISE_BASENAMES: ReadonlySet<string> = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'uv.lock', 'cargo.lock', 'gemfile.lock', 'poetry.lock', 'go.sum', 'changelog.md',
  '.gitignore', '.gitattributes', 'flake.lock', 'deno.lock', 'mix.lock', 'podfile.lock', 'cartfile.resolved',
  'tsconfig.json',
]);
const NOISE_DIRS: ReadonlySet<string> = new Set([
  'dist', '.dist', 'build', '.build', 'coverage', '.coverage', '.yarn',
  'vendor', '__snapshots__', '.vercel', '.next', '.nuxt', '.husky',
]);

const BACKSLASH_RE = /\\/g;

export function isNoiseFile(file: string): boolean {
  const lower = (file.includes('\\') ? file.replace(BACKSLASH_RE, '/') : file).toLowerCase();
  let segStart = 0;
  let prevSeg = '';
  let slash = lower.indexOf('/');
  while (slash !== -1) {
    const seg = lower.slice(segStart, slash);
    if (NOISE_DIRS.has(seg)) return true;
    prevSeg = seg;
    segStart = slash + 1;
    slash = lower.indexOf('/', segStart);
  }
  const base = segStart === 0 ? lower : lower.slice(segStart);
  if (NOISE_BASENAMES.has(base)) return true;
  if (base.endsWith('.snap') || base.startsWith('.ds_store')) return true;
  if (prevSeg === 'test-server' && (base === 'tool-reference.md' || base === 'code-map.md')) return true;
  const c0 = base.charCodeAt(0);
  if (c0 === 46) {
    return (base.startsWith('.pnp.') && base.length > 5) || (base.startsWith('.eslintrc.') && base.length > 10);
  }
  if (c0 === 116) return base.startsWith('tsconfig.') && base.endsWith('.json');
  if (c0 === 112) return base.startsWith('prettier.config.') && base.length > 16;
  if (c0 === 106) return base.startsWith('jest.config.') && base.length > 12;
  if (c0 === 118) return base.startsWith('vite.config.') && base.length > 12;
  return false;
}

const TRAILING_ACTION_REGEX = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)[\s:-]{0,10}$/i;
const CANONICAL_ISSUE_ACTIONS: ReadonlyMap<string, string> = new Map([
  'fixes', 'fix', 'closes', 'close', 'resolves', 'resolve', 'addresses', 'address', 'implements', 'related to', 'see also',
].map((k) => [k, k]));
const URL_TOKEN_REGEX = /https?:\/\/(?:[a-zA-Z0-9.-]+\.)?(github\.com|gitlab\.com|bitbucket\.org|atlassian\.net|linear\.app|slack\.com|notion\.so)\/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])/ig;
// [INVARIANT]: Non-overlapping whitespace group prevents O(N^2) backtracking on whitespace-padded gaps.
const SIMPLE_LIST_REGEX = /^\s*(?:(?:and|&|,|or|\()\s*)?$/i;
const SENTENCE_BREAK_REGEX = /[.;\n]/;
const IGNORED_ISSUE_PREFIXES: ReadonlySet<string> = new Set([
  'UTF', 'ISO', 'SHA', 'RFC', 'CVE', 'MAC', 'IP', 'IPV4', 'IPV6', 'X86', 'AMD64',
]);
const GIT_HOST_PATH_REGEX = /^(?:([\w.-]+\/[\w.-]+)\/)?(?:-\/)?(?:issues|pull|merge_requests|pull-requests)\/([A-Z0-9_.-]+)/i;
const ATLASSIAN_PATH_REGEX = /browse\/([A-Z0-9_.-]+)/i;
const LINEAR_PATH_REGEX = /issue\/([A-Z0-9_.-]+)/i;

const CUSTOM_ISSUE_REGEX_CACHE = new Map<string, RegExp | null>();
const MAX_CUSTOM_REGEX_CACHE = 32;
const MAX_CUSTOM_ISSUE_PATTERN_LENGTH = 500;

const isWordChar = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isDigitChar = (c: number): boolean => c >= 48 && c <= 57;
const isAlphaChar = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isRepoNameChar = (c: number): boolean => isWordChar(c) || c === 46 || c === 45;
const isWhitespaceCode = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;

function hasMoreThanTwoWords(str: string): boolean {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < str.length; i++) {
    if (isWhitespaceCode(str.charCodeAt(i))) { inWord = false; continue; }
    if (!inWord) { inWord = true; if (++words > 2) return true; }
  }
  return false;
}

function getCustomIssueRegex(issuePattern: string): RegExp | null {
  const cached = CUSTOM_ISSUE_REGEX_CACHE.get(issuePattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  if (!isSafeCustomIssuePattern(issuePattern, MAX_CUSTOM_ISSUE_PATTERN_LENGTH)) {
    console.warn(`[lib-git-history] Warning: Unsafe or invalid issue-pattern regex '${sanitizeLogText(issuePattern.slice(0, 64))}'; ignoring.`);
  } else {
    try { compiled = new RegExp(`(?:^|[^\\w])(${issuePattern})\\b`, 'ig'); }
    catch (err: unknown) { console.warn(`[lib-git-history] Warning: Invalid issue-pattern regex '${sanitizeLogText(issuePattern)}': ${sanitizeLogText(err instanceof Error ? err.message : String(err))}`); }
  }
  if (CUSTOM_ISSUE_REGEX_CACHE.size >= MAX_CUSTOM_REGEX_CACHE) CUSTOM_ISSUE_REGEX_CACHE.clear();
  CUSTOM_ISSUE_REGEX_CACHE.set(issuePattern, compiled);
  return compiled;
}

const isTrailingDelimCode = (c: number): boolean => isWhitespaceCode(c) || c === 58 || c === 45;

function resolvePrecedingAction(safeText: string, lastIndex: number, tokenStart: number, lastAction: string | null): string | null {
  const tailStart = tokenStart - lastIndex > 32 ? tokenStart - 32 : lastIndex;
  const actionMatch = safeText.slice(tailStart, tokenStart).match(TRAILING_ACTION_REGEX);
  if (actionMatch && actionMatch[1]) {
    const lower = actionMatch[1].toLowerCase();
    return CANONICAL_ISSUE_ACTIONS.get(lower) ?? flattenString(lower);
  }
  if (lastAction === null) return null;
  let trimmedEnd = tokenStart;
  const minEnd = Math.max(lastIndex, tokenStart - 10);
  while (trimmedEnd > minEnd && isTrailingDelimCode(safeText.charCodeAt(trimmedEnd - 1))) trimmedEnd--;
  const trimmedBetween = safeText.slice(lastIndex, trimmedEnd);
  if (SIMPLE_LIST_REGEX.test(trimmedBetween)) return lastAction;
  if (hasMoreThanTwoWords(trimmedBetween) || SENTENCE_BREAK_REGEX.test(trimmedBetween)) return null;
  return lastAction;
}

function recordIssueMatch(issuesMap: Map<string, string | null>, issue: string | undefined, action: string | null): void {
  if (!issue) return;
  const flatIssue = flattenString(issue), hasKey = issuesMap.has(flatIssue);
  if (hasKey ? Boolean(action && !issuesMap.get(flatIssue)) : issuesMap.size < MAX_ARRAY_LENGTH) issuesMap.set(flatIssue, action);
}

interface IssueTokenHit {
  start: number;
  end: number;
  issue: string;
}

function parseHashTokenAt(safeText: string, hashIdx: number): IssueTokenHit | null {
  const len = safeText.length;
  if (hashIdx + 1 >= len || !isDigitChar(safeText.charCodeAt(hashIdx + 1))) return null;
  let numEnd = hashIdx + 2;
  while (numEnd < len && isDigitChar(safeText.charCodeAt(numEnd))) numEnd++;
  if (numEnd < len && isWordChar(safeText.charCodeAt(numEnd))) return null;

  let cur = hashIdx - 1;
  while (cur >= 0 && isRepoNameChar(safeText.charCodeAt(cur))) cur--;
  if (cur >= 1 && cur < hashIdx - 1 && safeText.charCodeAt(cur) === 47) {
    let ownerStart = cur - 1;
    while (ownerStart >= 0) {
      const code = safeText.charCodeAt(ownerStart);
      if (!isRepoNameChar(code) && code !== 64) break;
      ownerStart--;
    }
    ownerStart++;
    if (ownerStart < cur && (ownerStart === 0 || !isWordChar(safeText.charCodeAt(ownerStart - 1)))) {
      let repo = safeText.slice(ownerStart, hashIdx);
      if (repo.endsWith('.git')) repo = repo.slice(0, -4);
      const slash = repo.indexOf('/'), owner = repo.slice(0, slash), name = repo.slice(slash + 1);
      if (!owner || !name || owner === '.' || owner === '..' || owner === '@' || owner.includes('..') || owner.indexOf('@', 1) !== -1 || name === '.' || name === '..' || name.includes('..')) return null;
      return { start: ownerStart, end: numEnd, issue: `${repo}#${safeText.slice(hashIdx + 1, numEnd)}` };
    }
  }

  if (hashIdx > 0 && isWordChar(safeText.charCodeAt(hashIdx - 1))) return null;
  return { start: hashIdx, end: numEnd, issue: safeText.slice(hashIdx, numEnd) };
}

function parseJiraTokenAt(safeText: string, dashIdx: number): IssueTokenHit | null {
  const len = safeText.length;
  if (dashIdx + 1 >= len || !isDigitChar(safeText.charCodeAt(dashIdx + 1))) return null;
  let numEnd = dashIdx + 2;
  while (numEnd < len && isDigitChar(safeText.charCodeAt(numEnd))) numEnd++;
  if (numEnd < len && isWordChar(safeText.charCodeAt(numEnd))) return null;

  let wordStart = dashIdx - 1;
  while (wordStart >= 0 && isWordChar(safeText.charCodeAt(wordStart))) wordStart--;
  wordStart++;
  if (dashIdx - wordStart < 2 || !isAlphaChar(safeText.charCodeAt(wordStart))) return null;
  if (wordStart > 0 && safeText.charCodeAt(wordStart - 1) === 47) return null;

  const prefix = safeText.slice(wordStart, dashIdx).toUpperCase();
  if (IGNORED_ISSUE_PREFIXES.has(prefix)) return null;
  return { start: wordStart, end: numEnd, issue: safeText.slice(wordStart, numEnd) };
}

function extractActionIssues(safeText: string, getMap: () => Map<string, string | null>): void {
  let hashIdx = safeText.indexOf('#');
  let dashIdx = safeText.indexOf('-');
  if (hashIdx === -1 && dashIdx === -1) return;

  let hits: IssueTokenHit[] | null = null;
  let hasBoth = false;
  while (hashIdx !== -1) {
    const hit = parseHashTokenAt(safeText, hashIdx);
    if (hit) {
      if (hits === null) hits = [hit];
      else hits.push(hit);
    }
    hashIdx = safeText.indexOf('#', hashIdx + 1);
  }
  const hashCount = hits !== null ? hits.length : 0;
  while (dashIdx !== -1) {
    const hit = parseJiraTokenAt(safeText, dashIdx);
    if (hit) {
      if (hits === null) hits = [hit];
      else hits.push(hit);
      if (hashCount > 0) hasBoth = true;
    }
    dashIdx = safeText.indexOf('-', dashIdx + 1);
  }
  if (hits === null) return;
  if (hasBoth) hits.sort((a, b) => a.start - b.start || b.end - a.end);

  let lastAction: string | null = null;
  let lastIndex = 0;
  for (const hit of hits) {
    if (hit.start < lastIndex) continue;
    const action = resolvePrecedingAction(safeText, lastIndex, hit.start, lastAction);
    lastAction = action;
    lastIndex = hit.end;
    recordIssueMatch(getMap(), hit.issue, action);
  }
}

function extractUrlIssueId(domain: string | undefined, fullPath: string | undefined): string | undefined {
  if (!fullPath) return undefined;
  let cleanEnd = fullPath.length;
  while (cleanEnd > 0 && fullPath.charCodeAt(cleanEnd - 1) === 47) cleanEnd--;
  const cleanPath = cleanEnd === fullPath.length ? fullPath : fullPath.slice(0, cleanEnd);
  if (!cleanPath) return undefined;
  const normalizedDomain = domain?.toLowerCase();
  if (normalizedDomain === 'github.com' || normalizedDomain === 'gitlab.com' || normalizedDomain === 'bitbucket.org') {
    const pathMatch = cleanPath.match(GIT_HOST_PATH_REGEX);
    if (!pathMatch) return undefined;
    let repo = pathMatch[1];
    if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
    return repo ? `${repo}#${pathMatch[2]}` : `#${pathMatch[2]}`;
  }
  if (normalizedDomain === 'atlassian.net') return cleanPath.match(ATLASSIAN_PATH_REGEX)?.[1];
  if (normalizedDomain === 'linear.app') return cleanPath.match(LINEAR_PATH_REGEX)?.[1];
  if (cleanPath.split('/').some((s) => !s || s === '.' || s === '..')) return undefined;
  if (normalizedDomain === 'slack.com' && cleanPath.startsWith('archives/')) return cleanPath;
  if (normalizedDomain === 'notion.so') return cleanPath;
  return undefined;
}

function extractUrlIssues(safeText: string, getMap: () => Map<string, string | null>): void {
  if (!safeText.includes('://')) return;
  URL_TOKEN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastAction: string | null = null;
  let lastIndex = 0;

  while ((m = URL_TOKEN_REGEX.exec(safeText)) !== null) {
    if (m.index === URL_TOKEN_REGEX.lastIndex) URL_TOKEN_REGEX.lastIndex++;
    if (m.index > 0 && isWordChar(safeText.charCodeAt(m.index - 1))) continue;
    const action = resolvePrecedingAction(safeText, lastIndex, m.index, lastAction);
    lastAction = action;
    lastIndex = URL_TOKEN_REGEX.lastIndex;
    const issueId = extractUrlIssueId(m[1], m[2]);
    if (issueId) recordIssueMatch(getMap(), issueId, action);
  }
}

function extractCustomPatternIssues(
  safeText: string,
  getMap: () => Map<string, string | null>,
  issuePattern: string,
): void {
  const customRegex = getCustomIssueRegex(issuePattern);
  if (!customRegex) return;
  customRegex.lastIndex = 0;
  let customMatch: RegExpExecArray | null;
  let lastAction: string | null = null;
  let lastIndex = 0;

  while ((customMatch = customRegex.exec(safeText)) !== null) {
    if (customMatch.index === customRegex.lastIndex) customRegex.lastIndex++;
    const matchedToken = customMatch[1] ?? '';
    const tokenStart = customMatch.index + (customMatch[0].length - matchedToken.length);
    const action = resolvePrecedingAction(safeText, lastIndex, tokenStart, lastAction);
    lastAction = action;
    lastIndex = customRegex.lastIndex;
    const matchedId = customMatch[2] || matchedToken;
    if (matchedId) recordIssueMatch(getMap(), matchedId, action);
  }
}

export function extractIssuesLazy(
  text: string,
  getMap: () => Map<string, string | null>,
  issuePattern?: string,
  includeBuiltins = true,
): void {
  if (!text) return;
  const safeText = text.length > MAX_ISSUE_TEXT_LENGTH ? text.slice(0, MAX_ISSUE_TEXT_LENGTH) : text;
  if (includeBuiltins) {
    extractActionIssues(safeText, getMap);
    extractUrlIssues(safeText, getMap);
  }
  if (issuePattern) extractCustomPatternIssues(safeText, getMap, issuePattern);
}

export const extractIssues = (
  text: string,
  issuesMap: Map<string, string | null>,
  issuePattern?: string,
  includeBuiltins = true,
): void => extractIssuesLazy(text, () => issuesMap, issuePattern, includeBuiltins);

export function iterateChangelog(
  versionMap: Map<string, Map<string, CommitEntry[]>>,
  callbacks: {
    onVersion: (version: string) => void;
    onCategory: (category: string) => void;
    onCommit: (commit: CommitEntry, entries: string[]) => void;
    onCategoryEnd?: (category: string) => void;
    onVersionEnd?: (version: string) => void;
  }
): void {
  for (const [version, categoryMap] of versionMap.entries()) {
    callbacks.onVersion(version);
    const sortedCategories = Array.from(categoryMap.keys()).sort();
    for (const cat of sortedCategories) {
      callbacks.onCategory(cat);
      const commits = categoryMap.get(cat);
      if (!commits) continue;
      for (const commit of commits) {
        const entries = commit.metadata?.entry && commit.metadata.entry.length > 0 ? commit.metadata.entry : [commit.cleanSubject || commit.subject];
        callbacks.onCommit(commit, entries);
      }
      callbacks.onCategoryEnd?.(cat);
    }
    callbacks.onVersionEnd?.(version);
  }
}
