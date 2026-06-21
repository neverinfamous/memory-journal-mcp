// @ts-nocheck
export const isNoiseFile = (file: string) => {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb|uv\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|go\.sum|CHANGELOG\.md|test-server\/tool-reference\.md|test-server\/code-map\.md|\.pnp\.[^/]+|\.eslintrc\.[^/]+|prettier\.config\.[^/]+|tsconfig(\.[^/]+)?\.json|jest\.config\.[^/]+|vite\.config\.[^/]+|\.gitignore|\.gitattributes|flake\.lock|deno\.lock|mix\.lock|Podfile\.lock|Cartfile\.resolved)$|(^|\/)\.?dist\/|(^|\/)\.?build\/|(^|\/)\.?coverage\/|(^|\/)\.yarn\/|(^|\/)vendor\/|(^|\/)__snapshots__\/|\.snap$|(^|\/)\.DS_Store|(^|\/)\.vercel\/|(^|\/)\.next\/|(^|\/)\.nuxt\/|(^|\/)\.husky\//i.test(file);
};

export const extractIssues = (text: string, issuesMap: Map<string, string | null>, issuePattern?: string) => {
  if (!text) return;
  const safeText = text.length > 50000 ? text.slice(0, 50000) : text;
  const actionRegex = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,50}(?:([@\w.-]+\/[\w.-]+)?#(\d+)|([A-Z][A-Z0-9_]+-\d+))\b/ig;
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
  
  const urlRegex = /(?:^|[^\w])(fixes|fix|closes|close|resolves|resolve|addresses|address|implements|related to|see also)?[\s:-]{0,50}https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/([\w.-]+\/[\w.-]+)\/(?:issues|pull|merge_requests|pull-requests)\/(\d+)\b/ig;
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
    
    let repo = match[2];
    const num = match[3];
    if (repo && repo.endsWith('.git')) repo = repo.slice(0, -4);
    const issue = `${repo}#${num}`;
    if (!issuesMap.has(issue) || (action && !issuesMap.get(issue))) {
      issuesMap.set(issue, action);
    }
  }
  
  if (issuePattern) {
    try {
      const customRegex = new RegExp(issuePattern, 'g');
      let customMatch;
      while ((customMatch = customRegex.exec(safeText)) !== null) {
        if (customMatch.index === customRegex.lastIndex) customRegex.lastIndex++;
        const potentialIssue = customMatch[0];
        if (!issuesMap.has(potentialIssue)) {
          issuesMap.set(potentialIssue, null);
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
  const ext = parts.pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': case 'mts': case 'cts': return 'TypeScript';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'JavaScript';
    case 'py': return 'Python';
    case 'go': return 'Go';
    case 'rs': return 'Rust';
    case 'md': return 'Markdown';
    case 'json': case 'jsonc': return 'JSON';
    case 'yml': case 'yaml': return 'YAML';
    case 'css': return 'CSS';
    case 'scss': case 'sass': return 'Sass';
    case 'html': case 'htm': return 'HTML';
    case 'sh': case 'bash': case 'zsh': return 'Shell';
    case 'rb': return 'Ruby';
    case 'java': return 'Java';
    case 'c': return 'C';
    case 'h': case 'cpp': case 'hpp': case 'cc': return 'C++';
    case 'cs': return 'C#';
    case 'php': return 'PHP';
    case 'sql': return 'SQL';
    case 'vue': return 'Vue';
    case 'svelte': return 'Svelte';
    case 'toml': return 'TOML';
    case 'xml': return 'XML';
    case 'swift': return 'Swift';
    case 'kt': case 'kts': return 'Kotlin';
    case 'dart': return 'Dart';
    case 'ex': case 'exs': return 'Elixir';
    default: return undefined;
  }
};
