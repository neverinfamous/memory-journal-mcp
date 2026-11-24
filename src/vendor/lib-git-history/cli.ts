// @ts-nocheck
import { parseArgs } from 'node:util';

const pc = {
  bold: (str: string) => `\x1b[1m${str}\x1b[22m`,
  red: (str: string) => `\x1b[31m${str}\x1b[39m`,
};

import type { CliArgs } from './schema.js';

export type { CliArgs };

export const CLI_OPTIONS = {
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
    pickaxe: { type: 'string', short: 'S' },
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
    uncommitted: { type: 'boolean' },
    cwd: { type: 'string' },
  } as const;

const STRING_CLI_OPTIONS = new Set<string>(
  Object.entries(CLI_OPTIONS)
    .filter(([, def]) => def.type === 'string')
    .map(([key]) => key),
);
const NUMERIC_ARG_REGEX = /^-?\d+(?:\.\d+)?$/;

const NON_NEGATIVE_INT_ARG_REGEX = /^\d+$/;

function parseNonNegIntArg(raw: string | undefined, flagName: string): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!NON_NEGATIVE_INT_ARG_REGEX.test(trimmed)) {
    throw new Error(`Invalid integer value for --${flagName}: "${raw}"`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Integer value out of safe range for --${flagName}: "${raw}"`);
  }
  return parsed;
}

function parseNonBlankArg(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    throw new Error('Flag value must not be blank');
  }
  return raw;
}

type ParsedCliValues = ReturnType<typeof parseArgs<{ options: typeof CLI_OPTIONS; strict: true }>>['values'];

function assignValidatedStrings(values: ParsedCliValues, out: CliArgs): void {
  const pathVal = parseNonBlankArg(values.path);
  const rangeVal = parseNonBlankArg(values.range);
  const formatVal = parseNonBlankArg(values.format);
  const mailmapVal = parseNonBlankArg(values.mailmap);
  const slackMapVal = parseNonBlankArg(values['slack-map']);
  const streamFileVal = parseNonBlankArg(values['stream-to-file']);
  const cwdVal = parseNonBlankArg(values.cwd);
  if (pathVal !== undefined) out.path = pathVal;
  if (rangeVal !== undefined) out.range = rangeVal;
  if (formatVal !== undefined) out.format = formatVal;
  if (mailmapVal !== undefined) out.mailmap = mailmapVal;
  if (slackMapVal !== undefined) out['slack-map'] = slackMapVal;
  if (streamFileVal !== undefined) out['stream-to-file'] = streamFileVal;
  if (cwdVal !== undefined) out.cwd = cwdVal;
  if (values.author !== undefined) out.author = values.author;
  if (values.search !== undefined) out.search = values.search;
  if (values.grep !== undefined) out.grep = values.grep;
  if (values.since !== undefined) out.since = values.since;
  if (values.until !== undefined) out.until = values.until;
  if (values.category !== undefined) out.category = values.category;
  if (values.type !== undefined) out.type = values.type;
  if (values.impact !== undefined) out.impact = values.impact;
  if (values.confidence !== undefined) out.confidence = values.confidence;
  if (values['patch-search'] !== undefined) out['patch-search'] = values['patch-search'];
  if (values.pickaxe !== undefined) out.pickaxe = values.pickaxe;
  if (values['diff-filter'] !== undefined) out['diff-filter'] = values['diff-filter'];
  if (values['issue-tracker'] !== undefined) out['issue-tracker'] = values['issue-tracker'];
  if (values['issue-pattern'] !== undefined) out['issue-pattern'] = values['issue-pattern'];
}

function validateCliValues(values: ParsedCliValues): CliArgs {
  const out: CliArgs = {};
  assignValidatedStrings(values, out);
  const limitVal = parseNonNegIntArg(values.limit, 'limit');
  const diffCtxVal = parseNonNegIntArg(values['diff-context'], 'diff-context');
  const maxBodyVal = parseNonNegIntArg(values['max-body-length'], 'max-body-length');
  const maxPatchVal = parseNonNegIntArg(values['max-patch-length'], 'max-patch-length');
  if (limitVal !== undefined) out.limit = limitVal;
  if (diffCtxVal !== undefined) out['diff-context'] = diffCtxVal;
  if (maxBodyVal !== undefined) out['max-body-length'] = maxBodyVal;
  if (maxPatchVal !== undefined) out['max-patch-length'] = maxPatchVal;
  if (values['first-parent'] !== undefined) out['first-parent'] = values['first-parent'];
  if (values.help !== undefined) out.help = values.help;
  if (values['include-merges'] !== undefined) out['include-merges'] = values['include-merges'];
  if (values['include-patch'] !== undefined) out['include-patch'] = values['include-patch'];
  if (values.breaking !== undefined) out.breaking = values.breaking;
  if (values.jsonl !== undefined) out.jsonl = values.jsonl;
  if (values['changelog-only'] !== undefined) out['changelog-only'] = values['changelog-only'];
  if (values.summary !== undefined) out.summary = values.summary;
  if (values.stats !== undefined) out.stats = values.stats;
  if (values.all !== undefined) out.all = values.all;
  if (values.reverse !== undefined) out.reverse = values.reverse;
  if (values['no-body'] !== undefined) out['no-body'] = values['no-body'];
  if (values.cache !== undefined) out.cache = values.cache;
  if (values['package-version'] !== undefined) out['package-version'] = values['package-version'];
  if (values.uncommitted !== undefined) out.uncommitted = values.uncommitted;
  return out;
}

export function parseArguments(): CliArgs {
  try {
    const rawArgs = process.argv.slice(2);
    const args: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      const curr = rawArgs[i];
      if (curr === '--') {
        args.push(...rawArgs.slice(i));
        break;
      }
      const next = rawArgs[i + 1];
      const optName = curr.startsWith('--') && !curr.includes('=') ? curr.slice(2) : '';
      if (next && optName !== '' && STRING_CLI_OPTIONS.has(optName) && NUMERIC_ARG_REGEX.test(next)) {
        args.push(`${curr}=${next}`);
        i++;
      } else {
        args.push(curr);
      }
    }
    const { values } = parseArgs({ args, options: CLI_OPTIONS, strict: true });

    // Map before/after aliases
    if (values.before && !values.until) values.until = values.before;
    if (values.after && !values.since) values.since = values.after;

    // Remove aliases to ensure a single source of truth in the returned object
    delete values.before;
    delete values.after;
    if (typeof values.format === 'string') {
      values.format = values.format.replace(/^["']|["']$/g, '');
    }

    return validateCliValues(values);
  } catch (err: unknown) {
    console.error(JSON.stringify({
      error: "InvalidCliArgs",
      message: err instanceof Error ? err.message : String(err),
      instruction: "Fix the CLI arguments and retry. Run with --help for usage."
    }));
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
  -S, --pickaxe <query>    Search for diffs changing occurrences of string (git log -S)

${pc.bold('Content & Formatting Options:')}
  --uncommitted            Output the current uncommitted working tree state instead of history
  -f, --format <fmt>       Output format: json (default), json-array, markdown, slack, or custom script path
  --summary                Output summary metadata only (omits bodies, files, patches)
  --stats                  Output summary metadata plus file stats (omits bodies, patches)
  --no-body                Omit commit bodies from output
  --include-patch          Include full patch diff strings in output
  --jsonl                  Output as JSON Lines format
  -U, --diff-context <n>   Lines of context for diffs (default: 1 for history, 3 for uncommitted)
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
  --cwd <path>             Target repository working directory
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
