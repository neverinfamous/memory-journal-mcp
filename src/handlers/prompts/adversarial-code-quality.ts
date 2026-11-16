/**
 * Memory Journal MCP Server - `adversarial-audit-code-quality` prompt definition.
 * [INTENT] Extracted from `adversarial.ts` (L1) so the long detector catalog can evolve without
 * pushing the shared prompt module past the 500-line ceiling.
 */

import type { InternalPromptDef } from './index.js'
import {
    AUDIT_PROMPT_REVISION,
    buildAuditPromptDefinition,
    buildSharedAuditPreamble,
} from './adversarial-audit-factory.js'

export const CODE_QUALITY_PROMPT_REVISION = AUDIT_PROMPT_REVISION

const SCAN_METHOD_1 = `     \`\`\`powershell
     $skip = @('.git','vendor','third_party','node_modules','dist','coverage','build','.next','out','.wrangler','.turbo','.output','.svelte-kit','.test-output')
     $n = 0
     $over = 0
     function Walk($dir) {
       if (-not (Test-Path -LiteralPath $dir)) { return }
       foreach ($item in (Get-ChildItem -LiteralPath $dir -Force)) {
         if ($skip -contains $item.Name) { continue }
         if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
         if ($item.PSIsContainer) { Walk $item.FullName; continue }
         if ($item.Name -cmatch '\\.(ts|tsx|js|mjs|cjs)$' -and $item.Name -cnotmatch '\\.(test|spec|bench)\\.' -and $item.Name -cnotmatch '\\.d\\.ts$') {
           $script:n++
           $parts = [System.IO.File]::ReadAllText($item.FullName) -split '\\r?\\n'
           $lines = $parts.Length
           if ($lines -gt 0 -and $parts[$lines - 1] -eq '') { $lines-- }
           if ($lines -gt 500) { $script:over++; Write-Output ($lines.ToString() + ' ' + $item.FullName) }
          elseif ($lines -ge 451) { Write-Output ('WATCH ' + $lines.ToString() + ' ' + $item.FullName) }
         }
       }
     }
     if ((Test-Path -LiteralPath 'src') -or (Test-Path -LiteralPath 'scripts') -or (Test-Path -LiteralPath 'tests')) {
       Walk 'src'
       Walk 'scripts'
       Walk 'tests'
     } else {
       foreach ($top in (Get-ChildItem -LiteralPath '.' -Directory)) {
         if (-not $top.Name.StartsWith('.') -and ($skip -notcontains $top.Name) -and -not ($top.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { Walk $top.FullName }
       }
     }
     Write-Output ('SCAN_OK scanned=' + $n + ' over500=' + $over)
     \`\`\``

const SCAN_METHOD_2 = `     \`\`\`javascript
import {readdirSync as r,lstatSync as s,readFileSync as f} from 'fs';import {join as j} from 'path';const skip=new Set(['.git','vendor','third_party','node_modules','dist','coverage','build','.next','out','.wrangler','.turbo','.output','.svelte-kit','.test-output']);let n=0,over=0;function w(d){if(!s(d,{throwIfNoEntry:false}))return;for(const x of r(d)){if(skip.has(x))continue;const p=j(d,x);const st=s(p,{throwIfNoEntry:false});if(!st||st.isSymbolicLink())continue;if(st.isDirectory())w(p);else if(/\\.(ts|tsx|js|mjs|cjs)$/.test(x)&&!/\\.(test|spec|bench)\\./.test(x)&&!/\\.d\\.ts$/.test(x)){n++;const parts=f(p,'utf8').split(/\\r?\\n/);const l=parts.length>0&&parts[parts.length-1]===''?parts.length-1:parts.length;if(l>500){over++;console.log(l,p)}else if(l>=451)console.log('WATCH',l,p)}}}if(s('src',{throwIfNoEntry:false})||s('scripts',{throwIfNoEntry:false})||s('tests',{throwIfNoEntry:false})){w('src');w('scripts');w('tests');}else{for(const top of r('.')){if(!top.startsWith('.')&&!skip.has(top)){const st=s(top,{throwIfNoEntry:false});if(st&&!st.isSymbolicLink()&&st.isDirectory())w(top);}}}console.log('SCAN_OK scanned='+n+' over500='+over);
     \`\`\``

