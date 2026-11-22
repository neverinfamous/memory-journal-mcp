// @ts-nocheck
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { entrySchema } from './schema.js';
import type { CliArgs } from './cli.js';
import { MAX_ISSUE_TEXT_LENGTH } from './constants.js';

const slackMapSchema = z.record(z.string(), z.string());
const EMPTY_SLACK_MAP: Record<string, string> = Object.create(null) as Record<string, string>;

export function flattenString(str: string): string {
  return (' ' + str).slice(1);
}

export function extractShaFromBuffer(recordBuf: Buffer): { sha: string; shaEnd: number } {
  let shaEnd = recordBuf.indexOf(0x0A);
  const nullIdx = recordBuf.indexOf(0x00);
  if (shaEnd === -1 || (nullIdx !== -1 && nullIdx < shaEnd)) shaEnd = nullIdx;
  if (shaEnd === -1) shaEnd = recordBuf.length;
  return { sha: recordBuf.toString('utf-8', 0, shaEnd).trim(), shaEnd };
}

export function truncateSafely(str: string, maxLength: number, truncateMsg: string): string {
  if (str.length <= maxLength) return str;
  let safeLen = maxLength;
  while (safeLen > 0 && str.charCodeAt(safeLen - 1) >= 0xD800 && str.charCodeAt(safeLen - 1) <= 0xDBFF) {
    safeLen--;
  }
  return str.slice(0, safeLen) + truncateMsg;
}

const SLACK_MAP_CACHE = new Map<string, Record<string, string>>();
const MAX_SLACK_MAP_CACHE = 16;

export function getSlackMap(args: CliArgs, cwd: string = process.cwd()): Record<string, string> {
  const rawPath = args['slack-map'];
  if (!rawPath) return EMPTY_SLACK_MAP;
  const resolvedPath = path.resolve(cwd, rawPath);
  const cached = SLACK_MAP_CACHE.get(resolvedPath);
  if (cached !== undefined) return cached;

  const safeMap: Record<string, string> = Object.create(null) as Record<string, string>;
  try {
    const raw: unknown = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
    const parsed = slackMapSchema.safeParse(raw);
    if (parsed.success) {
      for (const [k, v] of Object.entries(parsed.data)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        safeMap[k] = v;
      }
    } else {
      console.warn(`[lib-git-history] Warning: Invalid slack-map JSON shape at ${resolvedPath}`);
    }
  } catch (err: unknown) {
    console.warn(`[lib-git-history] Warning: Failed to parse slack-map JSON: ${err}`);
  }
  if (SLACK_MAP_CACHE.size >= MAX_SLACK_MAP_CACHE) SLACK_MAP_CACHE.clear();
  SLACK_MAP_CACHE.set(resolvedPath, safeMap);
  return safeMap;
}

export function expandIssueTrackerUrl(issue: string, tracker: string): string {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return issue;
  let urlTemplate = tracker;

  if (urlTemplate.includes(',')) {
    const parts = urlTemplate.split(',');
    for (const p of parts) {
      const eqIdx = p.indexOf('=');
      if (eqIdx !== -1) {
        const prefix = p.slice(0, eqIdx).trim();
        const tpl = p.slice(eqIdx + 1).trim();
        if (tpl && issue.startsWith(prefix)) {
          urlTemplate = tpl;
          break;
        }
      }
    }
  }

  const cleanIssue = issue.startsWith('#') ? issue.slice(1) : issue;
  if (urlTemplate.includes('{id}') || urlTemplate.includes('{}')) {
    return urlTemplate.replace(/\{id\}/g, cleanIssue).replace(/\{\}/g, issue);
  }
  if (issue.startsWith('#')) {
    return urlTemplate + cleanIssue;
  }
  return urlTemplate.endsWith('/') ? urlTemplate + issue : urlTemplate + '/' + issue;
}

export function resolveIssueTrackerUrl(issue: string, repoHost: string, repoPath: string, args: CliArgs): string | null {
  if (issue.startsWith('http://') || issue.startsWith('https://')) return issue;
  if (args['issue-tracker']) {
    return expandIssueTrackerUrl(issue, args['issue-tracker']);
  }

  if (issue.startsWith('#')) {
    const num = issue.slice(1);
    if (repoHost === 'gitlab.com') return `https://gitlab.com/${repoPath}/-/issues/${num}`;
    return `https://${repoHost}/${repoPath}/issues/${num}`;
  }
  if (issue.includes('#')) {
    const [repo, num] = issue.split('#');
    return `https://github.com/${repo}/issues/${num}`;
  }
  return null;
}

