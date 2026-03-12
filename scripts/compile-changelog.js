const fs = require('fs');
const path = require('path');

const changelogPath = path.join(__dirname, '../CHANGELOG.md');
const unreleasedPath = path.join(__dirname, '../UNRELEASED.md');
const packageJsonPath = path.join(__dirname, '../package.json');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const newVersion = packageJson.version;
const date = new Date().toISOString().split('T')[0];

console.log(`Compiling CHANGELOG.md for version ${newVersion}...`);

if (!fs.existsSync(unreleasedPath)) {
  console.log('UNRELEASED.md not found. Nothing to compile.');
  process.exit(0);
}

let unreleasedContent = fs.readFileSync(unreleasedPath, 'utf8').trim();
if (!unreleasedContent) {
  console.log('UNRELEASED.md is empty. Nothing to compile.');
  process.exit(0);
}

// Ensure the changelog content is properly formatted
let changelog = fs.readFileSync(changelogPath, 'utf8');

// Replace the empty [Unreleased] header with the populated new version header + empty Unreleased header
const newHeader = `## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v${newVersion}...HEAD)\n\n## [${newVersion}](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v${newVersion}) - ${date}\n\n${unreleasedContent}\n`;

const unreleasedRegex = /^## \[Unreleased\][^\n]*\n+/m;
if (unreleasedRegex.test(changelog)) {
  changelog = changelog.replace(unreleasedRegex, newHeader + '\n');
} else {
  console.error('Could not find the ## [Unreleased] header in CHANGELOG.md!');
  process.exit(1);
}

// Write the updated CHANGELOG.md
fs.writeFileSync(changelogPath, changelog, 'utf8');

// Empty the UNRELEASED.md file for the next cycle
fs.writeFileSync(unreleasedPath, '', 'utf8');

console.log(`Successfully compiled CHANGELOG.md for v${newVersion} and cleared UNRELEASED.md.`);
