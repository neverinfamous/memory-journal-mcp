# Security Audit

Run a comprehensive security audit using auto-detected scanning tools. Each tool
is independently detected and skipped gracefully if unavailable.

## Phase 1 — Tool Detection

Detect available security scanning tools (see SKILL.md § Security Tool
Auto-Detection). Journal which tools are available:

```
create_entry({
  content: "Security audit: detected tools: <list>. Unavailable: <list>.",
  entry_type: "audit_finding",
  tags: ["commander", "security", "detection"]
})
```

## Phase 2 — Dependency Vulnerabilities

### npm audit (always available for Node.js)

```bash
npm audit --json
```

Report:

- Total vulnerabilities by severity (critical / high / moderate / low)
- Whether each is fixable via `npm audit fix` or requires manual intervention
- Any overrides/resolutions in the manifest that may mask unfixed vulnerabilities

For non-Node.js projects, use the equivalent tool:

- Python: `pip audit --format json`
- Rust: `cargo audit --json`
- Go: `govulncheck ./...`

## Phase 3 — Static Analysis (SAST)

### CodeQL (if available)

```bash
codeql database create /tmp/codeql-db --language=<detected> --overwrite
codeql database analyze /tmp/codeql-db \
  --format=sarif-latest \
  --output=/tmp/codeql-results.sarif \
  security-extended security-and-quality
```

Parse SARIF output for findings. Journal each finding with severity.

## Phase 4 — Secret Scanning

### Gitleaks (if available)

```bash
gitleaks detect --source . --report-format json --report-path /tmp/gitleaks.json
```

### TruffleHog (if available)

```bash
trufflehog filesystem . --json --only-verified
```

For each finding: report file, line, secret type, and remediation.

## Phase 5 — Container Security (if applicable)

Skip unless `PROJECT_HAS_DOCKERFILE` is `true` or a Dockerfile is detected.

### Trivy (if available)

Filesystem scan:

```bash
trivy fs --severity HIGH,CRITICAL --format json .
```

Image scan (if image is built):

```bash
trivy image --severity HIGH,CRITICAL --format json <image-name>
```

### Docker Scout (if available)

```bash
docker scout cves <image-name> --format json --only-severity critical,high
```

## Phase 6 — Source Code Analysis

Perform static analysis of the source code for common vulnerability patterns:

1. **SQL injection** — string interpolation in SQL queries, missing parameterized
   queries
2. **Command injection** — user input passed to `exec()`, `spawn()`, or shell
   commands without sanitization
3. **Path traversal** — user-supplied paths used without normalization and
   boundary checks
4. **Prototype pollution** — unchecked `Object.assign()`, deep merge without
   prototype guards
5. **Input validation gaps** — overly permissive schemas, missing validation on
   API boundaries
6. **Authentication bypass** — endpoints accessible without auth checks
7. **Error disclosure** — stack traces, database errors, or internal structure
   leaked in responses

## Phase 7 — CI/CD Pipeline Review

If GitHub Actions workflows exist (`.github/workflows/`):

1. **Action pinning** — verify `uses:` references use SHA commits, not tags
2. **Secret handling** — verify secrets use `${{ secrets.* }}`, not inline values
3. **Security gates** — verify security scans hard-fail (no `continue-on-error: true`)
4. **Permissions** — verify workflow `permissions` follows least privilege

## Phase 8 — Findings Report

Journal all findings:

```
create_entry({
  content: "Security audit finding: <severity> — <description>. Tool: <tool>. File: <path>.",
  entry_type: "security_finding",
  tags: ["commander", "security", "<tool-name>"],
})
```

Produce a structured summary:

| Category                   | Risk Level | Findings | Critical |
| -------------------------- | ---------- | -------- | -------- |
| Dependency Vulnerabilities |            |          |          |
| Static Analysis (SAST)     |            |          |          |
| Secret Exposure            |            |          |          |
| Container Security         |            |          |          |
| Source Code Patterns       |            |          |          |
| CI/CD Pipeline             |            |          |          |

**HITL checkpoint**: Present findings report to the human with:

- An overall security posture score (A–F)
- Top 3 most urgent remediations
- Whether any findings are auto-fixable

## Phase 9 — Apply Fixes (with approval)

After human approves the fix plan:

1. Apply fixes in severity order (critical → high → moderate → low)
2. Run validation gates after all fixes:
   - Gate 1: Lint + Typecheck
   - Gate 2: Build
   - Gate 3: Tests
3. Journal each fix applied

## Phase 10 — Commit

Stage and commit security fixes:

```bash
git add <fixed files> <changelog>
git diff --cached --stat
git commit -m "security: audit fixes"
```

**Do not push** without human approval.
