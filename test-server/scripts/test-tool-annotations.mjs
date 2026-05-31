/**
 * Integration Test: Tool Annotations
 *
 * Comprehensive validation of MCP tool annotations across all memory-journal-mcp tools.
 * Validates annotation presence, field coverage, logical consistency,
 * and correctness of behavioral hints.
 *
 * Checks:
 *   1. Tool count matches expected total
 *   2. All tools have an annotations object
 *   3. All tools have explicit openWorldHint
 *   4. openWorldHint=true matches an exact allowlist (filesystem/GitHub tools only)
 *   5. All tools have explicit readOnlyHint
 *   6. All tools have explicit destructiveHint
 *   7. No tools have readOnlyHint=true AND destructiveHint=true (contradiction)
 *   8. All tools have a title string
 *   9. Read-only tools should have idempotentHint=true (advisory)
 *  10. Destructive tools should NOT have idempotentHint=true (advisory)
 *  11. No readOnly tool has idempotentHint=false (contradiction)
 *  12. All tools have explicit idempotentHint
 *
 * Usage:
 *   npm run build
 *   node test-server/scripts/test-tool-annotations.mjs
 */

import { spawn } from "child_process";

// =============================================================================
// Configuration
// =============================================================================

const projectDir = "C:\\Users\\chris\\Desktop\\memory-journal-mcp";

/** Expected total tool count: 73 (10 groups + codemode) */
const EXPECTED_TOOL_COUNT = 73;

/**
 * Exact allowlist of tools that legitimately need openWorldHint=true.
 * These tools interact with external services (GitHub API) or the filesystem.
 */
const OPEN_WORLD_ALLOWLIST = new Set([
  // IO tools — filesystem interaction
  "export_markdown", // Writes .md files to filesystem
  "import_markdown", // Reads .md files from filesystem
  // GitHub read tools — external API
  "get_github_issues", // GitHub REST API
  "get_github_prs", // GitHub REST API
  "get_github_issue", // GitHub REST API
  "get_github_pr", // GitHub REST API
  "get_github_context", // GitHub REST API + git
  // GitHub Kanban tools — GitHub GraphQL API
  "get_kanban_board", // GitHub GraphQL API
  "move_kanban_item", // GitHub GraphQL API
  "add_kanban_item", // GitHub GraphQL API
  "delete_kanban_item", // GitHub GraphQL API
  // GitHub Issue lifecycle tools — GitHub REST + journal writes
  "create_github_issue_with_entry", // GitHub REST API
  "close_github_issue_with_entry", // GitHub REST API
  // GitHub Milestone tools — GitHub REST API
  "get_github_milestones", // GitHub REST API
  "get_github_milestone", // GitHub REST API
  "create_github_milestone", // GitHub REST API
  "update_github_milestone", // GitHub REST API
  "delete_github_milestone", // GitHub REST API
  // GitHub Insights — GitHub REST API
  "get_repo_insights", // GitHub REST API
  // GitHub Copilot — GitHub REST API
  "get_copilot_reviews", // GitHub REST API
  // Team IO tools — filesystem interaction
  "team_export_markdown", // Writes .md files to filesystem
  "team_import_markdown", // Reads .md files from filesystem
]);

/**
 * Exact allowlist of tools that should have destructiveHint=true.
 * These tools perform irreversible data deletion or full database replacement.
 */
const DESTRUCTIVE_ALLOWLIST = new Set([
  "delete_entry", // Soft/hard delete journal entry
  "delete_github_milestone", // Permanently deletes GitHub milestone
  "restore_backup", // Replaces entire database with backup
  "team_delete_entry", // Soft/hard delete team entry
]);

/**
 * Tools that should have readOnlyHint=true.
 * These tools perform no mutations whatsoever.
 */
const READ_ONLY_ALLOWLIST = new Set([
  // Core reads
  "get_entry_by_id",
  "get_recent_entries",
  "test_simple",
  "list_tags",
  // Search reads
  "search_entries",
  "search_by_date_range",
  "semantic_search",
  "get_vector_index_stats",
  // Analytics reads
  "get_statistics",
  "get_cross_project_insights",
  // Relationships reads
  "visualize_relationships",
  // IO reads (export_entries reads DB but doesn't write to filesystem)
  "export_entries",
  // Backup reads
  "list_backups",
  // GitHub reads
  "get_github_issues",
  "get_github_prs",
  "get_github_issue",
  "get_github_pr",
  "get_github_context",
  "get_kanban_board",
  "get_github_milestones",
  "get_github_milestone",
  "get_repo_insights",
  "get_copilot_reviews",
  // Team reads
  "team_get_entry_by_id",
  "team_get_recent",
  "team_list_tags",
  "team_search",
  "team_search_by_date_range",
  "team_get_statistics",
  "team_get_cross_project_insights",
  "team_get_collaboration_matrix",
  "team_visualize_relationships",
  "team_export_entries",
  "team_list_backups",
  // Team vector reads
  "team_semantic_search",
  "team_get_vector_index_stats",
  // Team flag reads
  "team_list_flags",
  "team_get_flag_analytics",
]);

