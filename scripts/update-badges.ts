import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const LICENSE_ANCHOR_RE = /(\[!\[License: MIT\].*?\))/
const SPEC_FILE_EXT_RE = /\.(spec|test)\.(?:[cm]?[jt]sx?)$/i
const COVERAGE_BADGE_RE = /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/Coverage-[0-9.]+[^)]*\.svg\)/g
const E2E_BADGE_RE = /!\[E2E\]\(https:\/\/img\.shields\.io\/badge\/E2E-[^)]+\)/g
const CRLF_RE = /\r\n/g
const LINE_SPLIT_RE = /\r?\n/

function getBadgeColor(percentage: number): string {
  if (percentage >= 95) return "brightgreen";
  if (percentage >= 85) return "green";
  if (percentage >= 75) return "yellowgreen";
  if (percentage >= 65) return "yellow";
  if (percentage >= 50) return "orange";
  return "red";
}

function applyCoverageBadge(
  content: string,
  file: string,
  covRegex: RegExp,
  newCovBadge: string,
  linesPct: number,
): { content: string; changed: boolean } {
  covRegex.lastIndex = 0;
  if (covRegex.test(content)) {
    covRegex.lastIndex = 0;
    console.log(`Updated coverage badge in ${file} to ${linesPct}%`);
    return { content: content.replace(covRegex, newCovBadge), changed: true };
  }
  if (LICENSE_ANCHOR_RE.test(content)) {
    console.log(`Inserted coverage badge in ${file} to ${linesPct}%`);
    return { content: content.replace(LICENSE_ANCHOR_RE, `$1 ${newCovBadge}`), changed: true };
  }
  console.warn(`Could not find anchor to insert coverage badge in ${file}`);
  if (process.env['GITHUB_ACTIONS'] || process.argv.includes("--strict")) {
    process.exit(1);
  }
  return { content, changed: false };
}

function applyE2eBadge(
  content: string,
  file: string,
  e2eRegex: RegExp,
  newE2eBadge: string,
  newCovBadge: string,
  e2ePassing: number,
  e2eSkipped: number,
): { content: string; changed: boolean } {
  e2eRegex.lastIndex = 0;
  if (e2eRegex.test(content)) {
    e2eRegex.lastIndex = 0;
    console.log(`Updated E2E badge in ${file} to ${e2ePassing} passing, ${e2eSkipped} skipped`);
    return { content: content.replace(e2eRegex, newE2eBadge), changed: true };
  }
  if (content.includes(newCovBadge)) {
    console.log(`Inserted E2E badge in ${file}`);
    return { content: content.replace(newCovBadge, `${newCovBadge} ${newE2eBadge}`), changed: true };
  }
  if (LICENSE_ANCHOR_RE.test(content)) {
    console.log(`Inserted E2E badge in ${file}`);
    return { content: content.replace(LICENSE_ANCHOR_RE, `$1 ${newE2eBadge}`), changed: true };
  }
  return { content, changed: false };
}

interface BadgeMetrics {
  linesPct: number;
  coverageColor: string;
  hasCoverage: boolean;
  e2ePassing: number;
  e2eSkipped: number;
  hasE2e: boolean;
  covRegex: RegExp;
  newCovBadge: string;
  e2eRegex: RegExp;
  newE2eBadge: string;
}

const CoverageSummarySchema = z.object({
  total: z.object({
    lines: z.object({
      pct: z.number(),
    }),
  }),
});

const PlaywrightResultsSchema = z.object({
  suites: z.array(z.unknown()).optional(),
  stats: z.object({
    expected: z.number().optional().default(0),
    skipped: z.number().optional().default(0),
  }),
});

export interface LoadBadgeMetricsOptions {
  rootDir?: string;
  argv?: readonly string[];
}

export function countE2eSpecFiles(e2eDir: string): number {
  const rootStat = fs.lstatSync(e2eDir, { throwIfNoEntry: false });
  if (rootStat === undefined || !rootStat.isDirectory()) return 0;
  let count = 0;
  const stack: string[] = [e2eDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && SPEC_FILE_EXT_RE.test(entry.name)) {
        count += 1;
      }
    }
  }
  return count;
}

export function isPartialPlaywrightRun(
  pw: { suites?: readonly unknown[] | undefined },
  rootDir: string,
  argv: readonly string[] = process.argv,
  totalSpecsOverride?: number,
): boolean {
  if (argv.includes("--allow-partial")) return false;
  if (pw.suites === undefined) return false;
  const totalSpecs = totalSpecsOverride ?? countE2eSpecFiles(path.join(rootDir, "tests", "e2e"));
  return totalSpecs > 0 && pw.suites.length < totalSpecs;
}

function readOptionalJsonFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export function loadBadgeMetrics(options: LoadBadgeMetricsOptions = {}): BadgeMetrics {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const argv = options.argv ?? process.argv;
  const coverageOnly = argv.includes("--coverage-only");
  const e2eOnly = argv.includes("--e2e-only");
  const includeCoverage = !e2eOnly || coverageOnly;
  const includeE2e = !coverageOnly || e2eOnly;

  const summaryPath = path.join(rootDir, ".test-output/coverage/coverage-summary.json");
  const playwrightPath = path.join(rootDir, ".test-output/playwright-results.json");

  let linesPct = 0;
  let coverageColor = "red";
  let hasCoverage = false;
  if (includeCoverage) {
    const rawSummary = readOptionalJsonFile(summaryPath);
    if (rawSummary !== null) {
      const summary = CoverageSummarySchema.parse(JSON.parse(rawSummary));
      linesPct = summary.total.lines.pct;
      coverageColor = getBadgeColor(linesPct);
      hasCoverage = true;
    } else {
      console.warn(`Coverage summary not found at ${summaryPath}`);
    }
  }

  let e2ePassing = 0;
  let e2eSkipped = 0;
  let hasE2e = false;
  if (includeE2e) {
    const rawPw = readOptionalJsonFile(playwrightPath);
    if (rawPw !== null) {
      const pw = PlaywrightResultsSchema.parse(JSON.parse(rawPw));
      const totalSpecs =
        !argv.includes("--allow-partial") && pw.suites !== undefined
          ? countE2eSpecFiles(path.join(rootDir, "tests", "e2e"))
          : 0;
      if (isPartialPlaywrightRun(pw, rootDir, argv, totalSpecs)) {
        const executedSpecs = pw.suites?.length ?? 0;
        console.warn(
          `Skipping E2E badge update: partial Playwright run (${String(executedSpecs)}/${String(totalSpecs)} specs). Pass --allow-partial to override.`
        );
      } else {
        e2ePassing = pw.stats.expected;
        e2eSkipped = pw.stats.skipped;
        hasE2e = true;
      }
    } else {
      console.warn(`Playwright results not found at ${playwrightPath}`);
    }
  }

  if (
    !hasCoverage &&
    !hasE2e &&
    (Boolean(process.env['GITHUB_ACTIONS']) || argv.includes("--strict"))
  ) {
    console.error("Strict mode active: Failing because neither coverage nor E2E results were found.");
    process.exit(1);
  }

  return {
    linesPct,
    coverageColor,
    hasCoverage,
    e2ePassing,
    e2eSkipped,
    hasE2e,
    covRegex: COVERAGE_BADGE_RE,
    newCovBadge: `![Coverage](https://img.shields.io/badge/Coverage-${String(linesPct)}%25-${coverageColor}.svg)`,
    e2eRegex: E2E_BADGE_RE,
    newE2eBadge: `![E2E](https://img.shields.io/badge/E2E-${String(e2ePassing)}%20passing%20%C2%B7%20${String(e2eSkipped)}%20skipped-blue.svg)`,
  };
}

