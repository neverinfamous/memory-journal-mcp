// @ts-nocheck
import { randomUUID } from 'node:crypto';
import type { CliArgs } from './cli.js';

export const GIT_TIMEOUT_MS = 10000;
export const GIT_CMD_MAX_BUFFER = 10 * 1024 * 1024;
export const GIT_STREAM_BUFFER_DEFAULT = 100 * 1024 * 1024;
export const GIT_MAX_BYTES_LIMIT = 200 * 1024 * 1024;
export const GIT_IDLE_TIMEOUT_MS = 300000;
export const GIT_ABSOLUTE_TIMEOUT_MS = 900000;
export const MAX_TRAILER_LENGTH = 5000;
export const MAX_SUBJECT_LENGTH = 5000;
export const MAX_BODY_LENGTH = 100000;
export const SIGPIPE_EXIT_CODE = 141;
export const MAX_STDERR_LENGTH = 100000;
export const EXPECTED_RECORD_PARTS = 13;
export const MAX_STATUS_ITERATIONS = 500000;
export const MAX_EMPTY_STATUS_COUNT = 10;
export const MAX_PARSED_FILES = 500;
export const MAX_ARRAY_LENGTH = 50;
export const DEFAULT_MAX_BODY_LEN = 10000;
export const MAX_FILES_PER_COMMIT = 100;
export const DEFAULT_MAX_PATCH_LEN = 20000;
export const MAX_ISSUE_TEXT_LENGTH = 5000;
export const RECORD_START_FIELDS = 9;
export const RECORD_END_FIELDS = 3;

export const CHAR_NEWLINE = 0x0A;
export const CHAR_NULL = 0x00;

export const UNIQUE_ID = randomUUID();
export const RECORD_SEPARATOR = `\x1E<GIT_RECORD_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const FIELD_SEPARATOR = `\x1E<GIT_FIELD_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const NUMSTAT_BOUNDARY_STR = `\x1E<GIT_NUMSTAT_BOUNDARY_${UNIQUE_ID}>\x1E`;
export const PATCH_BOUNDARY_STR = `\x1E<GIT_PATCH_BOUNDARY_${UNIQUE_ID}>\x1E`;

export type CacheProjection = 'full' | 'no-patch' | 'stats' | 'summary' | 'no-body';
export type NumstatEntry = { insertions: number; deletions: number; path: string; isBinary?: boolean };
export type NumstatCommitMap = Map<string, NumstatEntry>;
export const NUMSTAT_MAPS_WITH_ALIASES = new WeakSet<NumstatCommitMap>();

export function wantsPatchOutput(args: CliArgs): boolean {
  return Boolean(
    (args['include-patch'] || args['diff-context'] !== undefined) &&
    !args.summary &&
    !args['no-body'] &&
    !args.stats,
  );
}

export const REGEX_FILE_STATUS = /^[A-Z][A-Z\d]*$/;
// [INVARIANT]: Disjoint `(\S.*|)` tail prevents `\s*` vs `.*` O(N^2) backtracking on subjects containing bare `\r`/`\u2028`/`\u2029`.
export const REGEX_CONVENTIONAL_COMMIT = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(\S.*|)$/;
export const REGEX_BREAKING_CHANGE = /(?:^|\n)BREAKING[\s-]CHANGES?:?[ \t]*\n?([\s\S]*?)(?:\n\n|$)/i;
export const REGEX_REVERT_COMMIT = /This reverts commit ([a-f0-9]{7,40})/;

export const GIT_EXCLUDE_PATTERNS = [
  ':(exclude)*.lock', ':(exclude)*-lock.json', ':(exclude)*.min.js', ':(exclude)*.map',
  ':(exclude)pnpm-workspace.yaml', ':(exclude)pnpm-lock.yaml',
  ':(exclude)*.svg', ':(exclude)*.png', ':(exclude)*.jpg', ':(exclude)*.jpeg', ':(exclude)*.gif',
  ':(exclude)**/dist/*', ':(exclude)**/build/*', ':(exclude)**/coverage/*',
  ':(exclude)*.csv', ':(exclude)*.txt',
  ':(exclude)go.sum', ':(exclude)**/.pnp.*', ':(exclude)**/vendor/*'
];

export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const IMPACT_HIGH = 0.8;
export const IMPACT_MEDIUM = 0.5;
export const IMPACT_LOW = 0.2;

const FLATTEN_SCRATCH_CHARS = 4096;
const FLATTEN_SCRATCH = Buffer.allocUnsafe(FLATTEN_SCRATCH_CHARS * 2);

export function flattenString(str: string): string {
  const len = str.length;
  if (len <= 1) return str;
  if (len <= FLATTEN_SCRATCH_CHARS) {
    const utf8Bytes = FLATTEN_SCRATCH.write(str, 0, 'utf8');
    if (utf8Bytes === len) return FLATTEN_SCRATCH.toString('latin1', 0, len);
    const utf16Bytes = FLATTEN_SCRATCH.write(str, 0, 'utf16le');
    return FLATTEN_SCRATCH.toString('utf16le', 0, utf16Bytes);
  }
  if (Buffer.byteLength(str, 'utf8') === len) return Buffer.from(str, 'latin1').toString('latin1');
  return Buffer.from(str, 'utf16le').toString('utf16le');
}

