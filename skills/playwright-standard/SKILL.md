---
name: playwright-standard
description: |
  Comprehensive, opinionated guidance for Playwright test development. Use when
  writing E2E, API, component, or visual tests, debugging failures, implementing
  Page Object Model, or configuring CI/CD. Includes "Golden Rules" for resilient
  tests and provides on-demand reference for specialized scenarios (Electron,
  WebSockets, mobile, security audits).
---

# Playwright Standard

This skill combines battle-tested coding standards with industrial-scale infrastructure guidance. It is designed to keep agents on the "Golden Path" of modern Playwright development while providing deep reference for niche environments.

## Golden Rules (Mandatory)

1.  **`getByRole()` over CSS/XPath** — Resilient to markup changes, mirrors how users see the page.
2.  **Never `page.waitForTimeout()`** — Use `expect(locator).toBeVisible()` or `page.waitForURL()`.
3.  **Web-first assertions** — `expect(locator)` auto-retries; `expect(await locator.textContent())` does not.
4.  **Isolate every test** — Every test must run independently in any order (no shared state).
5.  **Fixtures over globals** — Share state via `test.extend()`, not module-level variables.
6.  **`baseURL` in config** — ZERO hardcoded URLs in test files.
7.  **Auth: Reuse storage state** — Use `browserContext.storageState` to avoid UI login in every test.
8.  **Network: Mock third-party only** — Never mock your own app; mock external APIs, gateways, and emails.
9.  **Traces: `'on-first-retry'`** — High-fidelity debugging without CI performance penalties.
10. **One behavior per test** — Avoid "mega-tests": keep focus narrow and assertions meaningful.

## Quality Standards

### Locators Priority
1.  **Role**: `page.getByRole('button', { name: 'Submit' })`
2.  **Label**: `page.getByLabel('User Name')`
3.  **Placeholder**: `page.getByPlaceholder('Search...')`
4.  **Text**: `page.getByText('Success')`
5.  **TestID**: `page.getByTestId('submit-btn')` (Last resort)

### Synchronization
- **Do**: `await expect(locator).toBeVisible()`
- **Avoid**: `await page.waitForSelector('.btn')`
- **Avoid**: `await page.waitForLoadState('networkidle')` (Flaky on high-latency networks)

---

## Specialized References (Load On-Demand)

For infrastructure, scale, or niche environments, read the relevant reference file:

| Scenario | Reference File |
| :--- | :--- |
| **CI/CD, Sharding, Docker** | [infrastructure.md](references/infrastructure.md) |
| **Electron, WebSockets, Canvas** | [advanced-scenarios.md](references/advanced-scenarios.md) |
| **Visual, Accessibility, API** | [advanced-scenarios.md](references/advanced-scenarios.md) |

## Example: Fixture-based Isolation
See [fixtures.ts](examples/fixtures.ts) for the recommended pattern for sharing state without global variables.
