// @ts-nocheck
import { z } from 'zod';

export const commitSizeSchema = z.enum(['XS', 'S', 'M', 'L', 'XL']);

export const fileStatusSchema = z.object({
  status: z.string(),
  file: z.string(),
  oldFile: z.string().optional(),
  similarityScore: z.number().int().optional(),
  insertions: z.number().int().optional(),
  deletions: z.number().int().optional(),
  isBinary: z.boolean().optional(),
  language: z.string().optional(),
});

export const entrySchema = z.object({
  commit: z.string(),
  parents: z.array(z.string()).optional(),
  refs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  author: z.string(),
  email: z.string().optional(),
  committer: z.string().optional(),
  committerEmail: z.string().optional(),
  committerDate: z.string().optional(),
  date: z.string(),
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
  files: z.array(fileStatusSchema).optional(),
  fileCount: z.number().int().optional(),
  isFilesTruncated: z.boolean().optional(),
  totalInsertions: z.number().int().optional(),
  totalDeletions: z.number().int().optional(),
  metadata: z.object({
    category: z.array(z.string()).optional(),
    entry: z.array(z.string()).optional(),
    significance: z.string().optional(),
    impact: z.union([z.number(), z.string()]).optional(),
    trust: z.union([z.number(), z.string()]).optional(),
    confidence: z.union([z.number(), z.string()]).optional(),
    validation: z.string().optional(),
    customTrailers: z.record(z.string(), z.array(z.string())).optional(),
  }).optional(),
  trailersObj: z.record(z.string(), z.string()).optional(),
  patch: z.string().optional(),
  isPatchTruncated: z.boolean().optional(),
  references: z.array(z.string()).optional(),
  coAuthors: z.array(z.string()).optional(),
  reviewers: z.array(z.string()).optional(),
  associatedIssues: z.array(z.object({
    issue: z.string(),
    action: z.string().nullable()
  })).optional(),
  slackId: z.string().optional(),
  validationErrors: z.array(z.unknown()).optional(),
  isCorrupted: z.boolean().optional(),
});

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

const nonBlankStringSchema = z.string().refine((s) => s.trim().length > 0, {
  message: 'Flag value must not be blank',
}).optional();

export const cliArgsSchema = z.object({
  limit: nonNegativeIntArgSchema,
  path: nonBlankStringSchema,
  author: z.string().optional(),
  search: z.string().optional(),
  grep: z.string().optional(),
  range: nonBlankStringSchema,
  since: z.string().optional(),
  until: z.string().optional(),
  'first-parent': z.boolean().optional(),
  help: z.boolean().optional(),
  'include-merges': z.boolean().optional(),
  'include-patch': z.boolean().optional(),
  'diff-context': nonNegativeIntArgSchema,
  'max-body-length': nonNegativeIntArgSchema,
  'max-patch-length': nonNegativeIntArgSchema,
  category: z.string().optional(),
  type: z.string().optional(),
  breaking: z.boolean().optional(),
  impact: z.string().optional(),
  confidence: z.string().optional(),
  jsonl: z.boolean().optional(),
  'changelog-only': z.boolean().optional(),
  format: nonBlankStringSchema,
  summary: z.boolean().optional(),
  stats: z.boolean().optional(),
  all: z.boolean().optional(),
  'patch-search': z.string().optional(),
  pickaxe: z.string().optional(),
  'diff-filter': z.string().optional(),
  reverse: z.boolean().optional(),
  'no-body': z.boolean().optional(),
  'issue-tracker': z.string().optional(),
  'issue-pattern': z.string().optional(),
  cache: z.boolean().optional(),
  mailmap: nonBlankStringSchema,
  'slack-map': nonBlankStringSchema,
  'package-version': z.boolean().optional(),
  'stream-to-file': nonBlankStringSchema,
  uncommitted: z.boolean().optional(),
  cwd: nonBlankStringSchema,
});

export type CliArgs = z.infer<typeof cliArgsSchema>;