export function updateBadgeTargetFile(file: string, metrics: BadgeMetrics, rootDir: string = ROOT_DIR): boolean {
  const filePath = path.join(rootDir, file);
  const fileStat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (fileStat === undefined) {
    console.warn(`Skipped updating ${file}: File not found.`);
    return false;
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    console.error(`Failed updating ${file}: target is a symlink or non-regular file.`);
    process.exitCode = 1;
    return false;
  }
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    const originalNormalized = content.replace(CRLF_RE, "\n");
    let changed = false;

    if (metrics.hasCoverage) {
      const covRes = applyCoverageBadge(content, file, metrics.covRegex, metrics.newCovBadge, metrics.linesPct);
      content = covRes.content;
      changed = changed || covRes.changed;
    }

    if (metrics.hasE2e) {
      const e2eRes = applyE2eBadge(
        content,
        file,
        metrics.e2eRegex,
        metrics.newE2eBadge,
        metrics.newCovBadge,
        metrics.e2ePassing,
        metrics.e2eSkipped,
      );
      content = e2eRes.content;
      changed = changed || e2eRes.changed;
    }

    if (!changed) {
      console.log(`No badges found to update in ${file}.`);
      return false;
    }

    const finalContent = content.replace(CRLF_RE, "\n");
    if (finalContent !== originalNormalized) {
      fs.writeFileSync(filePath, finalContent, "utf-8");
      return true;
    }
    console.log(`Badges in ${file} are already up-to-date.`);
    return false;
  } catch (err: unknown) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code === "ENOENT") {
      console.warn(`Skipped updating ${file}: File not found.`);
    } else {
      console.error(`Failed updating ${file}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return false;
  }
}

export interface CommitInvocation {
  command: string;
  args: string[];
}

function hasNewerTsInDir(dirPath: string, targetMtimeMs: number): boolean {
  const dirStat = fs.lstatSync(dirPath, { throwIfNoEntry: false });
  if (!dirStat) return false;
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return true;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) return true;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (hasNewerTsInDir(fullPath, targetMtimeMs)) return true;
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      const st = fs.lstatSync(fullPath, { throwIfNoEntry: false });
      if (st && st.mtimeMs > targetMtimeMs) return true;
    }
  }
  return false;
}

function isContainedInRealRoot(targetPath: string, realRoot: string): boolean {
  try {
    const realTarget = fs.realpathSync.native(targetPath);
    const normRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
    const normTarget = process.platform === "win32" ? realTarget.toLowerCase() : realTarget;
    const rel = path.relative(normRoot, normTarget);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function isCompiledCommitFresh(rootDir: string): boolean {
  try {
    const realRoot = fs.realpathSync.native(rootDir);
    const compiledCommit = path.join(rootDir, "dist", "vendor", "commit", "commit.js");
    const compiledStat = fs.lstatSync(compiledCommit, { throwIfNoEntry: false });
    if (!compiledStat || compiledStat.isSymbolicLink() || !compiledStat.isFile()) return false;
    if (!isContainedInRealRoot(compiledCommit, realRoot)) return false;

    const commitScript = path.join(rootDir, "scripts", "commit.ts");
    const sourceStat = fs.lstatSync(commitScript, { throwIfNoEntry: false });
    if (sourceStat && (sourceStat.isSymbolicLink() || sourceStat.mtimeMs > compiledStat.mtimeMs)) {
      return false;
    }

    if (hasNewerTsInDir(path.join(rootDir, "src", "vendor", "commit"), compiledStat.mtimeMs)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function buildCommitInvocation(
  rootDir: string,
  dirtyFiles: readonly string[],
): CommitInvocation {
  const compiledCommit = path.join(rootDir, "dist", "vendor", "commit", "commit.js");
  const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
  const commitScript = path.join(rootDir, "scripts", "commit.ts");
  const scriptEntryArgs = isCompiledCommitFresh(rootDir)
    ? [compiledCommit]
    : [tsxCli, commitScript];
  return {
    command: process.execPath,
    args: [
      ...scriptEntryArgs,
      "--msg",
      "chore(docs): update test badges",
      "--impact",
      "0.1",
      "--confidence",
      "1.0",
      "--validation",
      "none",
      "--no-history",
      ...dirtyFiles.flatMap((f) => ["--add", f]),
    ],
  };
}

function autoCommitDirtyBadgeFiles(
  filesToUpdate: readonly string[],
  updatedFiles: readonly string[],
  rootDir: string = ROOT_DIR,
): void {
  const ghActions = process.env['GITHUB_ACTIONS'];
  if (ghActions !== undefined && ghActions.length > 0) return;
  const commitScript = path.join(rootDir, "scripts", "commit.ts");
  const commitScriptStat = fs.lstatSync(commitScript, { throwIfNoEntry: false });
  if (commitScriptStat === undefined || commitScriptStat.isSymbolicLink() || !commitScriptStat.isFile()) return;

  const remaining = filesToUpdate.filter((file) => !updatedFiles.includes(file));
  const gitModified = new Set<string>();
  if (remaining.length > 0) {
    try {
      const diff = execFileSync("git", ["ls-files", "-m", "--", ...remaining], {
        cwd: rootDir,
        encoding: "utf-8",
        windowsHide: true,
      }).trim();
      for (const line of diff.split(LINE_SPLIT_RE)) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          gitModified.add(trimmed.replace(/\\/g, "/"));
        }
      }
    } catch (error) {
      console.error("git ls-files failed for badge files:", error instanceof Error ? error.message : error);
    }
  }

  const dirtyFiles = filesToUpdate.filter(
    (file) => updatedFiles.includes(file) || gitModified.has(file.replace(/\\/g, "/"))
  );

  if (dirtyFiles.length === 0) return;
  console.log(`\nAuto-committing badge updates for: ${dirtyFiles.join(", ")}`);
  const inv = buildCommitInvocation(rootDir, dirtyFiles);
  const entryScript = inv.args[0] ?? "";
  const entryStat = fs.lstatSync(entryScript, { throwIfNoEntry: false });
  if (entryStat === undefined || entryStat.isSymbolicLink() || !entryStat.isFile()) {
    console.error(`Failed to auto-commit badge updates: commit entrypoint not found at ${entryScript}`);
    process.exit(1);
  }

  try {
    execFileSync(inv.command, inv.args, {
      stdio: "inherit",
      cwd: rootDir,
      windowsHide: true,
    });
    console.log("Successfully auto-committed badge updates.");
  } catch (err: unknown) {
    console.error("Failed to auto-commit badge updates:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function updateBadges(options: { rootDir?: string } = {}): void {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const metrics = loadBadgeMetrics({ rootDir });
  const filesToUpdate = ["README.md", "DOCKER_README.md"];
  const updatedFiles = filesToUpdate.filter((file) =>
    updateBadgeTargetFile(file, metrics, rootDir)
  );
  if (process.exitCode !== undefined && process.exitCode !== 0) return;
  autoCommitDirtyBadgeFiles(filesToUpdate, updatedFiles, rootDir);
}

function normalizePathForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) return false;
  return normalizePathForCompare(entry) === normalizePathForCompare(__filename);
}

if (isMainModule()) {
  updateBadges();
}
