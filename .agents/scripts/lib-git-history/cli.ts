import { parseArgs } from 'node:util';
import pc from 'picocolors';

import { cliArgsSchema, type CliArgs } from './schema.js';

export type { CliArgs };

export function parseArguments(): CliArgs {
  const options = {
    limit: { type: 'string', short: 'n' },
    path: { type: 'string', short: 'p' },
    author: { type: 'string', short: 'a' },
    search: { type: 'string', short: 's' },
    grep: { type: 'string', short: 'g' },
    range: { type: 'string', short: 'r' },
    since: { type: 'string' },
    until: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
    'first-parent': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    'include-merges': { type: 'boolean' },
    'include-patch': { type: 'boolean' },
    'diff-context': { type: 'string', short: 'U' },
    'max-body-length': { type: 'string' },
    'max-patch-length': { type: 'string' },
    category: { type: 'string', short: 'c' },
    type: { type: 'string', short: 't' },
    breaking: { type: 'boolean', short: 'b' },
    impact: { type: 'string' },
    confidence: { type: 'string' },
    jsonl: { type: 'boolean' },
    'changelog-only': { type: 'boolean' },
    format: { type: 'string', short: 'f' },
    summary: { type: 'boolean' },
    stats: { type: 'boolean' },
    all: { type: 'boolean' },
    'patch-search': { type: 'string', short: 'G' },
    'diff-filter': { type: 'string' },
    reverse: { type: 'boolean' },
    'no-body': { type: 'boolean' },
    'issue-tracker': { type: 'string' },
    'issue-pattern': { type: 'string' },
    cache: { type: 'boolean' },
    mailmap: { type: 'string' },
    'slack-map': { type: 'string' },
    'package-version': { type: 'boolean' },
    'stream-to-file': { type: 'string' },
  } as const;

  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options, strict: true });
    
    // Map before/after aliases
    if (values.before && !values.until) values.until = values.before;
    if (values.after && !values.since) values.since = values.after;
    
    // Remove aliases to ensure a single source of truth in the returned object
    delete values.before;
    delete values.after;
    
    return cliArgsSchema.parse(values);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    showHelpAndExit(1);
  }
}

export function showHelpAndExit(exitCode: number = 0): never {
  const logFn = exitCode === 0 ? console.log : console.error;
  logFn(`\
Usage: ${pc.bold('bun get-git-history-json.ts [options]')}

Extracts, parses, and formats git history into a deterministic JSON shape,
acting as the Single Source of Truth (SSoT) for repository history.

${pc.bold('Agent Directives:')}
  ${pc.red('NEVER use `git log`, `git shortlog`, or `git show`.')}
  This tool is the required mechanism for all history exploration.

${pc.bold('Filtering Options:')}
  -n, --limit <n>          Maximum number of commits to process (defaults to 100 if no range/limit provided)
  -r, --range <range>      Git commit range (e.g., HEAD~5..HEAD, tags/v1.0.0..tags/v1.1.0)
  --since, --after <date>  Show commits more recent than a specific date
  --until, --before <date> Show commits older than a specific date
  -a, --author <name>      Filter commits by author name/email
  -p, --path <path>        Filter commits modifying a specific path/file

${pc.bold('Semantic Filtering Options:')}
  -c, --category <cat>     Filter by conventional commit category (e.g., feat, fix)
  -t, --type <type>        Filter by explicit conventional type
  -b, --breaking           Filter to only include breaking changes
  --impact <impact>        Filter by minimum impact score (e.g., ">=0.5", "0.8")
  --confidence <conf>      Filter by minimum confidence score (e.g., ">=0.5", "0.8")
  --changelog-only         Only include commits suitable for a changelog

${pc.bold('Search Options:')}
  -s, --search <query>     Search within commit messages
  -g, --grep <query>       Regex search within commit messages
  -G, --patch-search <q>   Search within the actual patch diffs (git log -G)

${pc.bold('Content & Formatting Options:')}
  -f, --format <fmt>       Output format: json (default), markdown, slack, or custom script path
  --summary                Output summary metadata only (omits bodies, files, patches)
  --stats                  Output summary metadata plus file stats (omits bodies, patches)
  --no-body                Omit commit bodies from output
  --include-patch          Include full patch diff strings in output
  --jsonl                  Output as JSON Lines format
  -U, --diff-context <n>   Lines of context for diffs (default: 3)
  --max-body-length <n>    Truncate commit bodies over this length
  --max-patch-length <n>   Truncate patches over this length

${pc.bold('Git Behavior Options:')}
  --first-parent           Follow only the first parent commit upon seeing a merge
  --include-merges         Include merge commits in the history
  --all                    Include all commits (removes the default implicit limit of 100)
  --reverse                Output commits in reverse chronological order
  --diff-filter <filter>   Filter by diff type (e.g., 'A' for Added, 'M' for Modified)

${pc.bold('Integration Options:')}
  --issue-tracker <url>    URL prefix to attach to detected issue numbers
  --issue-pattern <regex>  Regex to identify issue patterns
  --mailmap <file>         Use a specific mailmap file for author normalization
  --slack-map <file>       Path to JSON map translating authors to Slack IDs
  --package-version        Include the package.json version in the output metadata
  --stream-to-file <file>  Stream JSON output directly to a file instead of stdout
  --cache                  Enable local SQLite caching of processed commits
  -h, --help               Show this help message

${pc.bold('Usage Examples:')}

  1. Get the latest commit summary as JSON:
     bun get-git-history-json.ts -n 1 --summary

  2. Get all breaking changes authored by Alice in the last 30 days:
     bun get-git-history-json.ts --author "Alice" --breaking --since "30 days ago"

  3. Generate a Markdown changelog for a specific range:
     bun get-git-history-json.ts -r "v1.0.0..v1.1.0" -f markdown

  4. Search the diff contents for a specific token:
     bun get-git-history-json.ts -G "TODO: refactor" --include-patch`);
  process.exit(exitCode);
}
