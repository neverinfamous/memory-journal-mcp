import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseGitRecord } from "../parser.js";
import { FIELD_SEPARATOR } from "../git-runner.js";
import type { CliArgs } from "../cli.js";
type TestCommit = {
  subject: string;
  body?: string;
  type: string;
  scope: string;
  cleanSubject: string;
  metadata: { category: string[]; impact: number; trust: number; validation: string; customTrailers?: Record<string, string[]> };
  associatedIssues: { issue: string; action: string | null }[];
  coAuthors: string[];
  reviewers: string[];
  isBreaking: boolean;
  breakingChangeDescription?: string;
  isRevert: boolean;
  patch: string;
  files: TestFile[];
  size?: string;
  totalInsertions?: number;
};

type TestFile = {
  status: string;
  file: string;
  oldFile?: string;
  insertions?: number;
  deletions?: number;
};

let tempRepo: string;
const scriptPath = join(import.meta.dir, "../../get-git-history-json.ts");

function git(args: string[]) {
  return execFileSync("git", args, { cwd: tempRepo, encoding: "utf-8" });
}

function runScript(args: string[]) {
  const env = { ...process.env, AGENT_EXEC_BYPASS: "1" };
  const result = execFileSync("bun", [scriptPath, ...args], { cwd: tempRepo, encoding: "utf-8", env, timeout: 30000 });
  return JSON.parse(result) as { commits: TestCommit[] };
}

