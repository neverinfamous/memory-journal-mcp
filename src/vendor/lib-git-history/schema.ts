// @ts-nocheck
import { z } from 'zod';

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
  size: z.enum(['XS', 'S', 'M', 'L', 'XL']).optional(),
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
    validation: z.string().optional(),
    customTrailers: z.record(z.string(), z.array(z.string())).optional(),
  }).optional(),
  patch: z.string().optional(),
  isPatchTruncated: z.boolean().optional(),
  references: z.array(z.string()).optional(),
  coAuthors: z.array(z.string()).optional(),
  reviewers: z.array(z.string()).optional(),
  associatedIssues: z.array(z.object({
    issue: z.string(),
    action: z.string().nullable()
  })).optional(),
  validationErrors: z.array(z.any()).optional(),
  isCorrupted: z.boolean().optional(),
});

export type CommitEntry = z.infer<typeof entrySchema>;
export type FileStatus = z.infer<typeof fileStatusSchema>;
