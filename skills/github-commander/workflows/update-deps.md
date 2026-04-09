# Update Dependencies

Run a structured dependency update with validation gates and journal audit trail.
Generalized for any package manager (npm, yarn, pnpm, bun).

## Phase 1 — Update Dependencies

1. Detect package manager (see SKILL.md § Package Manager Auto-Detection)

2. Update dependencies using the detected package manager:

   | Package Manager | Update Command | Audit Command         |
   | --------------- | -------------- | --------------------- |
   | npm             | `npm update`   | `npm audit`           |
   | yarn            | `yarn upgrade` | `yarn audit`          |
   | pnpm            | `pnpm update`  | `pnpm audit`          |
   | bun             | `bun update`   | _(no built-in audit)_ |

3. Run dependency audit (if available for the package manager)

4. If audit reports vulnerabilities:
   - Attempt auto-fix (e.g., `npm audit fix`)
   - For unfixable issues: check if lockfile overrides/resolutions can pin
     transitive deps to patched versions
   - Journal each vulnerability found

5. Check for remaining outdated packages:

   ```bash
   # npm
   npm outdated
   # yarn
   yarn outdated
   # pnpm
   pnpm outdated
   ```

6. For any remaining outdated packages:
   - Update the version range in the manifest file
   - Run install to update the lockfile
   - **Skip intentionally pinned packages** (pre-release pins, exact-version
     pins where Current = Wanted ≠ Latest)

## Phase 2 — Dockerfile Dependencies (Optional)

Skip this phase unless `PROJECT_HAS_DOCKERFILE` is `true` or a `Dockerfile`
is detected in the project root.

1. Scan the Dockerfile for manually patched packages (e.g., `npm pack <pkg>@<version>`)
2. For each patched package:
   - Check the registry for the latest version
   - Check for known CVEs
   - If a newer version exists, update the Dockerfile patch lines
3. Check base image for updates:
   - Verify the base image tag is pinned (not `latest`)
   - Check for newer patch versions of the pinned base
4. If the Dockerfile uses edge repositories for system packages, verify
   those packages are current

## Phase 3 — Validation Gates

Run the standard validation gates from SKILL.md:

1. **Gate 1**: Lint + Typecheck (`PROJECT_LINT_CMD`, `PROJECT_TYPECHECK_CMD`)
2. **Gate 2**: Build (`PROJECT_BUILD_CMD`)
3. **Gate 3**: Tests (`PROJECT_TEST_CMD`) *(Agent Note: Ensure OutputCharacterCount >= 10000 on test execution)*
4. **Gate 4**: E2E Tests (`PROJECT_E2E_CMD`) *(Agent Note: Ensure OutputCharacterCount >= 10000)*

Journal each gate result. Fix any failures caused by dependency updates.

## Phase 4 — Journal & Changelog

1. Journal the update:

   ```
   create_entry({
     content: "Updated dependencies: <list of packages updated>. Audit: <clean/N vulnerabilities>.",
     entry_type: "deps_update",
     tags: ["commander", "deps-update"]
   })
   ```

2. Update the project changelog (if it exists):
   - Security fixes (CVE/GHSA) under a security section
   - Version bumps under a changed/dependencies section
   - **Do not duplicate existing section headers**

## Phase 5 — Human Checkpoint

Present to the human:

- List of updated packages with old → new versions
- Any vulnerabilities found and their status (fixed/unfixable)
- Gate results
- Changelog additions

Wait for human approval before committing.

## Phase 6 — Commit

Stage only the files changed by this workflow:

```bash
git add package.json package-lock.json <changelog> <Dockerfile if changed>
git diff --cached --stat
git commit -m "chore: update dependencies"
```

**Do not push.** The human decides when to push or create a PR.