beforeAll(() => {
  tempRepo = mkdtempSync(join(tmpdir(), "git-history-test-"));
  git(["init"]);
  git(["config", "user.name", "Test User"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "commit.gpgsign", "false"]); // Avoid GPG popups
  
  // 1. Initial commit
  writeFileSync(join(tempRepo, "README.md"), "# Hello\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: initial commit\n\nhistory-category: Initial\nhistory-impact: 1\nhistory-trust: 0.5\nvalidation: none"]);

  // 2. Feature with issues and multiline trailers
  writeFileSync(join(tempRepo, "app.ts"), "console.log('hi');\n");
  git(["add", "."]);
  git(["commit", "-m", "feat(auth): add login\n\nFixes #123\nRelated to neverinfamous/adamic#456\n\nhistory-category: Feature\nhistory-entry: Added login system\nco-authored-by: Coauthor <co@example.com>\nreviewed-by: Reviewer <rev@example.com>"]);

  // 3. Breaking change and patch exclusion
  writeFileSync(join(tempRepo, "package-lock.json"), "{}");
  writeFileSync(join(tempRepo, "app.ts"), "console.log('breaking');\n".repeat(10));
  git(["add", "."]);
  git(["commit", "-m", "feat(auth)!: change login API\n\nBREAKING CHANGE: The API has changed entirely.\n\nhistory-category: Breaking"]);

  // 4. File rename
  git(["mv", "app.ts", "auth.ts"]);
  writeFileSync(join(tempRepo, "auth.ts"), "console.log('breaking');\n".repeat(10) + "console.log('renamed and modified');\n");
  git(["add", "auth.ts"]);
  git(["commit", "-m", "refactor: rename app to auth"]);

  // 5. Revert commit
  git(["revert", "--no-edit", "HEAD"]);

  // 6. File rename with spaces and special characters
  writeFileSync(join(tempRepo, "strange file.txt"), "strange\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: add strange file"]);
  git(["mv", "strange file.txt", "very strange # file.txt"]);
  git(["commit", "-m", "test: rename strange file"]); // changed from refactor to test to not break the filter test

  // 7. Multi-line URL issues and PR links
  writeFileSync(join(tempRepo, "pr.txt"), "pr\n");
  git(["add", "."]);
  git(["commit", "-m", "fix: multiple PR links\n\nCloses https://github.com/neverinfamous/adamic/pull/12\nand Resolves\nhttps://github.com/neverinfamous/adamic/issues/13"]);

  // Tag it so the range logic is stable
  git(["tag", "-a", "v1.0.0", "-m", "Release 1.0.0"]);

  // 8. Another commit after tag to test range fallback
  writeFileSync(join(tempRepo, "auth.ts"), "console.log('post tag');\n");
  git(["add", "."]);
  git(["commit", "-m", "fix: post tag fix\n\nhistory-category: Bug Fix"]);

  // 9. Negative trailers and URL actions
  writeFileSync(join(tempRepo, "auth.ts"), "console.log('negative');\n");
  git(["add", "."]);
  git(["commit", "-m", "fix: url fix\n\nResolves https://github.com/neverinfamous/adamic/issues/999\n\nhistory-impact: -5\nhistory-trust: -0.5"]);

  // 10. Markdown truncation
  writeFileSync(join(tempRepo, "auth.ts"), "console.log('markdown');\n");
  git(["add", "."]);
  git(["commit", "-m", "docs: long doc\n\nThis is a very long body.\n\n```ts\nfunction test() {\n  console.log('this is a test');\n}\n```"]);

  // 11. Custom trailers and noise files
  writeFileSync(join(tempRepo, "pnpm-lock.yaml"), "lockfile content\n".repeat(100)); // 100 insertions
  writeFileSync(join(tempRepo, "small-file.txt"), "hello\n"); // 1 insertion
  git(["add", "."]);
  git(["commit", "-m", "chore: deps\n\nCustom-Trailer: hello-world\nAnother-Custom: value\nhistory-category: deps-updates, MINOR FIXES"]);

  // 12. Empty commit
  git(["commit", "--allow-empty", "-m", "chore: empty commit\n\nEmpty body test"]);

  // 13. Complex issue reset logic
  writeFileSync(join(tempRepo, "small-file.txt"), "hello again\n");
  git(["add", "."]);
  git(["commit", "-m", "fix: complex issues\n\nFixes #101 and #102. I also noticed #103 in the process."]);

  // 14. False positive issue parsing
  writeFileSync(join(tempRepo, "false-positive.txt"), "test\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: upgrade to UTF-8 and SHA-256"]);

  // 15. Grep search and carriage returns
  writeFileSync(join(tempRepo, "grep-test.txt"), "grep\n");
  git(["add", "."]);
  git(["commit", "-m", "test: SuPeR-UnIqUe-WoRd\n\r\nSome body text\r\n\r\nhistory-category: Grep\r\n"]);

  // 15.5. Jira URL false positive and @org/repo issues
  writeFileSync(join(tempRepo, "jira-test.txt"), "jira\n");
  git(["add", "."]);
  git(["commit", "-m", "fix: jira and org tests\n\nFixes @my-org/my-repo#999\n\nSee also http://example.com/JIRA-1234\nAlso fixes JIRA-5678"]);

  // 16. Merge commit with rename (simulating combined diff RM status)
  writeFileSync(join(tempRepo, "merge-file.txt"), "A\n");
  git(["add", "merge-file.txt"]);
  git(["commit", "-m", "chore: merge base"]);

  git(["checkout", "-b", "merge-branch1"]);
  writeFileSync(join(tempRepo, "merge-file.txt"), "A\nB1\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: merge branch 1 setup"]);
  
  git(["checkout", "master"]);
  git(["checkout", "-b", "merge-branch2"]);
  git(["mv", "merge-file.txt", "merge-file-renamed.txt"]);
  writeFileSync(join(tempRepo, "merge-file-renamed.txt"), "A\nB2\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: merge branch 2 rename"]);
  
  git(["checkout", "master"]);
  git(["merge", "merge-branch1"]);
  try {
    git(["merge", "merge-branch2"]);
  } catch {
    writeFileSync(join(tempRepo, "merge-file-renamed.txt"), "A\nB1\nB2\n");
    git(["add", "merge-file-renamed.txt"]);
    git(["rm", "merge-file.txt"]);
    git(["commit", "-m", "chore: Merge branch merge-branch2\n\nThis is a merge commit."]);
  }

  // 17. Stacked tags on HEAD
  git(["tag", "-a", "v1.0.1", "-m", "Release 1.0.1"]);
  git(["tag", "-a", "v1.0.2", "-m", "Release 1.0.2"]);
}, 30000);