const NOISE_FILE_PATTERNS = [
  '(^|\\/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|bun\\.lock|bun\\.lockb|uv\\.lock|Cargo\\.lock|Gemfile\\.lock|poetry\\.lock|go\\.sum|CHANGELOG\\.md|test-server\\/tool-reference\\.md|test-server\\/code-map\\.md|\\.pnp\\.[^/]+|\\.eslintrc\\.[^/]+|prettier\\.config\\.[^/]+|tsconfig(\\.[^/]+)?\\.json|jest\\.config\\.[^/]+|vite\\.config\\.[^/]+|\\.gitignore|\\.gitattributes|flake\\.lock|deno\\.lock|mix\\.lock|Podfile\\.lock|Cartfile\\.resolved)$',
  '(^|\\/)\\.?dist\\/',
  '(^|\\/)\\.?build\\/',
  '(^|\\/)\\.?coverage\\/',
  '(^|\\/)\\.yarn\\/',
  '(^|\\/)vendor\\/',
  '(^|\\/)__snapshots__\\/',
  '\\.snap$',
  '(^|\\/)\\.DS_Store',
  '(^|\\/)\\.vercel\\/',
  '(^|\\/)\\.next\\/',
  '(^|\\/)\\.nuxt\\/',
  '(^|\\/)\\.husky\\/'
];
const NOISE_FILE_REGEX = new RegExp(NOISE_FILE_PATTERNS.join('|'), 'i');

export const isNoiseFile = (file: string) => NOISE_FILE_REGEX.test(file);

