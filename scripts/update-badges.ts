import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

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
  const licenseRegex = /(\[!\[License: MIT\].*?\))/;
  if (licenseRegex.test(content)) {
    console.log(`Inserted coverage badge in ${file} to ${linesPct}%`);
    return { content: content.replace(licenseRegex, `$1 ${newCovBadge}`), changed: true };
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
  const licenseRegex = /(\[!\[License: MIT\].*?\))/;
  if (licenseRegex.test(content)) {
    console.log(`Inserted E2E badge in ${file}`);
    return { content: content.replace(licenseRegex, `$1 ${newE2eBadge}`), changed: true };
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
  if (!fs.existsSync(e2eDir)) return 0;
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
      } else if (entry.isFile() && /\.(spec|test)\.(?:[cm]?[jt]sx?)$/i.test(entry.name)) {
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
    if (fs.existsSync(summaryPath)) {
      const summary = CoverageSummarySchema.parse(
        JSON.parse(fs.readFileSync(summaryPath, "utf-8"))
      );
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
    if (fs.existsSync(playwrightPath)) {
      const pw = PlaywrightResultsSchema.parse(
        JSON.parse(fs.readFileSync(playwrightPath, "utf-8"))
      );
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
    covRegex: /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/Coverage-[0-9.]+[^)]*\.svg\)/g,
    newCovBadge: `![Coverage](https://img.shields.io/badge/Coverage-${String(linesPct)}%25-${coverageColor}.svg)`,
    e2eRegex: /!\[E2E\]\(https:\/\/img\.shields\.io\/badge\/E2E-[^)]+\)/g,
    newE2eBadge: `![E2E](https://img.shields.io/badge/E2E-${String(e2ePassing)}%20passing%20%C2%B7%20${String(e2eSkipped)}%20skipped-blue.svg)`,
  };
}

function updateBadgeTargetFile(file: string, metrics: BadgeMetrics): boolean {
  const filePath = path.join(ROOT_DIR, file);
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    const originalNormalized = content.replace(/\r\n/g, "\n");
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

    const finalContent = content.replace(/\r\n/g, "\n");
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
  if (!dirStat || dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
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

function isCompiledCommitFresh(rootDir: string): boolean {
  const compiledCommit = path.join(rootDir, "dist", "vendor", "commit", "commit.js");
  const compiledStat = fs.statSync(compiledCommit, { throwIfNoEntry: false });
  if (!compiledStat || !compiledStat.isFile()) return false;

  const commitScript = path.join(rootDir, "scripts", "commit.ts");
  const sourceStat = fs.statSync(commitScript, { throwIfNoEntry: false });
  if (sourceStat && sourceStat.mtimeMs > compiledStat.mtimeMs) return false;

  for (const lib of ["commit"]) {
    if (hasNewerTsInDir(path.join(rootDir, "src", "vendor", lib), compiledStat.mtimeMs)) {
      return false;
    }
  }
  return true;
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

function autoCommitDirtyBadgeFiles(filesToUpdate: readonly string[], updatedFiles: readonly string[]): void {
  const ghActions = process.env['GITHUB_ACTIONS'];
  if (ghActions !== undefined && ghActions.length > 0) return;
  const commitScript = path.join(ROOT_DIR, "scripts", "commit.ts");
  if (!fs.existsSync(commitScript)) return;

  const remaining = filesToUpdate.filter((file) => !updatedFiles.includes(file));
  const gitModified = new Set<string>();
  if (remaining.length > 0) {
    try {
      const diff = execFileSync("git", ["ls-files", "-m", "--", ...remaining], {
        cwd: ROOT_DIR,
        encoding: "utf-8",
        windowsHide: true,
      }).trim();
      for (const line of diff.split(/\r?\n/)) {
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
  const inv = buildCommitInvocation(ROOT_DIR, dirtyFiles);
  const entryScript = inv.args[0] ?? "";
  if (!fs.existsSync(entryScript)) {
    console.error(`Failed to auto-commit badge updates: commit entrypoint not found at ${entryScript}`);
    process.exit(1);
  }

  try {
    execFileSync(inv.command, inv.args, {
      stdio: "inherit",
      cwd: ROOT_DIR,
      windowsHide: true,
    });
    console.log("Successfully auto-committed badge updates.");
  } catch (err: unknown) {
    console.error("Failed to auto-commit badge updates:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function updateBadges(): void {
  const metrics = loadBadgeMetrics();
  const filesToUpdate = ["README.md", "DOCKER_README.md"];
  const updatedFiles = filesToUpdate.filter((file) => updateBadgeTargetFile(file, metrics));
  autoCommitDirtyBadgeFiles(filesToUpdate, updatedFiles);
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
