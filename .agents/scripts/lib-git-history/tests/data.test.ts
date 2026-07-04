import { test, expect, describe } from "bun:test";
import { entrySchema } from "../schema.js";
import { parseGitRecord, processBatch } from "../parser.js";
import { FIELD_SEPARATOR } from "../git-runner.js";
import type { CliArgs } from "../cli.js";

describe("Data Integrity & Boundary Tests", () => {
  describe("Zod entrySchema boundaries", () => {
    test("Fails gracefully or validates on Infinity/NaN for integer fields", () => {
      const payload = {
        commit: "1234567890abcdef1234567890abcdef12345678",
        author: "Test Author",
        date: new Date().toISOString(),
        subject: "Test subject",
        fileCount: Infinity,
        totalInsertions: NaN,
        totalDeletions: -Infinity,
      };
      
      const result = entrySchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i: unknown) => (i as { path: string[] }).path.includes("fileCount"))).toBe(true);
        expect(issues.some((i: unknown) => (i as { path: string[] }).path.includes("totalInsertions"))).toBe(true);
      }
    });

    test("Checks type coercion edge cases", () => {
      const payload = {
        commit: "1234567890abcdef",
        author: "Test",
        date: "2026-06-20T20:00:00Z",
        subject: "Valid",
        
        fileCount: "5",
      };
      const result = entrySchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("String extraction (parseGitRecord)", () => {
    const buildFakeGitBlock = (subject: string, body: string, filesBlock: string = "") => {
      return `sha123${FIELD_SEPARATOR}HEAD${FIELD_SEPARATOR}Author${FIELD_SEPARATOR}author@test.com${FIELD_SEPARATOR}2026-06-20T10:00:00Z${FIELD_SEPARATOR}Committer${FIELD_SEPARATOR}committer@test.com${FIELD_SEPARATOR}2026-06-20T10:00:00Z${FIELD_SEPARATOR}${subject}${FIELD_SEPARATOR}${body}${FIELD_SEPARATOR}TrailerBlock${FIELD_SEPARATOR}TrailerRaw${FIELD_SEPARATOR}parent123\n${filesBlock}`;
    };

    test("Handles malformed unicode in body", () => {
      const malformedBody = "Body with \xDF\xFF malformed \x80 bytes";
      const block = buildFakeGitBlock("Subject", malformedBody);
      const parsed = parseGitRecord(block, { target: "wsl2" } as CliArgs);
      if (parsed === null) console.log("Parsed is null for block:", block);
      expect(parsed).not.toBeNull();
      expect(parsed!.body).toBe(malformedBody);
    });

    test("Handles emojis in subject and body", () => {
      const subject = "feat: \u{1F680} Add rockets";
      const body = "To the moon \u{1F315}\u{1F680}";
      const block = buildFakeGitBlock(subject, body);
      const parsed = parseGitRecord(block, { target: "wsl2" } as CliArgs);
      if (parsed === null) console.log("Parsed is null for block:", block);
      expect(parsed).not.toBeNull();
      expect(parsed!.subject).toBe(subject);
      expect(parsed!.body).toBe(body);
    });

    test("Handles UTF-16 BOM and mixed carriage returns", () => {
      const body = "\uFEFFThis body\r\nhas mixed\rcarriage\nreturns\r\n";
      const block = buildFakeGitBlock("Subject", body);
      const parsed = parseGitRecord(block, { target: "wsl2" } as CliArgs);
      expect(parsed).not.toBeNull();
      expect(parsed!.body).toContain("This body");
    });
    
    test("Extreme body sizes (truncation safe from OOM)", () => {
       const hugeBody = "a".repeat(150000);
       const block = buildFakeGitBlock("Subject", hugeBody);
       const parsed = parseGitRecord(block, { target: "wsl2" } as CliArgs);
       expect(parsed).not.toBeNull();
       expect(parsed!.body.length).toBeLessThan(150000);
       expect(parsed!.body).toContain("[body truncated");
    });
  });

  describe("Batch processing error recovery (processBatch)", () => {
    test("Recovers from invalid integers in metadata (impact/trust parsing) or invalid size via Zod validation", async () => {
      const mockBatchItem = {
         sha: "sha123",
         parents: [], refs: [], tags: [], authorName: "A", authorEmail: "B", date: "2026-06-20T00:00:00Z",
         committerName: "C", committerEmail: "D", committerDate: "2026-06-20T00:00:00Z",
         subject: "Subj", body: "", cleanSubject: "Subj", type: "feat", scope: undefined, isBreaking: false, breakingChangeDescription: undefined,
         isRevert: false, revertedCommit: undefined,
         rawFiles: [],
         trailersObj: Object.create(null), metadataObj: { impact: NaN, trust: Infinity },
         references: [], coAuthors: [], reviewers: [], issuesMap: new Map(), trueFileCount: 0
      };
      
      const args = { target: "wsl2" } as CliArgs;
      const flags: string[] = [];
      const result = await processBatch([mockBatchItem], args, flags);
      
      expect(result).toBeArray();
      expect(result.length).toBe(1);
    });
  });
});


