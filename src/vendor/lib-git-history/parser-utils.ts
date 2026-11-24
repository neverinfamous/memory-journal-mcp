// @ts-nocheck
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CommitEntry } from './schema.js';
import type { CliArgs } from './cli.js';
import { MAX_ISSUE_TEXT_LENGTH, flattenString, truncateSafely, getLanguage } from './constants.js';

export { flattenString, truncateSafely, getLanguage };

const EMPTY_SLACK_MAP: Record<string, string> = Object.create(null) as Record<string, string>;

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

export function getSlackMap(args: CliArgs, cwd: string = process.cwd()): Record<string, string> {
  const rawPath = args['slack-map'];
  if (!rawPath) return EMPTY_SLACK_MAP;
  const resolvedPath = path.resolve(cwd, rawPath);
  const cached = SLACK_MAP_CACHE.get(resolvedPath);
  if (cached !== undefined) return cached;

  let resultMap: Record<string, string> = Object.create(null) as Record<string, string>;
  try {
    const raw: unknown = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const candidate: Record<string, string> = Object.create(null) as Record<string, string>;
      let valid = true;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== 'string') { valid = false; break; }
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        candidate[k] = v;
      }
      if (valid) resultMap = candidate;
      else console.warn(`[lib-git-history] Warning: Invalid slack-map JSON shape at ${resolvedPath}`);
    } else {
      console.warn(`[lib-git-history] Warning: Invalid slack-map JSON shape at ${resolvedPath}`);
    }
  } catch (err: unknown) {
    console.warn(`[lib-git-history] Warning: Failed to parse slack-map JSON: ${err}`);
  }
  if (SLACK_MAP_CACHE.size >= MAX_SLACK_MAP_CACHE) SLACK_MAP_CACHE.clear();
  SLACK_MAP_CACHE.set(resolvedPath, resultMap);
  return resultMap;
}

export function hasOwnKeys(obj: Record<string, unknown>): boolean {
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
  }
  return false;
}

const TRACKER_RULES_CACHE = new Map<string, Array<readonly [string, string]>>();
const MAX_TRACKER_RULES_CACHE = 32;
const PLACEHOLDER_ID_RE = /\{id\}/g;
const PLACEHOLDER_EMPTY_RE = /\{\}/g;

function getParsedTrackerRules(tracker: string): Array<readonly [string, string]> {
  const cached = TRACKER_RULES_CACHE.get(tracker);
  if (cached !== undefined) return cached;
  const rules: Array<readonly [string, string]> = [];
  for (const p of tracker.split(',')) {
    const eqIdx = p.indexOf('=');
    if (eqIdx !== -1) {
      const prefix = p.slice(0, eqIdx).trim();
      const tpl = p.slice(eqIdx + 1).trim();
      if (tpl) rules.push([prefix, tpl] as const);
    }
  }
  if (TRACKER_RULES_CACHE.size >= MAX_TRACKER_RULES_CACHE) TRACKER_RULES_CACHE.clear();
  TRACKER_RULES_CACHE.set(tracker, rules);
  return rules;
}

export function expandIssueTrackerUrl(issue: string, tracker: string): string {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return issue;
  let urlTemplate = tracker;

  if (urlTemplate.includes(',')) {
    let matched = false;
    for (const [prefix, tpl] of getParsedTrackerRules(urlTemplate)) {
      if (issue.startsWith(prefix)) {
        urlTemplate = tpl;
        matched = true;
        break;
      }
    }
    if (!matched) return issue;
  }

  const cleanIssue = issue.startsWith('#') ? issue.slice(1) : issue;
  if (urlTemplate.includes('{id}') || urlTemplate.includes('{}')) {
    return urlTemplate.replace(PLACEHOLDER_ID_RE, cleanIssue).replace(PLACEHOLDER_EMPTY_RE, issue);
  }
  if (issue.startsWith('#')) {
    return urlTemplate + cleanIssue;
  }
  return urlTemplate.endsWith('/') ? urlTemplate + issue : urlTemplate + '/' + issue;
}

export function resolveIssueTrackerUrl(issue: string, repoHost: string, repoPath: string, args: CliArgs): string | null {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return issue;
  if (args['issue-tracker']) {
    const expanded = expandIssueTrackerUrl(issue, args['issue-tracker']);
    if (expanded !== issue) return expanded;
  }

  if (issue.startsWith('#')) {
    const num = issue.slice(1);
    if (repoHost === 'gitlab.com') return `https://gitlab.com/${repoPath}/-/issues/${num}`;
    return `https://${repoHost}/${repoPath}/issues/${num}`;
  }
  if (issue.includes('#')) {
    const hashIdx = issue.indexOf('#');
    return `https://github.com/${issue.slice(0, hashIdx)}/issues/${issue.slice(hashIdx + 1)}`;
  }
  return null;
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
  if (issuePattern.length > MAX_CUSTOM_ISSUE_PATTERN_LENGTH) {
    console.warn(`[lib-git-history] Warning: issue-pattern exceeds max length (${MAX_CUSTOM_ISSUE_PATTERN_LENGTH} chars); ignoring.`);
  } else {
    try { compiled = new RegExp(`(?:^|[^\\w])(${issuePattern})\\b`, 'ig'); }
    catch (err: unknown) { console.warn(`[lib-git-history] Warning: Invalid issue-pattern regex '${issuePattern}': ${err instanceof Error ? err.message : String(err)}`); }
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
  const flatIssue = flattenString(issue);
  if (!issuesMap.has(flatIssue) || (action && !issuesMap.get(flatIssue))) {
    issuesMap.set(flatIssue, action);
  }
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
  const normalizedDomain = domain?.toLowerCase();
  if (normalizedDomain === 'github.com' || normalizedDomain === 'gitlab.com' || normalizedDomain === 'bitbucket.org') {
    const pathMatch = fullPath.match(GIT_HOST_PATH_REGEX);
    if (!pathMatch) return undefined;
    let repo = pathMatch[1];
    if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
    return repo ? `${repo}#${pathMatch[2]}` : `#${pathMatch[2]}`;
  }
  if (normalizedDomain === 'atlassian.net') return fullPath.match(ATLASSIAN_PATH_REGEX)?.[1];
  if (normalizedDomain === 'linear.app') return fullPath.match(LINEAR_PATH_REGEX)?.[1];
  if (normalizedDomain === 'slack.com' && fullPath.startsWith('archives/')) return fullPath;
  if (normalizedDomain === 'notion.so') return fullPath;
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
) => extractIssuesLazy(text, () => issuesMap, issuePattern, includeBuiltins);

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
