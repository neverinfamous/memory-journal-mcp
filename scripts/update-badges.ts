import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

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

function loadBadgeMetrics(): BadgeMetrics {
  const summaryPath = path.join(ROOT_DIR, ".test-output/coverage/coverage-summary.json");
  const playwrightPath = path.join(ROOT_DIR, ".test-output/playwright-results.json");

  let linesPct = 0;
  let coverageColor = "red";
  let hasCoverage = false;
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    linesPct = summary.total.lines.pct;
    coverageColor = getBadgeColor(linesPct);
    hasCoverage = true;
  } else {
    console.warn(`Coverage summary not found at ${summaryPath}`);
  }

  let e2ePassing = 0;
  let e2eSkipped = 0;
  let hasE2e = false;
  if (fs.existsSync(playwrightPath)) {
    const pw = JSON.parse(fs.readFileSync(playwrightPath, "utf-8"));
    e2ePassing = pw.stats.expected || 0;
    e2eSkipped = pw.stats.skipped || 0;
    hasE2e = true;
  } else {
    console.warn(`Playwright results not found at ${playwrightPath}`);
  }

  if (
    !hasCoverage &&
    !hasE2e &&
    (process.env['GITHUB_ACTIONS'] || process.argv.includes("--strict"))
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
    covRegex: /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/Coverage-[0-9.]+.*?\.svg\)/g,
    newCovBadge: `![Coverage](https://img.shields.io/badge/Coverage-${linesPct}%25-${coverageColor}.svg)`,
    e2eRegex: /!\[E2E\]\(https:\/\/img\.shields\.io\/badge\/E2E-[^)]+\)/g,
    newE2eBadge: `![E2E](https://img.shields.io/badge/E2E-${e2ePassing}%20passing%20%C2%B7%20${e2eSkipped}%20skipped-blue.svg)`,
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

function autoCommitDirtyBadgeFiles(filesToUpdate: readonly string[], updatedFiles: readonly string[]): void {
  if (process.env['GITHUB_ACTIONS']) return;
  const commitScript = path.join(ROOT_DIR, ".agents", "scripts", "commit.ts");
  const dirtyFiles = filesToUpdate.filter((file) => {
    if (updatedFiles.includes(file)) return true;
    try {
      const diff = execFileSync("git", ["ls-files", "-m", "--", file], {
        cwd: ROOT_DIR,
        encoding: "utf-8",
      }).trim();
      return diff.length > 0;
    } catch (error) {
      console.error(`git status failed for ${file}:`, error instanceof Error ? error.message : error);
      return false;
    }
  });

  if (dirtyFiles.length === 0) return;
  console.log(`\nAuto-committing badge updates for: ${dirtyFiles.join(", ")}`);
  const args = [
    commitScript,
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
  ];

  try {
    execFileSync("bun", args, { stdio: "inherit", cwd: ROOT_DIR });
    console.log("Successfully auto-committed badge updates.");
  } catch (err: unknown) {
    console.error("Failed to auto-commit badge updates:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function updateBadges(): void {
  const metrics = loadBadgeMetrics();
  const filesToUpdate = ["README.md", "DOCKER_README.md"];
  const updatedFiles = filesToUpdate.filter((file) => updateBadgeTargetFile(file, metrics));
  autoCommitDirtyBadgeFiles(filesToUpdate, updatedFiles);
}

updateBadges();
