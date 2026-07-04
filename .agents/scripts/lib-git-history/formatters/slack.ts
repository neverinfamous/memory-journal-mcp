import { z } from 'zod';
import { entrySchema } from '../schema.js';
import type { CliArgs } from '../cli.js';
import { getSlackMap, resolveIssueTrackerUrl, iterateChangelog } from '../parser-utils.js';

export function formatSlackIssueLink(issue: string, repoHost: string, repoPath: string, args: CliArgs): string {
  const link = resolveIssueTrackerUrl(issue, repoHost, repoPath, args);
  return link ? `<${link}|${issue}>` : issue;
}

export function buildSlackCommitLine(commit: z.infer<typeof entrySchema>, repoHost: string, repoPath: string, args: CliArgs, entries: string[]): string {
  const prefix = commit.isBreaking ? '*[BREAKING CHANGE]* ' : '';
  const sizeBadge = commit.size ? ` \`${commit.size}\`` : '';
  
  const map = getSlackMap(args);
  let resolvedAuthor = commit.author ? `*${commit.author}*` : '';
  if (commit.email && map[commit.email]) {
    resolvedAuthor = `<@${map[commit.email]}>`;
  } else if (commit.author && map[commit.author]) {
    resolvedAuthor = `<@${map[commit.author]}>`;
  }
  let authorStr = commit.author ? ` by ${resolvedAuthor}` : '';

  if (commit.coAuthors && commit.coAuthors.length > 0) {
    const co = commit.coAuthors.map((c: string) => {
      const name = c.split('<')[0].trim();
      const emailMatch = c.match(/<([^>]+)>/);
      const email = emailMatch ? emailMatch[1].trim() : '';
      if (email && map[email]) return `<@${map[email]}>`;
      if (name && map[name]) return `<@${map[name]}>`;
      return name;
    }).join(', ');
    authorStr += ` (with ${co})`;
  }
  const issues = commit.associatedIssues?.map((i: { issue: string; action: string | null }) => formatSlackIssueLink(i.issue, repoHost, repoPath, args)).join(', ') || '';
  const issueStr = issues ? ` (${issues})` : '';
  let md = '';
  for (const entryText of entries) {
    md += `• ${prefix}${entryText}${sizeBadge}${authorStr}${issueStr} (<https://${repoHost}/${repoPath}/commit/${commit.commit}|${commit.commit.substring(0, 7)}>)\n`;
    if (commit.breakingChangeDescription) {
      md += `  ◦ *Breaking Change Details:* ${commit.breakingChangeDescription.replace(/\n/g, '\n    ')}\n`;
    }
  }
  return md;
}

export function buildSlackChangelog(
  versionMap: Map<string, Map<string, z.infer<typeof entrySchema>[]>>,
  repoHost: string,
  repoPath: string,
  args: CliArgs
): string {
  const blocks: Record<string, unknown>[] = [];
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: 'Changelog',
      emoji: true
    }
  });

  let currentCategoryMd = '';

  iterateChangelog(versionMap, {
    onVersion: (version) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${version}*`
        }
      });
    },
    onCategory: (cat) => {
      currentCategoryMd = `*${cat}*\n\n`;
    },
    onCommit: (commit, entries) => {
      currentCategoryMd += buildSlackCommitLine(commit, repoHost, repoPath, args, entries);
    },
    onCategoryEnd: () => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: currentCategoryMd.trim()
        }
      });
    }
  });
  
  return JSON.stringify({ blocks }, null, 2) + '\n';
}
