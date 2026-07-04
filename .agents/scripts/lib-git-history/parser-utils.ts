import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import type { entrySchema } from './schema.js';
import type { CliArgs } from './cli.js';
import { match } from 'ts-pattern';
import { MAX_ISSUE_TEXT_LENGTH } from './constants.js';

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

let slackMapCache: Record<string, string> | null = null;
export function getSlackMap(args: CliArgs): Record<string, string> {
  if (slackMapCache !== null) return slackMapCache;
  if (!args['slack-map']) {
    slackMapCache = {};
    return slackMapCache;
  }
  try {
    slackMapCache = JSON.parse(readFileSync(args['slack-map'], 'utf-8'));
  } catch (err: unknown) {
    console.warn(`[lib-git-history] Warning: Failed to parse slack-map JSON: ${err}`);
    slackMapCache = {};
  }
  return slackMapCache || {};
}

export function resolveIssueTrackerUrl(issue: string, repoHost: string, repoPath: string, args: CliArgs): string | null {
  if (args['issue-tracker']) {
    let urlTemplate = args['issue-tracker'];
    
    if (urlTemplate.includes(',')) {
       const parts = urlTemplate.split(',');
       for (const p of parts) {
         const [prefix, tpl] = p.split('=', 2);
         if (tpl && issue.startsWith(prefix)) {
           urlTemplate = tpl;
           break;
         }
       }
    }
    
    const cleanIssue = issue.startsWith('#') ? issue.slice(1) : issue;
    return urlTemplate.replace(/\{id\}/g, cleanIssue).replace(/\{\}/g, issue);
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

export const extractIssues = (text: string, issuesMap: Map<string, string | null>, issuePattern?: string) => {
  if (!text) return;
  const safeText = text.length > MAX_ISSUE_TEXT_LENGTH ? text.slice(0, MAX_ISSUE_TEXT_LENGTH) : text;
  const actionRegex = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,10}(?:([@\w.-]+\/[\w.-]+)?#(\d+)|([A-Z][A-Z0-9_]+-\d+))\b/ig;
  let match;
  let lastAction: string | null = null;
  let lastIndex = 0;
  
  while ((match = actionRegex.exec(safeText)) !== null) {
    if (match.index === actionRegex.lastIndex) actionRegex.lastIndex++;
    const textBetween = safeText.slice(lastIndex, match.index);
    const isSimpleList = /^\s*(?:and|&|,|or|\()?\s*$/i.test(textBetween);
    if (!isSimpleList && (/[.;\n]/.test(textBetween) || textBetween.trim().split(/\s+/).length > 2)) {
      lastAction = null;
    }
    const action = match[1] ? match[1].toLowerCase() : lastAction;
    if (match[1]) lastAction = match[1].toLowerCase();
    lastIndex = actionRegex.lastIndex;
    
    let issue = '';
    if (match[3]) {
      let repo = match[2];
      const num = match[3];
      if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
      issue = repo ? `${repo}#${num}` : `#${num}`;
    } else if (match[4]) {
      const potentialIssue = match[4].toUpperCase();
      if (!/^(UTF|ISO|SHA|RFC|CVE|MAC|IP|IPV4|IPV6|X86|AMD64)-/.test(potentialIssue)) {
        if (safeText[match.index] === '/') continue;
        issue = match[4];
      }
    }
    if (issue) {
      if (!issuesMap.has(issue) || (action && !issuesMap.get(issue))) {
         issuesMap.set(issue, action);
      }
    }
  }
  
  const urlRegex = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,10}https?:\/\/(?:[a-zA-Z0-9.-]+\.)?(github\.com|gitlab\.com|bitbucket\.org|atlassian\.net|linear\.app|slack\.com|notion\.so)\/([A-Za-z0-9_./-]*[A-Za-z0-9_/-])/ig;
  lastAction = null;
  lastIndex = 0;
  while ((match = urlRegex.exec(safeText)) !== null) {
    if (match.index === urlRegex.lastIndex) urlRegex.lastIndex++;
    const textBetween = safeText.slice(lastIndex, match.index);
    const isSimpleList = /^\s*(?:and|&|,|or|\()?\s*$/i.test(textBetween);
    if (!isSimpleList && (/[.;\n]/.test(textBetween) || textBetween.trim().split(/\s+/).length > 2)) {
      lastAction = null;
    }
    const action = match[1] ? match[1].toLowerCase() : lastAction;
    if (match[1]) lastAction = match[1].toLowerCase();
    lastIndex = urlRegex.lastIndex;
    
    const domain = match[2];
    const fullPath = match[3];
    let issue: string | undefined;
    
    if (domain === 'github.com' || domain === 'gitlab.com' || domain === 'bitbucket.org') {
      const pathMatch = fullPath.match(/^(?:([\w.-]+\/[\w.-]+)\/)?(?:-\/)?(?:issues|pull|merge_requests|pull-requests)\/([A-Z0-9_.-]+)/i);
      if (pathMatch) {
        let repo = pathMatch[1];
        const num = pathMatch[2];
        if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
        issue = repo ? `${repo}#${num}` : `#${num}`;
      }
    } else if (domain === 'atlassian.net') {
      const pathMatch = fullPath.match(/browse\/([A-Z0-9_.-]+)/i);
      if (pathMatch) issue = pathMatch[1];
    } else if (domain === 'linear.app') {
      const pathMatch = fullPath.match(/issue\/([A-Z0-9_.-]+)/i);
      if (pathMatch) issue = pathMatch[1];
    } else if (domain === 'slack.com' && fullPath?.startsWith('archives/')) {
      issue = fullPath;
    } else if (domain === 'notion.so') {
      issue = fullPath;
    }
    
    if (issue && (!issuesMap.has(issue) || (action && !issuesMap.get(issue)))) {
      issuesMap.set(issue, action);
    }
  }
  
  if (issuePattern) {
    try {
      const customRegex = new RegExp(`(?:^|[^\\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\\s:-]{0,10}(?:${issuePattern})\\b`, 'ig');
      let customMatch;
      let lastAction: string | null = null;
      let lastIndex = 0;
      
      while ((customMatch = customRegex.exec(safeText)) !== null) {
        if (customMatch.index === customRegex.lastIndex) customRegex.lastIndex++;
        
        const textBetween = safeText.slice(lastIndex, customMatch.index);
        const isSimpleList = /^\s*(?:and|&|,|or|\()?\s*$/i.test(textBetween);
        if (!isSimpleList && (/[.;\n]/.test(textBetween) || textBetween.trim().split(/\s+/).length > 2)) {
          lastAction = null;
        }
        const action = customMatch[1] ? customMatch[1].toLowerCase() : lastAction;
        if (customMatch[1]) lastAction = customMatch[1].toLowerCase();
        lastIndex = customRegex.lastIndex;
        
        let potentialIssue = customMatch[2];
        if (!potentialIssue) {
          const fullMatch = customMatch[0];
          const actionPart = customMatch[1] ? fullMatch.slice(0, fullMatch.indexOf(customMatch[1]) + customMatch[1].length) : '';
          potentialIssue = fullMatch.slice(actionPart.length).replace(/^[\s:-]+/, '');
        }
        
        if (potentialIssue && (!issuesMap.has(potentialIssue) || (action && !issuesMap.get(potentialIssue)))) {
          issuesMap.set(potentialIssue, action);
        }
      }
    } catch {
      // Ignore invalid regex
    }
  }
};

export const getLanguage = (file: string): string | undefined => {
  const parts = file.split('.');
  if (parts.length < 2 && !file.includes('.')) return undefined;
  const ext = parts.pop()?.toLowerCase() ?? '';
  return match(ext)
    .with('ts', 'tsx', 'mts', 'cts', () => 'TypeScript')
    .with('js', 'jsx', 'mjs', 'cjs', () => 'JavaScript')
    .with('py', () => 'Python')
    .with('go', () => 'Go')
    .with('rs', () => 'Rust')
    .with('md', () => 'Markdown')
    .with('json', 'jsonc', () => 'JSON')
    .with('yml', 'yaml', () => 'YAML')
    .with('css', () => 'CSS')
    .with('scss', 'sass', () => 'Sass')
    .with('html', 'htm', () => 'HTML')
    .with('sh', 'bash', 'zsh', () => 'Shell')
    .with('rb', () => 'Ruby')
    .with('java', () => 'Java')
    .with('c', () => 'C')
    .with('h', 'cpp', 'hpp', 'cc', () => 'C++')
    .with('cs', () => 'C#')
    .with('php', () => 'PHP')
    .with('sql', () => 'SQL')
    .with('vue', () => 'Vue')
    .with('svelte', () => 'Svelte')
    .with('toml', () => 'TOML')
    .with('xml', () => 'XML')
    .with('swift', () => 'Swift')
    .with('kt', 'kts', () => 'Kotlin')
    .with('dart', () => 'Dart')
    .with('ex', 'exs', () => 'Elixir')
    .otherwise(() => undefined);
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
      const commits = categoryMap.get(cat)!;
      for (const commit of commits) {
        const entries = commit.metadata?.entry && commit.metadata.entry.length > 0 ? commit.metadata.entry : [commit.cleanSubject || commit.subject];
        callbacks.onCommit(commit, entries);
      }
      callbacks.onCategoryEnd?.(cat);
    }
    callbacks.onVersionEnd?.(version);
  }
}
