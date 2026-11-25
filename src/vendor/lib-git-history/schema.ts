// @ts-nocheck
import { z } from 'zod';
import { MAX_ARRAY_LENGTH, MAX_PARSED_FILES } from './constants.js';
import { copySafePlainValue, hasControlChar } from './security-utils.js';

export const commitSizeSchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);

const safeRecordKeySchema = z.string().max(256).refine(
  (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype',
  { message: 'Unsafe prototype property key' },
);
const noProtoRecord = <V extends z.ZodTypeAny>(valSchema: V): z.ZodType<Record<string, z.infer<V>>> =>
  z.unknown().refine(
    (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.hasOwn(v, '__proto__'),
    { message: 'Unsafe __proto__ property key' },
  ).pipe(z.record(safeRecordKeySchema, valSchema));

export const fileStatusSchema = z.object({
  status: z.string().min(1),
  file: z.string().min(1),
  oldFile: z.string().optional(),
  similarityScore: z.number().int().min(0).max(100).optional(),
  insertions: z.number().int().min(0).optional(),
  deletions: z.number().int().min(0).optional(),
  isBinary: z.boolean().optional(),
  language: z.string().optional(),
}).strict();

export const entrySchema = z.object({
  commit: z.string().min(1),
  parents: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  refs: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  tags: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  author: z.string().min(1),
  email: z.string().optional(),
  committer: z.string().optional(),
  committerEmail: z.string().optional(),
  committerDate: z.string().optional(),
  date: z.string().min(1),
  type: z.string().optional(),
  scope: z.string().optional(),
  isBreaking: z.boolean().optional(),
  breakingChangeDescription: z.string().optional(),
  isRevert: z.boolean().optional(),
  revertedCommit: z.string().optional(),
  isRebased: z.boolean().optional(),
  subject: z.string(),
  cleanSubject: z.string().optional(),
  body: z.string().optional(),
  isBodyTruncated: z.boolean().optional(),
  size: commitSizeSchema.optional(),
  files: z.array(fileStatusSchema).max(MAX_PARSED_FILES).optional(),
  fileCount: z.number().int().min(0).optional(),
  isFilesTruncated: z.boolean().optional(),
  totalInsertions: z.number().int().min(0).optional(),
  totalDeletions: z.number().int().min(0).optional(),
  metadata: z.object({
    category: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
    entry: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
    significance: z.string().optional(),
    impact: z.union([z.number(), z.string()]).optional(),
    trust: z.union([z.number(), z.string()]).optional(),
    confidence: z.union([z.number(), z.string()]).optional(),
    validation: z.string().optional(),
    customTrailers: noProtoRecord(z.array(z.string()).max(MAX_ARRAY_LENGTH)).optional(),
  }).strict().optional(),
  trailersObj: noProtoRecord(z.string()).optional(),
  patch: z.string().optional(),
  isPatchTruncated: z.boolean().optional(),
  references: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  coAuthors: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  reviewers: z.array(z.string()).max(MAX_ARRAY_LENGTH).optional(),
  associatedIssues: z.array(z.object({
    issue: z.string(),
    action: z.string().nullable()
  }).strict()).max(MAX_ARRAY_LENGTH).optional(),
  slackId: z.string().optional(),
  validationErrors: z.array(z.unknown()).max(200).transform((arr) => arr.map((v) => copySafePlainValue(v))).optional(),
  isCorrupted: z.boolean().optional(),
}).strict();

export type CommitEntry = z.infer<typeof entrySchema>;
export type FileStatus = z.infer<typeof fileStatusSchema>;

const NON_NEGATIVE_INT_RE = /^\d+$/;

const nonNegativeIntArgSchema = z.preprocess((val: unknown) => {
  if (val === undefined) return undefined;
  if (typeof val === 'number') return Number.isSafeInteger(val) && val >= 0 ? val : Number.NaN;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!NON_NEGATIVE_INT_RE.test(trimmed)) return Number.NaN;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}, z.number().int().min(0).optional());

const safeCliStringSchema = z.string().max(4096).refine((s) => !hasControlChar(s), {
  message: 'CLI string must not contain control characters',
}).optional();

const nonBlankStringSchema = z.string().max(4096).refine((s) => !hasControlChar(s) && s.trim().length > 0, {
  message: 'Flag value must not be blank or contain control characters',
}).optional();

const safeFormatSchema = z.preprocess(
  (v: unknown) => (typeof v === 'string' ? v.replace(/^["']|["']$/g, '') : v),
  nonBlankStringSchema,
);

export const cliArgsSchema = z.object({
  limit: nonNegativeIntArgSchema,
  path: nonBlankStringSchema,
  author: safeCliStringSchema,
  search: safeCliStringSchema,
  grep: safeCliStringSchema,
  range: nonBlankStringSchema,
  since: safeCliStringSchema,
  until: safeCliStringSchema,
  'first-parent': z.boolean().optional(),
  help: z.boolean().optional(),
  'include-merges': z.boolean().optional(),
  'include-patch': z.boolean().optional(),
  'diff-context': nonNegativeIntArgSchema,
  'max-body-length': nonNegativeIntArgSchema,
  'max-patch-length': nonNegativeIntArgSchema,
  category: safeCliStringSchema,
  type: safeCliStringSchema,
  breaking: z.boolean().optional(),
  impact: safeCliStringSchema,
  confidence: safeCliStringSchema,
  jsonl: z.boolean().optional(),
  'changelog-only': z.boolean().optional(),
  format: safeFormatSchema,
  summary: z.boolean().optional(),
  stats: z.boolean().optional(),
  all: z.boolean().optional(),
  'patch-search': safeCliStringSchema,
  pickaxe: safeCliStringSchema,
  'diff-filter': safeCliStringSchema,
  reverse: z.boolean().optional(),
  'no-body': z.boolean().optional(),
  'issue-tracker': safeCliStringSchema,
  'issue-pattern': safeCliStringSchema,
  cache: z.boolean().optional(),
  mailmap: nonBlankStringSchema,
  'slack-map': nonBlankStringSchema,
  'package-version': z.boolean().optional(),
  'stream-to-file': nonBlankStringSchema,
  uncommitted: z.boolean().optional(),
  cwd: nonBlankStringSchema,
}).strict();

export type CliArgs = z.infer<typeof cliArgsSchema>;
