---
name: next-upgrade
description: |
  Upgrade Next.js to a specific target version using safe dependency bumps, codemods, 
  and diff reviews. Use when you need to execute major version bumps, resolve breaking changes, 
  or safely run @next/codemod against the repository before upgrading.
---

# Upgrade Next.js

Upgrade the current project to a targeted Next.js version following official migration guides.

## Instructions

1. **Detect current environment**: 
   - Read `package.json` to identify the current Next.js version, React version, and package manager (`npm`, `pnpm`, `yarn`).
   - Read the lockfile to ensure you use the correct package manager.

2. **Determine target version**:
   - Do NOT blindly use `@latest`. Always determine the explicit target version (e.g., `15.0.0`) based on user request or current LTS.
   - For major version jumps, upgrade incrementally (e.g., 13 → 14 → 15).

3. **Consult Upgrade Decision Tree**:
   - Read [references/decision-tree.md](references/decision-tree.md) to find the correct codemods and checklists for your target version.

4. **Run codemods FIRST (before installing new versions)**: 
   - Next.js codemods should often be run against the *old* codebase before upgrading to automate breaking changes.
   - Example: `npx @next/codemod@<target-version> <transform> <path>`

5. **Pin dependencies**: 
   - Upgrade Next.js and peer dependencies to the specific target version:
   - Example: `pnpm install next@15.0.0 react@19.0.0 react-dom@19.0.0`

6. **Review Diff (SECURITY GATE)**:
   - After running codemods and installing new dependencies, you MUST run `git diff` or review the changes.
   - Do NOT commit or ship without explicit user review of the codemod changes.

7. **Test the upgrade**:
   - Run `npm run build` (or equivalent) to check for build errors.
   - If there are errors in `next.config.js` or routing, resolve them manually.