const ACTION_REGEX = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,10}(?:([@\w.-]+\/[\w.-]+)?#(\d+)|([A-Z][A-Z0-9_]+-\d+))\b/ig;
const URL_REGEX = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,10}https?:\/\/(?:[a-zA-Z0-9.-]+\.)?(github\.com|gitlab\.com|bitbucket\.org|atlassian\.net|linear\.app|slack\.com|notion\.so)\/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])/ig;
const SIMPLE_LIST_REGEX = /^\s*(?:and|&|,|or|\()?\s*$/i;
const SENTENCE_BREAK_REGEX = /[.;\n]/;
const WHITESPACE_SPLIT_REGEX = /\s+/;
const IGNORED_ISSUE_PREFIX_REGEX = /^(UTF|ISO|SHA|RFC|CVE|MAC|IP|IPV4|IPV6|X86|AMD64)-/;
const GIT_HOST_PATH_REGEX = /^(?:([\w.-]+\/[\w.-]+)\/)?(?:-\/)?(?:issues|pull|merge_requests|pull-requests)\/([A-Z0-9_.-]+)/i;
const ATLASSIAN_PATH_REGEX = /browse\/([A-Z0-9_.-]+)/i;
const LINEAR_PATH_REGEX = /issue\/([A-Z0-9_.-]+)/i;

const CUSTOM_ISSUE_REGEX_CACHE = new Map<string, RegExp | null>();
const MAX_CUSTOM_REGEX_CACHE = 32;
const MAX_CUSTOM_ISSUE_PATTERN_LENGTH = 500;

function getCustomIssueRegex(issuePattern: string): RegExp | null {
  const cached = CUSTOM_ISSUE_REGEX_CACHE.get(issuePattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  if (issuePattern.length > MAX_CUSTOM_ISSUE_PATTERN_LENGTH) {
    console.warn(`[lib-git-history] Warning: issue-pattern exceeds max length (${MAX_CUSTOM_ISSUE_PATTERN_LENGTH} chars); ignoring.`);
  } else {
    try {
      compiled = new RegExp(`(?:^|[^\\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\\s:-]{0,10}(?:${issuePattern})\\b`, 'ig');
    } catch (err: unknown) {
      console.warn(`[lib-git-history] Warning: Invalid issue-pattern regex '${issuePattern}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (CUSTOM_ISSUE_REGEX_CACHE.size >= MAX_CUSTOM_REGEX_CACHE) {
    CUSTOM_ISSUE_REGEX_CACHE.clear();
  }
  CUSTOM_ISSUE_REGEX_CACHE.set(issuePattern, compiled);
  return compiled;
}

function resolveMatchAction(
  safeText: string,
  matchIndex: number,
  capturedAction: string | undefined,
  lastAction: string | null,
  lastIndex: number,
): string | null {
  const textBetween = safeText.slice(lastIndex, matchIndex);
  const isSimpleList = SIMPLE_LIST_REGEX.test(textBetween);
  let effectiveLast = lastAction;
  if (!isSimpleList && (SENTENCE_BREAK_REGEX.test(textBetween) || textBetween.trim().split(WHITESPACE_SPLIT_REGEX).length > 2)) {
    effectiveLast = null;
  }
  return capturedAction ? capturedAction.toLowerCase() : effectiveLast;
}

function recordIssueMatch(issuesMap: Map<string, string | null>, issue: string | undefined, action: string | null): void {
  if (issue && (!issuesMap.has(issue) || (action && !issuesMap.get(issue)))) {
    issuesMap.set(issue, action);
  }
}

function extractActionIssues(safeText: string, issuesMap: Map<string, string | null>): void {
  if (!safeText.includes('#') && !safeText.includes('-')) return;
  ACTION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastAction: string | null = null;
  let lastIndex = 0;

  while ((m = ACTION_REGEX.exec(safeText)) !== null) {
    if (m.index === ACTION_REGEX.lastIndex) ACTION_REGEX.lastIndex++;
    const action = resolveMatchAction(safeText, m.index, m[1], lastAction, lastIndex);
    lastAction = m[1] ? m[1].toLowerCase() : action;
    lastIndex = ACTION_REGEX.lastIndex;

    let issue = '';
    if (m[3]) {
      let repo = m[2];
      if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
      issue = repo ? `${repo}#${m[3]}` : `#${m[3]}`;
    } else if (m[4]) {
      if (!IGNORED_ISSUE_PREFIX_REGEX.test(m[4].toUpperCase()) && safeText[m.index] !== '/') {
        issue = m[4];
      }
    }
    recordIssueMatch(issuesMap, issue, action);
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

function extractUrlIssues(safeText: string, issuesMap: Map<string, string | null>): void {
  if (!safeText.includes('http://') && !safeText.includes('https://') && !safeText.includes('HTTP://') && !safeText.includes('HTTPS://')) {
    return;
  }
  URL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastAction: string | null = null;
  let lastIndex = 0;

  while ((m = URL_REGEX.exec(safeText)) !== null) {
    if (m.index === URL_REGEX.lastIndex) URL_REGEX.lastIndex++;
    const action = resolveMatchAction(safeText, m.index, m[1], lastAction, lastIndex);
    lastAction = m[1] ? m[1].toLowerCase() : action;
    lastIndex = URL_REGEX.lastIndex;
    recordIssueMatch(issuesMap, extractUrlIssueId(m[2], m[3]), action);
  }
}

function extractCustomPatternIssues(safeText: string, issuesMap: Map<string, string | null>, issuePattern: string): void {
  const customRegex = getCustomIssueRegex(issuePattern);
  if (!customRegex) return;
  customRegex.lastIndex = 0;
  let customMatch: RegExpExecArray | null;
  let lastAction: string | null = null;
  let lastIndex = 0;

  while ((customMatch = customRegex.exec(safeText)) !== null) {
    if (customMatch.index === customRegex.lastIndex) customRegex.lastIndex++;
    const action = resolveMatchAction(safeText, customMatch.index, customMatch[1], lastAction, lastIndex);
    lastAction = customMatch[1] ? customMatch[1].toLowerCase() : action;
    lastIndex = customRegex.lastIndex;

    let potentialIssue = customMatch[2];
    if (!potentialIssue) {
      const fullMatch = customMatch[0];
      const actionPart = customMatch[1] ? fullMatch.slice(0, fullMatch.indexOf(customMatch[1]) + customMatch[1].length) : '';
      potentialIssue = fullMatch.slice(actionPart.length).replace(/^[\s:-]+/, '');
    }
    recordIssueMatch(issuesMap, potentialIssue, action);
  }
}

export const extractIssues = (text: string, issuesMap: Map<string, string | null>, issuePattern?: string) => {
  if (!text) return;
  const safeText = text.length > MAX_ISSUE_TEXT_LENGTH ? text.slice(0, MAX_ISSUE_TEXT_LENGTH) : text;
  extractActionIssues(safeText, issuesMap);
  extractUrlIssues(safeText, issuesMap);
  if (issuePattern) extractCustomPatternIssues(safeText, issuesMap, issuePattern);
};

const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  md: 'Markdown',
  json: 'JSON',
  jsonc: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  css: 'CSS',
  scss: 'Sass',
  sass: 'Sass',
  html: 'HTML',
  htm: 'HTML',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  rb: 'Ruby',
  java: 'Java',
  c: 'C',
  h: 'C++',
  cpp: 'C++',
  hpp: 'C++',
  cc: 'C++',
  cs: 'C#',
  php: 'PHP',
  sql: 'SQL',
  vue: 'Vue',
  svelte: 'Svelte',
  toml: 'TOML',
  xml: 'XML',
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
};

export const getLanguage = (file: string): string | undefined => {
  const baseStart = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1;
  const dotIdx = file.lastIndexOf('.');
  if (dotIdx <= baseStart) return undefined;
  const ext = file.slice(dotIdx + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXT_TO_LANGUAGE, ext) ? EXT_TO_LANGUAGE[ext] : undefined;
};

export function iterateChangelog(
  versionMap: Map<string, Map<string, z.infer<typeof entrySchema>[]>>,
  callbacks: {
    onVersion: (version: string) => void;
    onCategory: (category: string) => void;
    onCommit: (commit: z.infer<typeof entrySchema>, entries: string[]) => void;
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
