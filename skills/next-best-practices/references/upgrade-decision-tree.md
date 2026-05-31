# Next.js Upgrade Decision Tree

When upgrading Next.js, follow this decision tree to determine which official migration guide to read and which codemods to run.

## 1. Upgrade from Next.js 14 to 15

If current version is 14.x and target is 15.x:

1. Fetch guide: `https://nextjs.org/docs/app/guides/upgrading/version-15`
2. **Major Breaking Change**: Async Request APIs (params, searchParams, cookies, headers are now Promises).
3. **Run Codemod**: `npx @next/codemod@latest next-async-request-api .`
4. **Other Codemods**:
   - `next-request-geo-ip` (if using geo/ip in middleware)
   - `next-dynamic-access-named-export` (if using dynamic imports)
5. **Config Changes**: `experimental.ppr` is now `cacheComponents` (Next 15+).

## 2. Upgrade from Next.js 13 to 14

If current version is 13.x and target is 14.x:

1. Fetch guide: `https://nextjs.org/docs/app/guides/upgrading/version-14`
2. **Major Breaking Change**: Node.js minimum version is 18.17.
3. **Run Codemod**: `npx @next/codemod@latest next-Image-experimental .` (if moving from legacy Image).

## 3. General Codemod Workflow

For any version upgrade:

1. Ensure git working directory is clean.
2. Run the specific codemod.
3. Review the git diff.
4. ONLY THEN run the `npm install` / `pnpm install` step to pin the new target version.
5. Rebuild the app and manually fix TypeScript errors.
