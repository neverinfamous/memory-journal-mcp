// @ts-nocheck
export const isNoiseFile = (file: string) => {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|bun\.lockb|uv\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|go\.sum|CHANGELOG\.md|test-server\/tool-reference\.md|test-server\/code-map\.md|\.pnp\.[^/]+|\.eslintrc\.[^/]+|prettier\.config\.[^/]+|tsconfig(\.[^/]+)?\.json|jest\.config\.[^/]+|vite\.config\.[^/]+|\.gitignore|\.gitattributes|flake\.lock|deno\.lock|mix\.lock|Podfile\.lock|Cartfile\.resolved)$|(^|\/)\.?dist\/|(^|\/)\.?build\/|(^|\/)\.?coverage\/|(^|\/)\.yarn\/|(^|\/)vendor\/|(^|\/)__snapshots__\/|\.snap$|(^|\/)\.DS_Store|(^|\/)\.vercel\/|(^|\/)\.next\/|(^|\/)\.nuxt\/|(^|\/)\.husky\//i.test(file);
};

export const extractIssues = (text: string, issuesMap: Map<string, string | null>) => {
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
};