const TEMP_SCRIPT_RULE =
    "write the script to a temporary `.mjs` file in the session's scratch/temp directory outside the repository (parent-owned only — read-only subagents do not run shell scripts) and run `node <file>` (or `bun <file>` in Bun-only repositories) with the repository as the working directory (never an inline `-e` here-string, which Windows execution proxies rewrite). Note for Antigravity Plan Mode: if `write_file` is blocked while Plan Mode is active, write the scratch `.mjs` file inside `run_command` using a single-quoted PowerShell here-string (`$code = @'\\n...\\n'@; [System.IO.File]::WriteAllText($scratchFile, $code, [System.Text.UTF8Encoding]::new($false))`) so PowerShell never interpolates `$` tokens in JavaScript or writes a UTF-8 BOM, execute `node $scratchFile`, and remove the scratch `.mjs` file once complete"

const DETECTORS = `     1. **Silent Catch Block Detector**: Find every \`catch\` in production source, including \`catch (e)\` and multiline catches. A catch is silent when its body does not log, rethrow, or return a structured error. Quote the body. Keep intentional best-effort fallbacks out of the table. Do not flag a catch that returns the project's structured handler error.
     2. **Cross-Platform Path Separator Assumption Detector**: Flag filesystem prefix checks (\`startsWith\` / \`endsWith\` on a resolved path without a separator boundary) and hardcoded \`'\\\\'\` or \`'/'\` used to test real filesystem paths. Prefer \`path.relative()\` and \`path.sep\`. Ignore URL, route, glob, and SQL slashes. Case-fold only on Windows.
     3. **Cognitive Complexity & Nesting Hotspot Scan (parent-owned)**: Flag functions over 80 lines or control-flow nesting deeper than 4, measured by a script, not by eye (for example the TypeScript compiler API via \`createRequire(path.join(process.cwd(), 'package.json'))('typescript')\` across \`src\`, \`scripts\`, and non-test helpers in \`tests\` when present, falling back to top-level non-hidden, non-skipped source directories when neither exists, and skipping symlinks/reparse points and \`.git\`, \`vendor\` (including \`src/vendor\`), \`third_party\`, \`node_modules\`, \`dist\`, \`coverage\`, \`build\`, \`.next\`, \`out\`, \`.wrangler\`, \`.turbo\`, \`.output\`, \`.svelte-kit\`, \`.test-output\`, \`*.test.*\`, \`*.spec.*\`, \`*.bench.*\`, \`*.d.ts\`). To run it, ${TEMP_SCRIPT_RULE}. The script must print \`COMPLEXITY_OK files=<n> over80=<n> nestgt4=<n>\`; a script that does not print that line failed. Count an else-if chain, and a chained conditional (\`a ? b : c ? d : e\`), as one decision. Measure inner handlers and real helpers, not outer declarative registration factories whose body returns an array or object literal table of tool, prompt, resource, route, or schema definitions (\`return [...]\` / \`return {...}\` / \`return defs.map(...)\` / \`return [...defs]\`) or zero-branch template-literal builders (\`return \\\`...\\\`\`) — skip only the outer wrapper function from \`over80\` while still traversing every inner \`handler\` closure (and never flag a compliant factory as \`over80\`; note this exemption applies ONLY to Detector 3 function length, never to the hard 500-line file ceiling).
     4. **Schema-to-Handler Parameter Drift Check**: Every input-schema property (and resource URI query/fragment parameter, unanchored resource URI regex missing \`$\`, router \`getBaseUri(uri)\` query-stripping mismatch, or numeric URI segment) is strictly validated and consumed by the handler or rewritten by that project's own parameter-normalization layer. Do not assume a file named \`param-normalizer.ts\` exists. Verify Zod 4 introspection helpers (e.g., \`memory://help/*\` parameter extractors and Code Mode type generators) unwrap \`ZodPipe\`/\`ZodTransform\` (\`.in\` / \`.def.in\`) and read \`ZodLiteral\`/\`ZodRecord\`/\`ZodTuple\`/\`ZodIntersection\` metadata accurately. Quote the schema/URI field and the handler or normalizer read. Ignore fields that are forwarded as a whole parsed object.
     5. **Uncleaned Timer / EventListener Detector**: Flag \`setInterval\`, retained \`setTimeout\` handles, \`fs.watch\`, and \`process\` / server / filesystem / worker \`.on(\` registrations that lack \`unref()\`, \`clear*\`, or \`close()\` / \`finally\` cleanup. An awaited one-shot delay is not a leak.
     6. **Type-safety Detector**: Flag \`any\`, \`as any\`, \`z.any()\` in Zod schemas (unless explicitly documented for arbitrary untrusted JSON passthrough), TypeScript postfix non-null assertions (\`value!\`), definite assignment (\`!:\`), and a double assertion (\`as unknown as\`) that reads a property the source type does not declare. Ignore GraphQL \`Type!\`, \`!=\`, and \`!condition\`. Leave SDK boundary casts alone. Do not file every \`as\` on a database row.
     7. **Fuzzy method dispatch**: Flag \`includes\`, \`startsWith\`, or \`endsWith\` on a method or tool name used to choose a handler (including Code Mode recovery synthesizers — natural-language, structured/fuzzy JSON, context-alias hoisting, SQL table allowlists, and negated/disjunctive \`WHERE\` predicates). Quote the token and the name that would take the wrong branch, such as \`listDeletedEntries\` matching \`delete\`. Exact \`Map\` lookup is not fuzzy.
     8. **Accepted-but-ignored parameters**: A schema field is ignored when the handler passes a literal \`undefined\` in its place, or copies the field into a bag that no callee reads (or strips a parsed isolation field inside Code Mode normalization without forwarding it). Quote both sites. A whole parsed object that is forwarded counts as consumed.
     9. **False success**: Flag a \`success: true\` result, or a resolved promise of one, on a path that did not perform the requested operation (including a silently dropped side effect such as a relationship link or vector write that failed inside a \`catch\`, or nested sandbox/worker \`execute_code\` bypassing \`readonly\` mode or workspace bounds). A log line inside the catch does not make it valid; a warning field naming the skipped side effect, or a \`_healing_note\` saying the operation did not run, does. Flag a failed result whose collection reads (\`.entries\`, \`.items\`, \`.deleted\`, \`.issues\`, \`.pullRequests\`) return an empty array, and a filesystem shim that returns true from a substring match. An unmatched SQL translation or unintended write synthesis from a valid JS expression or \`query\` string is High when it runs a mutating tool without explicit write intent. Also ensure external strings are truncated before fencing (never sliced inside \`<untrusted_remote_content>\` wrapper tags). Leave a mapped id lookup alone.
    10. **Sentinel scope & project/workspace isolation** (phrase findings in the target's own terms; names in parentheses are examples only):
        - An explicit stored workspace such as \`default\` is a real workspace and must be pair-checked against its project number; only an omitted workspace means the default. Rewriting it from cwd, keywords, or an env default (e.g. a \`*_WORKSPACE_ID\` variable) before the pair check, or stripping it and saving another workspace or project number, is Critical — including the same substitution inside a generated create-entry argument list.
        - Replacing or dropping a supplied project number (e.g. a later \`explicitProject ?? resolved.projectNumber\` after the resolver already paired the scope, or the resolver itself swapping in the registry number) and saving that row is Critical; the fix is to reject the pair. A resolver or pair-check throw is not a finding, and a caller that only forwards the original workspace and project is not a finding.
        - Prose/tag keyword inference (\`matchRegistryByTagsOrContent\`) must never run on write paths (\`create_entry\`, \`batch_create_entries\`, \`team_create_entry\`, \`team_batch_create_entries\`, SQLite \`crud-write\`), and storage-layer \`pairStoredScope\` is the authoritative backstop — trace the full execution path through ingress/dispatch/storage backstops (\`enforceAccessBoundary\`, \`TOOL_GROUP_SCOPES\` / \`TOOL_SCOPE_OVERRIDES\`, \`createMcpWorkspaceCreateInterceptor\`, dynamic \`tools/list\` & \`tools/call\` filter interceptors, Code Mode \`resolveCodeModeSessionContext\` / \`normalizeDispatchParams\` / \`nested-exec-scope\` / \`worker-script\`, \`rbac\` / \`importer-scope\`, and SQLite \`pairStoredScope\`) and provide a concrete reproducer that actually bypasses them before marking Critical or High. Zero Critical/High findings is valid when backstops hold. Content or tag keywords on resolve helpers that select a different registered project than the active session, the cwd, or an explicit project number are a finding. A session project number counts even when the session workspace is missing or \`default\`, and wins over keyword aliases.
        - Hot-reload listeners must propagate registry/default changes (including cleared fields) to background schedulers and interceptors; sticky per-session context must never be written onto shared long-lived config.
        - A query with no workspace predicate selects every row and is a finding; an omission that becomes the server's configured default is a product note. A resource that rewrites an explicit \`default\` workspace into the cwd project is High.
        - Explicit \`'*'\` on multi-workspace DB queries/admin operations is an intentional override, but a supplied project number must still be applied; flag \`'*'\` manufactured by a fallback after a miss or passed to a single-root filesystem mutation (High). Lookup-then-narrow \`'*'\` (load by id, then use that row's workspace) is acceptable; dropping an already-parsed workspace or project before that lookup is the defect; inspect all secondary entry-creation paths (\`create_github_issue_with_entry\`, \`close_github_issue_with_entry\`, markdown/external importers, Code Mode SQL/JSON recovery creates), pre-dispatch worker/API normalizers, resource URI alias tables (\`RESOURCE_URI_ALIASES\` \`/default\` rewrites), CLI update commands, \`skills/**/SKILL.md\`, \`src/constants/instructions/**\`, and hardcoded \`project_number\` literals in prompts to ensure every path enforces the same workspace/project pair and CWD-isolation invariants as direct MCP tool calls, as well as team RBAC enforcement across MCP resources (\`memory://team/*\`, \`memory://insights/*\`), briefing active-team sections, and MCP prompts.
    11. **Safety gate**: Flag a \`catch\` that logs and then continues a destructive operation, such as a failed backup followed by a prune.`