// =============================================================================
// Result Tracking
// =============================================================================

const results = [];
const warnings = [];

function pass(label, detail) {
  results.push({ status: "pass", label, detail });
}

function fail(label, detail) {
  results.push({ status: "fail", label, detail });
}

function warn(label, detail) {
  warnings.push({ label, detail });
}

// =============================================================================
// Validation Logic
// =============================================================================

function validateAnnotations(tools) {
  console.log(`Total tools: ${tools.length}\n`);

  // ── 1. Tool count ──
  if (tools.length === EXPECTED_TOOL_COUNT) {
    pass("Tool count", `${tools.length} (expected ${EXPECTED_TOOL_COUNT})`);
  } else {
    fail("Tool count", `${tools.length} (expected ${EXPECTED_TOOL_COUNT})`);
  }

  // ── Collect per-field stats ──
  const stats = {
    hasAnnotations: 0,
    hasOpenWorldHint: 0,
    hasReadOnlyHint: 0,
    hasDestructiveHint: 0,
    hasIdempotentHint: 0,
    hasTitle: 0,
    openWorldTrue: [],
    openWorldFalse: 0,
    readOnlyTrue: [],
    readOnlyFalse: [],
    destructiveTrue: [],
    idempotentTrue: [],
    contradictions: [], // readOnly + destructive
    readOnlyNotIdempotent: [], // readOnly=true but idempotent !== true
    destructiveAndIdempotent: [], // destructive=true + idempotent=true
    missingAnnotations: [],
    missingOpenWorld: [],
    missingReadOnly: [],
    missingDestructive: [],
    missingIdempotent: [],
    missingTitle: [],
    readOnlyMismatch: [], // readOnly doesn't match allowlist
    destructiveMismatch: [], // destructive doesn't match allowlist
  };

  for (const tool of tools) {
    const a = tool.annotations;

    if (!a) {
      stats.missingAnnotations.push(tool.name);
      continue;
    }

    stats.hasAnnotations++;

    // openWorldHint
    if (typeof a.openWorldHint === "boolean") {
      stats.hasOpenWorldHint++;
      if (a.openWorldHint) {
        stats.openWorldTrue.push(tool.name);
      } else {
        stats.openWorldFalse++;
      }
    } else {
      stats.missingOpenWorld.push(tool.name);
    }

    // readOnlyHint
    if (typeof a.readOnlyHint === "boolean") {
      stats.hasReadOnlyHint++;
      if (a.readOnlyHint) {
        stats.readOnlyTrue.push(tool.name);
      } else {
        stats.readOnlyFalse.push(tool.name);
      }
    } else {
      stats.missingReadOnly.push(tool.name);
    }

    // destructiveHint
    if (typeof a.destructiveHint === "boolean") {
      stats.hasDestructiveHint++;
      if (a.destructiveHint) {
        stats.destructiveTrue.push(tool.name);
      }
    } else {
      stats.missingDestructive.push(tool.name);
    }

    // idempotentHint
    if (typeof a.idempotentHint === "boolean") {
      stats.hasIdempotentHint++;
      if (a.idempotentHint) {
        stats.idempotentTrue.push(tool.name);
      }
    } else {
      stats.missingIdempotent.push(tool.name);
    }

    // title — check tool.title (SDK top-level)
    const hasTitle = typeof tool.title === "string" && tool.title.length > 0;
    if (hasTitle) {
      stats.hasTitle++;
    } else {
      stats.missingTitle.push(tool.name);
    }

    // Contradiction check: readOnly + destructive
    if (a.readOnlyHint === true && a.destructiveHint === true) {
      stats.contradictions.push(tool.name);
    }

    // Advisory: read-only tools should have idempotentHint=true
    if (a.readOnlyHint === true && a.idempotentHint !== true) {
      stats.readOnlyNotIdempotent.push(tool.name);
    }

    // Advisory: destructive tools should NOT have idempotentHint=true
    if (a.destructiveHint === true && a.idempotentHint === true) {
      stats.destructiveAndIdempotent.push(tool.name);
    }

    // Cross-reference readOnlyHint against allowlist
    if (a.readOnlyHint === true && !READ_ONLY_ALLOWLIST.has(tool.name)) {
      stats.readOnlyMismatch.push(`${tool.name} (true but not in allowlist)`);
    }
    if (a.readOnlyHint !== true && READ_ONLY_ALLOWLIST.has(tool.name)) {
      stats.readOnlyMismatch.push(
        `${tool.name} (in allowlist but readOnly=${a.readOnlyHint})`,
      );
    }

    // Cross-reference destructiveHint against allowlist
    if (a.destructiveHint === true && !DESTRUCTIVE_ALLOWLIST.has(tool.name)) {
      stats.destructiveMismatch.push(
        `${tool.name} (true but not in allowlist)`,
      );
    }
    if (a.destructiveHint !== true && DESTRUCTIVE_ALLOWLIST.has(tool.name)) {
      stats.destructiveMismatch.push(
        `${tool.name} (in allowlist but destructive=${a.destructiveHint})`,
      );
    }
  }

  // ── 2. All tools have annotations ──
  if (stats.hasAnnotations === tools.length) {
    pass(
      "All tools have annotations",
      `${stats.hasAnnotations}/${tools.length}`,
    );
  } else {
    fail(
      "All tools have annotations",
      `${stats.hasAnnotations}/${tools.length} — missing: ${stats.missingAnnotations.join(", ")}`,
    );
  }

  // ── 3. All tools have explicit openWorldHint ──
  if (stats.missingOpenWorld.length === 0) {
    pass("openWorldHint coverage", `${stats.hasOpenWorldHint}/${tools.length}`);
  } else {
    fail(
      "openWorldHint coverage",
      `missing on: ${stats.missingOpenWorld.join(", ")}`,
    );
  }

  // ── 4. openWorldHint=true matches exact allowlist ──
  const actualOpenWorldSet = new Set(stats.openWorldTrue);
  const unexpectedOpenWorld = stats.openWorldTrue.filter(
    (name) => !OPEN_WORLD_ALLOWLIST.has(name),
  );
  const missingOpenWorld = [...OPEN_WORLD_ALLOWLIST].filter(
    (name) => !actualOpenWorldSet.has(name),
  );

  if (unexpectedOpenWorld.length === 0 && missingOpenWorld.length === 0) {
    pass(
      "openWorldHint allowlist",
      `${stats.openWorldTrue.length} tools match (${stats.openWorldFalse} local)`,
    );
  } else {
    const parts = [];
    if (unexpectedOpenWorld.length > 0) {
      parts.push(`unexpected true: ${unexpectedOpenWorld.join(", ")}`);
    }
    if (missingOpenWorld.length > 0) {
      parts.push(
        `expected true but false/missing: ${missingOpenWorld.join(", ")}`,
      );
    }
    fail("openWorldHint allowlist", parts.join(" | "));
  }

  // ── 5. All tools have explicit readOnlyHint ──
  if (stats.missingReadOnly.length === 0) {
    pass("readOnlyHint coverage", `${stats.hasReadOnlyHint}/${tools.length}`);
  } else {
    fail(
      "readOnlyHint coverage",
      `missing on: ${stats.missingReadOnly.join(", ")}`,
    );
  }

  // ── 5b. readOnlyHint matches allowlist ──
  if (stats.readOnlyMismatch.length === 0) {
    pass(
      "readOnlyHint allowlist",
      `${stats.readOnlyTrue.length} readOnly=true, ${stats.readOnlyFalse.length} readOnly=false`,
    );
  } else {
    fail(
      "readOnlyHint allowlist",
      `mismatches: ${stats.readOnlyMismatch.join("; ")}`,
    );
  }

  // ── 6. All tools have explicit destructiveHint ──
  if (stats.missingDestructive.length === 0) {
    pass(
      "destructiveHint coverage",
      `${stats.hasDestructiveHint}/${tools.length}`,
    );
  } else {
    fail(
      "destructiveHint coverage",
      `missing on: ${stats.missingDestructive.join(", ")}`,
    );
  }

  // ── 6b. destructiveHint matches allowlist ──
  if (stats.destructiveMismatch.length === 0) {
    pass(
      "destructiveHint allowlist",
      `${stats.destructiveTrue.length} destructive tools match`,
    );
  } else {
    fail(
      "destructiveHint allowlist",
      `mismatches: ${stats.destructiveMismatch.join("; ")}`,
    );
  }

  // ── 7. No readOnly+destructive contradictions ──
  if (stats.contradictions.length === 0) {
    pass("No readOnly+destructive contradictions", "0 violations");
  } else {
    fail(
      "No readOnly+destructive contradictions",
      `contradictions: ${stats.contradictions.join(", ")}`,
    );
  }

  // ── 8. All tools have a title ──
  if (stats.missingTitle.length === 0) {
    pass("title coverage", `${stats.hasTitle}/${tools.length}`);
  } else {
    fail("title coverage", `missing on: ${stats.missingTitle.join(", ")}`);
  }

  // ── 9. Advisory: read-only tools should have idempotentHint=true ──
  if (stats.readOnlyNotIdempotent.length > 0) {
    warn(
      "Read-only tools missing idempotentHint=true",
      stats.readOnlyNotIdempotent.join(", "),
    );
  }

  // ── 10. Advisory: destructive tools should NOT have idempotentHint=true ──
  if (stats.destructiveAndIdempotent.length > 0) {
    warn(
      "Destructive tools with idempotentHint=true (suspect)",
      stats.destructiveAndIdempotent.join(", "),
    );
  }

  // ── 11. All tools have explicit idempotentHint ──
  if (stats.missingIdempotent.length === 0) {
    pass(
      "idempotentHint coverage",
      `${stats.hasIdempotentHint}/${tools.length}`,
    );
  } else {
    fail(
      "idempotentHint coverage",
      `missing on: ${stats.missingIdempotent.join(", ")}`,
    );
  }

  // ── Summary ──
  console.log("┌──────────────────────────────────────────────────────────┐");
  console.log("│                  ANNOTATION AUDIT RESULTS               │");
  console.log("├──────────────────────────────────────────────────────────┤");

  const hasFailure = results.some((r) => r.status === "fail");

  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : "❌";
    console.log(`│ ${icon} ${r.label}`);
    console.log(`│    ${r.detail}`);
  }

  if (warnings.length > 0) {
    console.log("├──────────────────────────────────────────────────────────┤");
    console.log("│ ⚠️  ADVISORY WARNINGS (non-blocking)                    │");
    for (const w of warnings) {
      console.log(`│ ⚠️  ${w.label}`);
      console.log(`│    ${w.detail}`);
    }
  }

  console.log("├──────────────────────────────────────────────────────────┤");
  console.log("│ FIELD COVERAGE SUMMARY                                  │");
  console.log(
    `│   openWorldHint:   ${pct(stats.hasOpenWorldHint, tools.length)}`,
  );
  console.log(
    `│   readOnlyHint:    ${pct(stats.hasReadOnlyHint, tools.length)}`,
  );
  console.log(
    `│   destructiveHint: ${pct(stats.hasDestructiveHint, tools.length)}`,
  );
  console.log(
    `│   idempotentHint:  ${pct(stats.hasIdempotentHint, tools.length)}`,
  );
  console.log(`│   title:           ${pct(stats.hasTitle, tools.length)}`);
  console.log("├──────────────────────────────────────────────────────────┤");
  console.log(
    `│ BREAKDOWN: readOnlyHint=true: ${stats.readOnlyTrue.length} | destructiveHint=true: ${stats.destructiveTrue.length}`,
  );
  console.log(
    `│ BREAKDOWN: openWorldHint=true: ${stats.openWorldTrue.length} (${stats.openWorldTrue.join(", ")})`,
  );
  console.log(
    `│ BREAKDOWN: destructiveHint=true: ${stats.destructiveTrue.length} (${stats.destructiveTrue.join(", ")})`,
  );
  console.log(
    `│ BREAKDOWN: idempotentHint=true: ${stats.idempotentTrue.length}`,
  );
  console.log("├──────────────────────────────────────────────────────────┤");

  const verdict = hasFailure ? "❌ FAIL" : "✅ PASS";
  console.log(`│ VERDICT: ${verdict}`);
  console.log("└──────────────────────────────────────────────────────────┘");

  return hasFailure ? 1 : 0;
}

function pct(count, total) {
  const p = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
  return `${count}/${total} (${p}%)`;
}

// =============================================================================
// Server Communication (JSON-RPC over stdio)
// =============================================================================

const proc = spawn(
  "node",
  ["dist/cli.js", "--instruction-level", "essential"],
  {
    cwd: projectDir,
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let buffer = "";
let finished = false;

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();

  const lines = buffer.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id === 1) {
        // Initialize response — skip
      } else if (msg.id === 2) {
        // tools/list response
        const tools = msg.result?.tools || [];
        const exitCode = validateAnnotations(tools);

        finished = true;
        proc.kill();
        process.exit(exitCode);
      }
    } catch {
      // Not complete JSON yet
    }
  }
});

proc.stderr.on("data", () => {});

// Send initialize
proc.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  }) + "\n",
);

// Wait, then send initialized + tools/list
setTimeout(() => {
  proc.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n",
  );

  setTimeout(() => {
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }) + "\n",
    );
  }, 500);
}, 1500);

setTimeout(() => {
  if (!finished) {
    console.log("Timeout — killing process");
    proc.kill();
    process.exit(1);
  }
}, 15000);
