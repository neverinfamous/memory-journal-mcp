#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The source skills directory is the parent of 'bin'
const sourceDir = path.resolve(__dirname, '..');

// Destination logic: allow argument override, default to %CWD%/.agents/skills
const destArg = process.argv[2];
const targetDir = destArg ? path.resolve(process.cwd(), destArg) : path.resolve(process.cwd(), '.agents/skills');

if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log(`\x1b[36mSynchronizing neverinfamous-agent-skills to -> ${targetDir}\x1b[0m`);

const items = fs.readdirSync(sourceDir);
let count = 0;

for (const item of items) {
    // Ignore hidden files and meta-package files
    if (item.startsWith('.') || ['bin', 'node_modules', 'package.json', 'package-lock.json', 'README.md'].includes(item)) {
        continue;
    }

    const sourcePath = path.join(sourceDir, item);
    const targetPath = path.join(targetDir, item);

    if (fs.statSync(sourcePath).isDirectory()) {
        fs.cpSync(sourcePath, targetPath, { recursive: true });
        console.log(`  \x1b[32m\u2714\x1b[0m ${item}`);
        count++;
    }
}

console.log(`\n\x1b[32mSuccessfully synchronized ${count} agent skill modules.\x1b[0m`);
console.log(`\nNext Steps:`);
console.log(`  1. Set your SKILLS_DIR_PATH environment variable to: ${targetDir}`);
console.log(`  2. Restart your MCP server to index the new skills.`);
