import { z } from 'zod';
import { entrySchema } from '../schema.js';
import type { CliArgs } from '../cli.js';

import { resolveIssueTrackerUrl, iterateChangelog } from '../parser-utils.js';

export function formatIssueLink(issue: string, repoHost: string, repoPath: string, args: CliArgs): string {
  const link = resolveIssueTrackerUrl(issue, repoHost, repoPath, args);
  return link ? `[${issue}](${link})` : issue;
}

export function buildCommitLine(commit: z.infer<typeof entrySchema>, repoHost: string, repoPath: string, args: CliArgs, entries: string[]): string {
  const prefix = commit.isBreaking ? '**[BREAKING CHANGE]** ' : '';
  const sizeBadge = commit.size ? ` \`${commit.size}\`` : '';
  let authorStr = commit.author ? ` by **${commit.author}**` : '';
  if (commit.coAuthors && commit.coAuthors.length > 0) {
    const co = commit.coAuthors.map((c: string) => c.split('<')[0].trim()).join(', ');
    authorStr += ` (with ${co})`;
  }
  const issues = commit.associatedIssues?.map((i: { issue: string; action: string | null }) => formatIssueLink(i.issue, repoHost, repoPath, args)).join(', ') || '';
  const issueStr = issues ? ` (${issues})` : '';
  let md = '';
  for (const entryText of entries) {
    md += `- ${prefix}${entryText}${sizeBadge}${authorStr}${issueStr} ([${commit.commit.substring(0, 7)}](https://${repoHost}/${repoPath}/commit/${commit.commit}))\n`;
    if (commit.breakingChangeDescription) {
      md += `  - **Breaking Change Details:** ${commit.breakingChangeDescription.replace(/\n/g, '\n    ')}\n`;
    }
  }
  return md;
}

export function buildMarkdownChangelog(
  versionMap: Map<string, Map<string, z.infer<typeof entrySchema>[]>>,
  repoHost: string,
  repoPath: string,
  args: CliArgs
): string {
  let md = '# Changelog\n\n';
  iterateChangelog(versionMap, {
    onVersion: (version) => { md += `## ${version}\n\n`; },
    onCategory: (cat) => { md += `### ${cat}\n\n`; },
    onCommit: (commit, entries) => {
      md += buildCommitLine(commit, repoHost, repoPath, args, entries);
    },
    onCategoryEnd: () => { md += '\n'; }
  });
  return md.trim() + '\n';
}
