import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

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

function updateBadges() {
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
    if (process.env.CI || process.argv.includes("--strict")) {
      console.error("Strict mode active: Failing because coverage summary is missing.");
      process.exit(1);
    }
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

  // ![Coverage](https://img.shields.io/badge/Coverage-96.7%25-brightgreen.svg)
  const covRegex = /!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/Coverage-[0-9.]+.*?\.svg\)/g;
  const newCovBadge = `![Coverage](https://img.shields.io/badge/Coverage-${linesPct}%25-${coverageColor}.svg)`;

  // ![E2E](https://img.shields.io/badge/E2E-179%20tests%20%C2%B7%20224%20tools-blue.svg)
  const e2eRegex = /!\[E2E\]\(https:\/\/img\.shields\.io\/badge\/E2E-[^)]+\)/g;
  const newE2eBadge = `![E2E](https://img.shields.io/badge/E2E-${e2ePassing}%20passing%20%C2%B7%20${e2eSkipped}%20skipped-blue.svg)`;

  const filesToUpdate = ["README.md", "DOCKER_README.md"];
  const updatedFiles: string[] = [];

  for (const file of filesToUpdate) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    
    try {
      let content = fs.readFileSync(filePath, "utf-8");
      const originalNormalized = content.replace(/\r\n/g, "\n");
      let changed = false;

      if (hasCoverage) {
        covRegex.lastIndex = 0;
        if (covRegex.test(content)) {
          covRegex.lastIndex = 0;
          content = content.replace(covRegex, newCovBadge);
          changed = true;
          console.log(`Updated coverage badge in ${file} to ${linesPct}%`);
        } else {
          const licenseRegex = /(\[!\[License: MIT\].*?\))/;
          if (licenseRegex.test(content)) {
            content = content.replace(licenseRegex, `$1 ${newCovBadge}`);
            changed = true;
            console.log(`Inserted coverage badge in ${file} to ${linesPct}%`);
          } else {
            console.warn(`Could not find anchor to insert coverage badge in ${file}`);
            if (process.env.CI || process.argv.includes("--strict")) {
                process.exit(1);
            }
          }
        }
      }

      if (hasE2e) {
        e2eRegex.lastIndex = 0;
        if (e2eRegex.test(content)) {
          e2eRegex.lastIndex = 0;
          content = content.replace(e2eRegex, newE2eBadge);
          changed = true;
          console.log(`Updated E2E badge in ${file} to ${e2ePassing} passing, ${e2eSkipped} skipped`);
        } else {
          if (content.includes(newCovBadge)) {
            content = content.replace(newCovBadge, `${newCovBadge} ${newE2eBadge}`);
            changed = true;
            console.log(`Inserted E2E badge in ${file}`);
          } else {
            const licenseRegex = /(\[!\[License: MIT\].*?\))/;
            if (licenseRegex.test(content)) {
              content = content.replace(licenseRegex, `$1 ${newE2eBadge}`);
              changed = true;
              console.log(`Inserted E2E badge in ${file}`);
            }
          }
        }
      }

      if (changed) {
        const finalContent = content.replace(/\r\n/g, "\n");
        if (finalContent !== originalNormalized) {
          fs.writeFileSync(filePath, finalContent, "utf-8");
          updatedFiles.push(file);
        } else {
          console.log(`Badges in ${file} are already up-to-date.`);
        }
      } else {
        console.log(`No badges found to update in ${file}.`);
      }
    } catch (err) {
      console.warn(`Skipped updating ${file}: File not found or unreadable.`);
    }
  }

  if (updatedFiles.length > 0) {
    console.log(`\nAuto-committing badge updates for: ${updatedFiles.join(", ")}`);
    const commitScript = path.join(ROOT_DIR, ".agents", "scripts", "commit.ts");
    const addArgs = updatedFiles.map(f => `--add "${f}"`).join(" ");
    const cmd = `bun "${commitScript}" --msg "chore(docs): update test badges" --impact 0.1 --confidence 1.0 --validation none --no-history ${addArgs}`;
    
    try {
      execSync(cmd, { stdio: "inherit", cwd: ROOT_DIR });
      console.log("Successfully auto-committed badge updates.");
    } catch (err: any) {
      console.error("Failed to auto-commit badge updates:", err.message || err);
    }
  }
}

updateBadges();