export function truncateSafely(str: string, maxLength: number, truncateMsg: string): string {
  if (str.length <= maxLength) return str;
  let safeLen = maxLength;
  while (safeLen > 0 && str.charCodeAt(safeLen - 1) >= 0xD800 && str.charCodeAt(safeLen - 1) <= 0xDBFF) {
    safeLen--;
  }
  return str.slice(0, safeLen) + truncateMsg;
}

export function createNullProtoRecord<V>(): Record<string, V> {
  const obj: Record<string, V> = {};
  Object.setPrototypeOf(obj, null);
  return obj;
}

export function iterateFromFirstStep<T>(
  first: IteratorResult<T>,
  rest: AsyncGenerator<T>,
): AsyncIterable<T> {
  let useFirst = true;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (useFirst) {
            useFirst = false;
            return Promise.resolve(first);
          }
          return rest.next();
        },
        return(): Promise<IteratorResult<T>> {
          return rest.return(undefined);
        },
      };
    },
  };
}

const extToLanguageMap: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', md: 'Markdown', json: 'JSON', jsonc: 'JSON',
  yml: 'YAML', yaml: 'YAML', css: 'CSS', scss: 'Sass', sass: 'Sass', html: 'HTML', htm: 'HTML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', rb: 'Ruby', java: 'Java',
  c: 'C', h: 'C++', cpp: 'C++', hpp: 'C++', cc: 'C++', cs: 'C#', php: 'PHP', sql: 'SQL',
  vue: 'Vue', svelte: 'Svelte', toml: 'TOML', xml: 'XML', swift: 'Swift',
  kt: 'Kotlin', kts: 'Kotlin', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
};
Object.setPrototypeOf(extToLanguageMap, null);
const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = Object.freeze(extToLanguageMap);

export function getLanguage(file: string): string | undefined {
  const dotIdx = file.lastIndexOf('.');
  if (dotIdx <= 0) return undefined;
  const baseStart = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1;
  if (dotIdx <= baseStart) return undefined;
  const rawExt = file.slice(dotIdx + 1);
  const direct = EXT_TO_LANGUAGE[rawExt];
  if (direct !== undefined) return direct;
  const lower = rawExt.toLowerCase();
  return lower === rawExt ? undefined : EXT_TO_LANGUAGE[lower];
}

const LEADING_CR_LF_RE = /^[\r\n]+/;

export function parseNumstatLineIntoMap(
  rawLine: string,
  readNextPart: () => string | null,
  currentMap: NumstatCommitMap,
): void {
  const firstCode = rawLine.charCodeAt(0);
  const firstStr = firstCode === 10 || firstCode === 13 ? rawLine.replace(LEADING_CR_LF_RE, '') : rawLine;
  if (!firstStr) return;

  const tab1 = firstStr.indexOf('\t');
  if (tab1 === -1) return;
  const tab2 = firstStr.indexOf('\t', tab1 + 1);
  if (tab2 === -1) return;

  const p0 = firstStr.slice(0, tab1);
  const p1 = firstStr.slice(tab1 + 1, tab2);
  const isBinary = p0 === '-' || p1 === '-';
  const ins = isBinary ? 0 : Math.min(parseInt(p0, 10) || 0, Number.MAX_SAFE_INTEGER);
  const del = isBinary ? 0 : Math.min(parseInt(p1, 10) || 0, Number.MAX_SAFE_INTEGER);

  let oldPath: string | undefined;
  let newPath: string;
  if (tab2 + 1 < firstStr.length) {
    newPath = firstStr.slice(tab2 + 1);
  } else {
    oldPath = readNextPart() ?? '';
    newPath = readNextPart() ?? '';
  }

  if (!newPath) newPath = 'unknown_path_due_to_malformed_buffer';
  else newPath = flattenString(newPath);
  const stats: NumstatEntry = isBinary
    ? { insertions: ins, deletions: del, path: newPath, isBinary: true }
    : { insertions: ins, deletions: del, path: newPath };
  currentMap.set(newPath, stats);
  if (oldPath) {
    currentMap.set(flattenString(oldPath), stats);
    NUMSTAT_MAPS_WITH_ALIASES.add(currentMap);
  }
}

export const FULL_SHA_REGEX = /^[0-9a-f]{40}$/i;
const DESCRIBE_LONG_REGEX = /^(.*)-(\d+)-g([0-9a-f]{40})$/i;

export function parseDescribeLong(output: string): { tagName: string; distance: number; sha: string } | null {
  const m = output.match(DESCRIBE_LONG_REGEX);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { tagName: m[1], distance: parseInt(m[2], 10), sha: m[3] };
}