function buildCodeQualityBody(target: string, copilotInstruction: string, priorAuditSection: string): string {
    return `# Adversarial Code Quality Audit
${buildSharedAuditPreamble(target, 'file or module')}

1. Scan the target for dead code, duplication, type safety, magic values, complexity, boundary validation, monkey-patching, unused variables/exports, unhandled promises, and global scope pollution:
   - **Evidence & Low-Severity Rules**: File dead code, duplication, magic values, unused exports, and floating promises only when you quote them, and count those as **Low**. Ignore illustrative bad-code examples inside audit detector descriptions, but DO audit executable tool calls, API namespaces, and workspace/project attributions generated by prompt templates, \`skills/**/SKILL.md\`, and \`src/constants/instructions/**\`.
   - **Subagent Orchestration**: For a large or full-repository audit, run the baseline scans first — Step 2 (\`SCAN_OK\`) and parent-owned Detector 3 AST scan (\`COMPLEXITY_OK\`) — before spawning parallel read-only subagents partitioned by subsystem (assigning each directory to one subagent), passing the \`SCAN_OK\` result and watch-list files to them. In Cursor use the Task tool (\`explore\` or \`generalPurpose\`); on any other host use that host's read-only subagent tool. Put the parent conversation id in every subagent prompt (or, if unavailable, the audit date, repository name, and prompt revision). Subagents are read-only: no edits, commits, or journal entries. They read full function bodies (not only grep hits), treat a grep-only detector as \`not run\`, skip step 2 scans, mark Detector 3 \`not run\`, trace whether candidate scope/authz/mutation defects bypass ingress interceptors, Code Mode dispatch normalizers, and storage \`pairStoredScope\` with a concrete reproducer before marking Critical or High, and return one coverage line per detector (\`run\`, \`not run\`, or \`nothing found\`) plus at most 8 Moderate and 5 Low ranked findings (path, line number, raw one-line quote, severity, one-sentence fix). The parent runs any detector a subagent skipped before reporting it clean and merges parallel copies of one pattern into one finding that cites both sites.
   - **Severity Calibration**: Cross-workspace mutation or authz bypass bypassing all ingress/dispatch/storage backstops is **Critical**; wrong-tool dispatch, false success, a dropped isolation field reaching execution/storage without backstop rejection, or a file over 500 lines is **High**. If an ingress interceptor or downstream storage boundary (\`enforceAccessBoundary\`, \`createMcpWorkspaceCreateInterceptor\`, dynamic filter interceptors, Code Mode dispatch normalizers, \`rbac\`, or \`pairStoredScope\`) already blocks cross-project persistence, unauthorized access, or read-only mutation, classify upstream defense-in-depth cleanup as **Moderate** or **Low** (zero Critical/High findings is valid when boundaries hold). A primary-key update that already rejects a workspace mismatch is **Moderate**. A database-wide maintenance function with no scope parameter (or optional workspace kept database-wide on purpose) is a product note, not an automatic Critical. Merge one pattern across call sites into one finding before ranking. Assign prompt, instruction, skill, and schema modules so they are not skipped. Prompt or skill templates emitting unexecutable tool calls or hardcoded cross-project attributions are **Moderate** or **Low** (not **Critical** unless executed directly on a live server path).
   - **Parent Verification & Caps**: The parent dedupes a handler that drops a field and the callee branch it reaches into one finding with both lines, re-reads every Critical/High citation (and any cross-workspace, authz, or false-success citation marked Moderate), strips one wrapping backtick pair, and drops any citation whose quote is not a substring of that one physical line. Cap Moderate at 8 and Low at 5 per subsystem (parent table max: 12 Moderate, 8 Low; never cap Critical or High). Record which directories were opened and which detectors found nothing.
   - **Mandatory Deep-Quality Detectors**: Run all 11 detectors on every audit (Detector 3 by the parent only).
${DETECTORS}
2. **Scan for files exceeding 500 lines using two redundant methods.** Run both from the target repository root, scoped to \`src\`, \`scripts\`, and non-test helpers in \`tests\` when those directories exist, or falling back to top-level non-hidden, non-skipped directories when neither exists. Skip test files (\`*.test.*\`, \`*.spec.*\`), benchmark files (\`*.bench.*\`), declaration files (\`*.d.ts\`), and vendored, cache, or build trees (\`.git\`, \`vendor\` including \`src/vendor\`, \`third_party\`, \`node_modules\`, \`dist\`, \`coverage\`, \`build\`, \`.next\`, \`out\`, \`.wrangler\`, \`.turbo\`, \`.output\`, \`.svelte-kit\`, \`.test-output\`) by name before descending, in every detector. Both methods count lines by splitting on \`\\r?\\n\` and dropping one trailing empty segment, match extensions case-sensitively, and must print the same \`SCAN_OK scanned=<n> over500=<n>\` counts plus \`WATCH <lines> <path>\` for each file of 451 to 500 lines. A scan that does not print that line failed; a healer banner before SCAN_OK does not fail it, but scanned=0 does (never treat that as zero files over 500 lines).
   - **Method 1 (Native PowerShell)**:
${SCAN_METHOD_1}
   - **Method 2 (Node/Bun ESM script)**: ${TEMP_SCRIPT_RULE}. The walk can take more than 60 seconds. If \`node\` fails to run, retry with \`bun <file>\` before reporting method 2 as \`not run\`; in either case method 1 stands. Delete the temporary \`.mjs\` scratch file once \`SCAN_OK\` is recorded.
${SCAN_METHOD_2}

> [!IMPORTANT]
> **High Priority — File Size**: Any file exceeding 500 lines is a **High** finding. Files of 451 to 500 lines, function length, and nesting are appendix-only watch items, not High or Moderate findings (unless nesting hides one of the defects above). Do NOT begin refactoring automatically — present them to the user for approval.

3. Group findings by category and severity (**Critical**, **High**, **Moderate**, **Low**).
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. Present a summary table to the user (incorporating Copilot findings if applicable) and await approval. Whenever a planned fix touches a watch-list file already \`>= 470\` lines, include extracting a cohesive helper module in the fix plan so no edit pushes a file over 500 lines. Diagnostic scans in step 2, and read-only lint or typecheck when the target defines them, are part of the audit. **CRITICAL**: Do not edit project files, apply fixes, or commit until the user explicitly approves the implementation plan. Present the plan as markdown in the chat. Do not add an audit plan file to the repository. The plan must be readable in Cursor and in Antigravity.
6. After approval, fix critical issues first, then run the target's lint and typecheck and the tests that cover the change.
7. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

If the Prior code-quality audits section below resolved to \`default\` OR to a fallback/session workspace that does not match the user-named repository, load prior code-quality audits once for the target repository's registered \`workspace_id\` and \`project_number\` by tag \`code-quality-audit\` (not by a hybrid search) in \`readonly: true\` mode; skip re-querying only when entries for the target repository's explicit workspace are already shown below.

${priorAuditSection}`
}

export function getCodeQualityAuditPromptDefinition(): InternalPromptDef {
    return buildAuditPromptDefinition({
        name: 'adversarial-audit-code-quality',
        description:
            'Multi-pass adversarial code quality audit (dead code, type safety, silent failures, workspace isolation, complexity, file size). Optional parameters: target, copilot, workspace_id, project_number',
        tag: 'code-quality-audit',
        heading: 'Prior code-quality audits',
        copilotCommand: (copilotTarget) =>
            `gh copilot -- -p "Perform an exhaustive code quality audit on ${copilotTarget}. Focus on dead code, duplication, type safety, magic values, monkey-patching, and anti-patterns." --allow-all`,
        body: ({ target, copilotInstruction, priorAuditSection }) =>
            buildCodeQualityBody(target, copilotInstruction, priorAuditSection),
    })
}
