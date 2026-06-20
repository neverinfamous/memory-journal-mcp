// @ts-nocheck
import { parseArgs } from 'node:util';

export type CliArgs = {
  limit?: string;
  path?: string;
  author?: string;
  search?: string;
  grep?: string;
  range?: string;
  since?: string;
  until?: string;
  'first-parent'?: boolean;
  help?: boolean;
  'include-merges'?: boolean;
  'include-patch'?: boolean;
  'diff-context'?: string;
  'max-body-length'?: string;
  'max-patch-length'?: string;
  category?: string;
  type?: string;
  breaking?: boolean;
  jsonl?: boolean;
  'changelog-only'?: boolean;
  format?: string;
  summary?: boolean;
  all?: boolean;
  'patch-search'?: string;
  'diff-filter'?: string;
  reverse?: boolean;
  'no-body'?: boolean;
};

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
    jsonl: { type: 'boolean' },
    'changelog-only': { type: 'boolean' },
    format: { type: 'string', short: 'f' },
    summary: { type: 'boolean' },
    all: { type: 'boolean' },
    'patch-search': { type: 'string', short: 'G' },
    'diff-filter': { type: 'string' },
    reverse: { type: 'boolean' },
    'no-body': { type: 'boolean' },
  } as const;

  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options, strict: true });
    return values as CliArgs;
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    showHelpAndExit();
  }
}

export function showHelpAndExit(): never {
  console.log(`Usage: bun get-git-history-json.ts [options]`);
  process.exit(0);
}