afterAll(() => {
  try { rmSync(tempRepo, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("get-git-history-json", () => {
test("extracts conventional commits correctly", () => {
  const result = runScript(["--range", "HEAD"]);
  expect(result.commits.length).toBeGreaterThan(0);
  
  const featAuth = result.commits.find((c: TestCommit) => c.subject === "feat(auth): add login");
  expect(featAuth).toBeDefined();
  expect(featAuth!.type).toBe("feat");
  expect(featAuth!.scope).toBe("auth");
  expect(featAuth!.cleanSubject).toBe("add login");
}, 30000);

test("extracts metadata properly into the metadata object", () => {
  const result = runScript(["--range", "HEAD"]);
  const initial = result.commits.find((c: TestCommit) => c.subject === "chore: initial commit")!;
  expect(initial).toBeDefined();
  expect(initial!.metadata).toBeDefined();
  expect(initial!.metadata.category).toEqual(["Initial"]);
  expect(initial!.metadata.impact).toBe(1);
  expect(initial!.metadata.trust).toBe(0.5);
  expect(initial!.metadata.validation).toBe("none");
});

test("extracts issues as structured arrays", () => {
  const result = runScript(["--range", "HEAD"]);
  const featAuth = result.commits.find((c: TestCommit) => c.subject === "feat(auth): add login");
  expect(featAuth!.associatedIssues).toBeDefined();
  expect(featAuth!.associatedIssues).toContainEqual({ issue: "#123", action: "fixes" });
  expect(featAuth!.associatedIssues).toContainEqual({ issue: "neverinfamous/adamic#456", action: "related to" });
});

test("extracts co-authors and reviewers as arrays", () => {
  const result = runScript(["--range", "HEAD"]);
  const featAuth = result.commits.find((c: TestCommit) => c.subject === "feat(auth): add login");
  expect(featAuth!.coAuthors).toEqual(["Coauthor <co@example.com>"]);
  expect(featAuth!.reviewers).toEqual(["Reviewer <rev@example.com>"]);
}, 30000);

test("identifies breaking changes via subject and body and extracts description", () => {
  const result = runScript(["--range", "HEAD"]);
  const breaking = result.commits.find((c: TestCommit) => c.subject === "feat(auth)!: change login API");
  expect(breaking!.isBreaking).toBe(true);
  expect(breaking!.breakingChangeDescription).toBe("The API has changed entirely.");
});

test("identifies revert commits", () => {
  const result = runScript(["--range", "HEAD"]);
  const revert = result.commits.find((c: TestCommit) => c.isRevert === true)!;
  expect(revert).toBeDefined();
  expect(revert!.subject).toContain("Revert \"refactor: rename app to auth\"");
});

test("respects --limit flag when no filters applied", () => {
  const result = runScript(["--range", "HEAD", "-n", "2"]);
  expect(result.commits.length).toBe(2);
});

test("CLI filters by category", () => {
  const result = runScript(["--range", "HEAD", "--category", "Breaking"]);
  expect(result.commits.length).toBe(1);
  expect(result.commits[0].metadata.category).toContain("Breaking");
});

test("CLI filters by type", () => {
  const result = runScript(["--range", "HEAD", "--type", "refactor"]);
  expect(result.commits.length).toBe(1);
  expect(result.commits[0].type).toBe("refactor");
});

test("CLI filters by breaking flag", () => {
  const result = runScript(["--range", "HEAD", "--breaking"]);
  expect(result.commits.every((c: TestCommit) => c.isBreaking === true)).toBe(true);
});

test("includes patches but excludes specified files", () => {
  const result = runScript(["--range", "HEAD", "--include-patch"]);
  const breaking = result.commits.find((c: TestCommit) => c.subject === "feat(auth)!: change login API");
  
  expect(breaking!.patch).toBeDefined();
  expect(breaking!.patch).toContain("console.log('breaking');");
  expect(breaking!.patch).not.toContain("package-lock.json"); // Should be excluded
}, 30000);

test("extracts file renames and their numstats properly", () => {
  const result = runScript(["--range", "HEAD"]);
  const refactor = result.commits.find((c: TestCommit) => c.subject === "refactor: rename app to auth")!;
  
  expect(refactor!.files).toBeDefined();
  const fileEntry = refactor!.files.find((f: TestFile) => /^R/.test(f.status)!);
  expect(fileEntry).toBeDefined();
  expect(fileEntry!.file).toBe("auth.ts");
  expect(fileEntry!.oldFile).toBe("app.ts");
  
  // The rename + modify adds 1 insertion
  expect(refactor!.totalInsertions).toBe(1);
});

test("defaults range to since last tag if not provided", () => {
  const result = runScript([]);
  // Should contain the post-tag commits
  expect(result.commits.length).toBeGreaterThanOrEqual(1);
  const postTag = result.commits.find((c: TestCommit) => c.subject === "fix: post tag fix");
  expect(postTag).toBeDefined();
});

test("supports negative numeric trailers", () => {
  const result = runScript(["--range", "HEAD"]);
  const negative = result.commits.find((c: TestCommit) => c.subject === "fix: url fix");
  expect(negative!.metadata.impact).toBe(-5);
  expect(negative!.metadata.trust).toBe(-0.5);
});

test("extracts actions from full URL issue references", () => {
  const result = runScript(["--range", "HEAD"]);
  const fixUrl = result.commits.find((c: TestCommit) => c.subject === "fix: url fix");
  expect(fixUrl!.associatedIssues).toContainEqual({ issue: "neverinfamous/adamic#999", action: "resolves" });
});

test("truncates body safely by closing markdown blocks", () => {
  // Test with max-body-length that cuts right into the middle of the code block
  // Body is: This is a very long body.\n\n```ts\nfunction test() {\n  console.log('this is a test');\n}\n```
  // We'll cut it at 40 chars, which is right after function test()
  const result = runScript(["--range", "HEAD", "--max-body-length", "40"]);
  const longDoc = result.commits.find((c: TestCommit) => c.subject === "docs: long doc");
  
  expect(longDoc!.body!).toContain("```ts");
  // Ensure it appended the closing ```
  expect(longDoc!.body!.endsWith("```\n\n...[truncated to protect context]")).toBe(true);
});

test("captures unmapped custom trailers", () => {
  const result = runScript(["--range", "HEAD"]);
  const deps = result.commits.find((c: TestCommit) => c.subject === "chore: deps");
  expect(deps!.metadata).toBeDefined();
  expect(deps!.metadata.customTrailers).toBeDefined();
  expect(deps!.metadata.customTrailers!["custom-trailer"]).toEqual(["hello-world"]);
  expect(deps!.metadata.customTrailers!["another-custom"]).toEqual(["value"]);
});

test("ignores noise files like pnpm-lock.yaml for size calculation", () => {
  const result = runScript(["--range", "HEAD"]);
  const deps = result.commits.find((c: TestCommit) => c.subject === "chore: deps");
  // The commit has 101 total insertions. 100 from pnpm-lock.yaml, 1 from small-file.txt.
  // Because noise files are ignored, nonNoiseInsertions is 1. 1 line is 'XS' size.
  // If pnpm-lock.yaml wasn't ignored, it would be 'M' (100-249 lines).
  expect(deps!.size).toBe("XS");
  expect(deps!.totalInsertions).toBe(101);
}, 30000);
test("handles empty commits gracefully without merging SHAs", () => {
  const result = runScript(["--range", "HEAD"]);
  const empty = result.commits.find((c: TestCommit) => c.subject === "chore: empty commit");
  expect(empty).toBeDefined();
  expect(empty!.files).toBeUndefined();
  expect(empty!.size).toBeUndefined();
  
  // Verify it didn't corrupt the adjacent commit (deps)
  const deps = result.commits.find((c: TestCommit) => c.subject === "chore: deps");
  expect(deps).toBeDefined();
  expect(deps!.files).toBeDefined();
}, 30000);

test("normalizes categories to Title Case", () => {
  const result = runScript(["--range", "HEAD"]);
  const deps = result.commits.find((c: TestCommit) => c.subject === "chore: deps");
  expect(deps!.metadata.category).toEqual(["Deps Updates", "MINOR FIXES"]);
}, 30000);

test("resets issue actions when crossing sentence boundaries or word limits", () => {
  const result = runScript(["--range", "HEAD"]);
  const complex = result.commits.find((c: TestCommit) => c.subject === "fix: complex issues");
  expect(complex!.associatedIssues).toContainEqual({ issue: "#101", action: "fixes" });
  expect(complex!.associatedIssues).toContainEqual({ issue: "#102", action: "fixes" });
  expect(complex!.associatedIssues).toContainEqual({ issue: "#103", action: null });
}, 30000);

test("ignores false positive alphanumeric Jira-style patterns like UTF-8", () => {
  const result = runScript(["--range", "HEAD"]);
  const falsePositive = result.commits.find((c: TestCommit) => c.subject === "chore: upgrade to UTF-8 and SHA-256");
  expect(falsePositive).toBeDefined();
  expect(falsePositive!.associatedIssues).toBeUndefined();
}, 30000);

test("handles stacked tags accurately when determining fallback ranges", () => {
  const result = runScript([]);
  const postTag = result.commits.find((c: TestCommit) => c.subject === "fix: post tag fix");
  expect(postTag).toBeDefined();
}, 30000);

test("extracts @org/repo issue references and prevents Jira tickets from matching inside URLs", () => {
  const result = runScript(["--range", "HEAD"]);
  const jiraTest = result.commits.find((c: TestCommit) => c.subject === "fix: jira and org tests")!;
  expect(jiraTest).toBeDefined();
  
  // It should capture @my-org/my-repo#999
  expect(jiraTest.associatedIssues).toContainEqual({ issue: "@my-org/my-repo#999", action: "fixes" });
  
  // It should capture JIRA-5678
  expect(jiraTest.associatedIssues).toContainEqual({ issue: "JIRA-5678", action: "fixes" });
  
  // It should NOT capture JIRA-1234 because it's in a URL path
  expect(jiraTest.associatedIssues).not.toContainEqual({ issue: "JIRA-1234", action: "see also" });
  expect(jiraTest.associatedIssues).not.toContainEqual({ issue: "JIRA-1234", action: "fixes" });
}, 30000);

test("handles renames with spaces and special characters perfectly due to NUL delimiting", () => {
  const result = runScript(["--range", "HEAD"]);
  const testCommit = result.commits.find((c: TestCommit) => c.subject === "test: rename strange file")!;
  expect(testCommit).toBeDefined();
  expect(testCommit.files).toBeDefined();
  const renameFile = testCommit.files.find((f: TestFile) => /^R/.test(f.status));
  expect(renameFile).toBeDefined();
  expect(renameFile!.file).toBe("very strange # file.txt");
  expect(renameFile!.oldFile).toBe("strange file.txt");
});

test("parses multi-line GitHub issue links accurately", () => {
  const result = runScript(["--range", "HEAD"]);
  const prLinks = result.commits.find((c: TestCommit) => c.subject === "fix: multiple PR links")!;
  expect(prLinks).toBeDefined();
  expect(prLinks.associatedIssues).toContainEqual({ issue: "neverinfamous/adamic#12", action: "closes" });
  expect(prLinks.associatedIssues).toContainEqual({ issue: "neverinfamous/adamic#13", action: "resolves" });
});

test("yields 0 commits gracefully when --limit 0 is supplied", () => {
  const result = runScript(["--range", "HEAD", "--limit", "0"]);
  expect(result.commits).toBeDefined();
  expect(result.commits.length).toBe(0);
});

test("gracefully yields JSON error when git fails instead of crashing process", () => {
  try {
    const env = { ...process.env, AGENT_EXEC_BYPASS: "1" };
    execFileSync("bun", [scriptPath, "--range", "invalid-fake-commit-sha..HEAD"], { cwd: tempRepo, encoding: "utf-8", env });
    expect(true).toBe(false);
  } catch (error: unknown) {
    const err = error as { status: number; stderr: string };
    expect(err.status).toBe(1);
    const jsonStr = (err.stderr || "{}").replace(/^[\s\S]*?(?=\{)/, '');
    const parsed = JSON.parse(jsonStr || "{}");
    expect(parsed.error).toBe("Failed to generate git history json");
    expect(parsed.message).toContain("invalid-fake-commit-sha");
  }
});

test("CLI filters by grep case-insensitively", () => {
  const result = runScript(["--range", "HEAD", "--grep", "super-unique-word"]);
  expect(result.commits.length).toBe(1);
  expect(result.commits[0].subject).toBe("test: SuPeR-UnIqUe-WoRd");
});

test("safely parses carriage returns in trailers and body", () => {
  const result = runScript(["--range", "HEAD", "--grep", "super-unique-word"]);
  const commit = result.commits[0];
  expect(commit.metadata.category).toEqual(["Grep"]);
  expect(commit.body).toBe("Some body text");
});

test("summary format returns accurate fileCount instead of files array", () => {
  const result = runScript(["--range", "HEAD", "--summary"]);
  const initial = result.commits.find((c: TestCommit) => c.subject === "chore: initial commit")!;
  expect(initial.files).toBeUndefined();
  expect((initial as Record<string, unknown>).fileCount).toBe(1);
});

test("handles combined RM status correctly without corrupting next record", () => {
  const result = runScript(["--range", "HEAD", "--include-merges"]);
  const mergeCommit = result.commits.find((c: TestCommit) => c.subject.includes("merge-branch2"));
  expect(mergeCommit).toBeDefined();
  
  // It shouldn't crash or swallow the next status file due to oldFile misalignment
  expect(mergeCommit!.files).toBeDefined();
  const fileEntry = mergeCommit!.files.find((f: TestFile) => f.file === "merge-file-renamed.txt");
  expect(fileEntry).toBeDefined();
  expect(fileEntry!.status).toContain("RM");
  // Because it is a combined status, git log --name-status -z doesn't include the oldFile name.
  expect(fileEntry!.oldFile).toBeUndefined();
  
  // It should also extract stats successfully from numstat output
  expect(fileEntry!.insertions).toBeGreaterThanOrEqual(0);
});

describe("adversarial edge cases (unit)", () => {
  const mockRecord = (fields: Record<string, unknown>) => {
    const f = { sha: '123', refs: '', authorName: 'A', authorEmail: 'a@x.com', date: '2023-01-01', committerName: 'A', committerEmail: 'a@x.com', committerDate: '2023-01-01', subject: 'sub', body: '', exactTrailerBlock: '', rawTrailers: '', parentsAndFiles: '', ...fields };
    return [f.sha, f.refs, f.authorName, f.authorEmail, f.date, f.committerName, f.committerEmail, f.committerDate, f.subject, f.body, f.exactTrailerBlock, f.rawTrailers, f.parentsAndFiles].join(FIELD_SEPARATOR);
  };

  test("BREAKING CHANGE without colon or trailing space", () => {
    const rec = parseGitRecord(mockRecord({ body: 'Fix bug\n\nBREAKING CHANGE' }), { target: "wsl2" } as CliArgs);
    expect(rec?.isBreaking).toBe(true);
  });

  test("isValidStatus rejects purely numeric statuses", () => {
    const rec = parseGitRecord(mockRecord({ parentsAndFiles: '\n100\x00file.txt\x00' }), { target: "wsl2" } as CliArgs);
    expect(rec?.rawFiles.some((f: Record<string, unknown>) => f.status === '')).toBe(false);
  });

  test("comma-separated co-authors are correctly split", () => {
    const rec = parseGitRecord(mockRecord({ rawTrailers: 'Co-authored-by: Alice <a@x.com>, Bob <b@x.com>' }), { target: "wsl2" } as CliArgs);
    expect(rec?.coAuthors.length).toBe(2);
    expect(rec?.coAuthors[0]).toBe('Alice <a@x.com>');
    expect(rec?.coAuthors[1]).toBe('Bob <b@x.com>');
  });

  test("prevents prototype pollution and handles Zod Infinity fallback to string in trailers", () => {
    const rec = parseGitRecord(mockRecord({ rawTrailers: '__proto__: crash\x1Cconstructor: crash2\x1Cimpact: Infinity' }), { target: "wsl2" } as CliArgs);
    expect((rec?.metadataObj as Record<string, unknown>)?.impact).toBeUndefined();
    expect(({} as Record<string, unknown>).crash).toBeUndefined();
  });

  test("stops greedy regex from swallowing unrelated paragraphs", () => {
    const rec = parseGitRecord(mockRecord({ body: 'feat: update\n\nBREAKING CHANGE: overhauled.\n\nSome other context.' }), { target: "wsl2" } as CliArgs);
    expect(rec?.breakingChangeDescription).toBe("overhauled.");
  });

  test("does not skip trailers missing colons", () => {
    const rec = parseGitRecord(mockRecord({ rawTrailers: 'BREAKING CHANGE' }), { target: "wsl2" } as CliArgs);
    expect(rec?.isBreaking).toBe(true);
  });
});
});
