/**
 * Memory Journal MCP Server - `adversarial-audit-code-quality` prompt definition.
 * [INTENT] Extracted from `adversarial.ts` (L1) so the long detector catalog can evolve without
 * pushing the shared prompt module past the 500-line ceiling.
 */

import type { InternalPromptDef } from './index.js'
import { buildAuditPromptDefinition } from './adversarial-audit-factory.js'

export const CODE_QUALITY_PROMPT_REVISION = '2026-11-13-audit-pass21'

const SCAN_METHOD_1 = `     \`\`\`powershell
     $skip = @('vendor','third_party','node_modules','dist','coverage','build','.next','out')
     $n = 0
     $over = 0
     function Walk($dir) {
       if (-not (Test-Path -LiteralPath $dir)) { return }
       foreach ($item in (Get-ChildItem -LiteralPath $dir -Force)) {
         if ($skip -contains $item.Name) { continue }
         if ($item.PSIsContainer) { Walk $item.FullName; continue }
         if ($item.Name -cmatch '\\.(ts|tsx|js|mjs|cjs)$' -and $item.Name -cnotmatch '\\.(test|spec)\\.') {
           $script:n++
           $parts = [System.IO.File]::ReadAllText($item.FullName) -split '\\r?\\n'
           $lines = $parts.Length
           if ($lines -gt 0 -and $parts[$lines - 1] -eq '') { $lines-- }
           if ($lines -gt 500) { $script:over++; Write-Output ($lines.ToString() + ' ' + $item.FullName) }
          elseif ($lines -ge 451) { Write-Output ('WATCH ' + $lines.ToString() + ' ' + $item.FullName) }
         }
       }
     }
     Walk 'src'
     Walk 'scripts'
     Write-Output ('SCAN_OK scanned=' + $n + ' over500=' + $over)
     \`\`\``

const SCAN_METHOD_2 = `     \`\`\`javascript
import {readdirSync as r,statSync as s,readFileSync as f} from 'fs';import {join as j} from 'path';const skip=new Set(['vendor','third_party','node_modules','dist','coverage','build','.next','out']);let n=0,over=0;function w(d){if(!s(d,{throwIfNoEntry:false}))return;for(const x of r(d)){if(skip.has(x))continue;const p=j(d,x);if(s(p).isDirectory())w(p);else if(/\\.(ts|tsx|js|mjs|cjs)$/.test(x)&&!/\\.(test|spec)\\./.test(x)){n++;const parts=f(p,'utf8').split(/\\r?\\n/);const l=parts.length>0&&parts[parts.length-1]===''?parts.length-1:parts.length;if(l>500){over++;console.log(l,p)}else if(l>=451)console.log('WATCH',l,p)}}}}w('src');w('scripts');console.log('SCAN_OK scanned='+n+' over500='+over);
     \`\`\``

const TEMP_SCRIPT_RULE =
    "write the script to a temporary `.mjs` file in the session's scratch/temp directory outside the repository and run `bun <file>` with the repository as the working directory (never an inline `bun -e` here-string, which Windows execution proxies rewrite)"

const DETECTORS = `     1. **Silent Catch Block Detector**: Find every \`catch\` in production source, including \`catch (e)\` and multiline catches. A catch is silent when its body does not log, rethrow, or return a structured error. Quote the body. Keep intentional best-effort fallbacks out of the table. Do not flag a catch that returns the project's structured handler error.
     2. **Cross-Platform Path Separator Assumption Detector**: Flag filesystem prefix checks (\`startsWith\` / \`endsWith\` on a resolved path without a separator boundary) and hardcoded \`'\\\\'\` or \`'/'\` used to test real filesystem paths. Prefer \`path.relative()\` and \`path.sep\`. Ignore URL, route, glob, and SQL slashes. Case-fold only on Windows.
     3. **Cognitive Complexity & Nesting Hotspot Scan (parent-owned)**: Flag functions over 80 lines or control-flow nesting deeper than 4, measured by a script, not by eye (for example the TypeScript compiler API via \`createRequire(path.join(process.cwd(), 'package.json'))('typescript')\` over \`path.join(process.cwd(), 'src')\`, skipping \`vendor\` and \`third_party\`). To run it, ${TEMP_SCRIPT_RULE}. The script must print \`COMPLEXITY_OK files=<n> over80=<n> nestgt4=<n>\`; a script that does not print that line failed. Count an else-if chain, and a chained conditional (\`a ? b : c ? d : e\`), as one decision. Measure inner handlers and real helpers, not registration factories whose body is a table of tool, prompt, resource, route, or schema definitions; such a factory over 450 lines is a watch item, even when its file exceeds 500 lines.
     4. **Schema-to-Handler Parameter Drift Check**: Every input-schema property is consumed by the handler or rewritten by that project's own parameter-normalization layer. Do not assume a file named \`param-normalizer.ts\` exists. Quote the schema field and the handler or normalizer read. Ignore fields that are forwarded as a whole parsed object.
     5. **Uncleaned Timer / EventListener Detector**: Flag \`setInterval\`, retained \`setTimeout\` handles, \`fs.watch\`, and \`process\` / server / filesystem / worker \`.on(\` registrations that lack \`unref()\`, \`clear*\`, or \`close()\` / \`finally\` cleanup. An awaited one-shot delay is not a leak.
     6. **Type-safety Detector**: Flag \`any\`, \`as any\`, \`z.any()\` in Zod schemas (unless explicitly documented for arbitrary untrusted JSON passthrough), TypeScript postfix non-null assertions (\`value!\`), definite assignment (\`!:\`), and a double assertion (\`as unknown as\`) that reads a property the source type does not declare. Ignore GraphQL \`Type!\`, \`!=\`, and \`!condition\`. Leave SDK boundary casts alone. Do not file every \`as\` on a database row.
     7. **Fuzzy method dispatch**: Flag \`includes\`, \`startsWith\`, or \`endsWith\` on a method or tool name used to choose a handler. Quote the token and the name that would take the wrong branch, such as \`listDeletedEntries\` matching \`delete\`. Exact \`Map\` lookup is not fuzzy.
     8. **Accepted-but-ignored parameters**: A schema field is ignored when the handler passes a literal \`undefined\` in its place, or copies the field into a bag that no callee reads. Quote both sites. A whole parsed object that is forwarded counts as consumed.
     9. **False success**: Flag a \`success: true\` result, or a resolved promise of one, on a path that did not perform the requested operation (including a silently dropped side effect such as a relationship link or vector write that failed inside a \`catch\`). A log line inside the catch does not make it valid; a warning field naming the skipped side effect, or a \`_healing_note\` saying the operation did not run, does. Flag a failed result whose collection reads (\`.entries\`, \`.items\`, \`.deleted\`, \`.issues\`, \`.pullRequests\`) return an empty array, and a filesystem shim that returns true from a substring match. An unmatched SQL translation is High only when it runs a different tool and has no healing note. Leave a mapped id lookup alone.
    10. **Sentinel scope & project/workspace isolation** (phrase findings in the target's own terms; names in parentheses are examples only):
        - An explicit stored workspace such as \`default\` is a real workspace and must be pair-checked against its project number; only an omitted workspace means the default. Rewriting it from cwd, keywords, or an env default (e.g. a \`*_WORKSPACE_ID\` variable) before the pair check, or stripping it and saving another workspace or project number, is Critical — including the same substitution inside a generated create-entry argument list.
        - Replacing or dropping a supplied project number (e.g. a later \`explicitProject ?? resolved.projectNumber\` after the resolver already paired the scope, or the resolver itself swapping in the registry number) and saving that row is Critical; the fix is to reject the pair. A resolver or pair-check throw is not a finding, and a caller that only forwards the original workspace and project is not a finding.
        - Content or tag keywords that select a different registered project than the active session, the cwd, or an explicit project number are a finding. A session project number counts even when the session workspace is missing or \`default\`, and wins over keyword aliases.
        - Hot-reload listeners must propagate registry/default changes (including cleared fields) to background schedulers and interceptors; sticky per-session context must never be written onto shared long-lived config.
        - A query with no workspace predicate selects every row and is a finding; an omission that becomes the server's configured default is a product note. A resource that rewrites an explicit \`default\` workspace into the cwd project is High.
        - Explicit \`'*'\` on multi-workspace DB queries/admin operations is an intentional override, but a supplied project number must still be applied; flag \`'*'\` manufactured by a fallback after a miss or passed to a single-root filesystem mutation (High). Lookup-then-narrow \`'*'\` (load by id, then use that row's workspace) is acceptable; dropping an already-parsed workspace or project before that lookup is the defect.
    11. **Safety gate**: Flag a \`catch\` that logs and then continues a destructive operation, such as a failed backup followed by a prune.`

function buildCodeQualityBody(target: string, copilotInstruction: string, priorAuditSection: string): string {
    return `# Adversarial Code Quality Audit
Prompt revision: ${CODE_QUALITY_PROMPT_REVISION}.
Target: ${target}

If the target is '{target}', determine it from the user's request. If the user hasn't specified a target file or module, ask them for it now.

This prompt is shared by every project. Audit the repository the user named. Do not assume that repository is memory-journal-mcp, and do not copy this server's directory layout, commit script, or parameter-normalizer filenames onto a different codebase. Discover those in the target.

If \`memory://briefing/{repo}\` cannot be read, continue the audit. Bind \`workspace_id\` and \`project_number\` only from the registry entry for the repository the user named. If that pair is missing, do not call \`create_entry\`. Record the resource failure.

1. Scan the target for dead code, duplication, type safety, magic values, complexity, boundary validation, monkey-patching, unused variables/exports, unhandled promises, and global scope pollution:
   - **Evidence & Low-Severity Rules**: File dead code, duplication, magic values, unused exports, and floating promises only when you quote them, and count those as **Low**. Ignore samples that exist only inside prompt template strings in every detector.
   - **Subagent Orchestration**: For a large or full-repository audit, run step 2 first and pass the \`SCAN_OK\` result to parallel read-only subagents partitioned by subsystem (assigning each directory to one subagent). In Cursor use the Task tool (\`explore\` or \`generalPurpose\`); on any other host use that host's read-only subagent tool. Put the parent conversation id in every subagent prompt (or, if unavailable, the audit date, repository name, and prompt revision). Subagents are read-only: no edits, commits, or journal entries. They read full function bodies (not only grep hits), treat a grep-only detector as \`not run\`, skip step 2 scans, mark Detector 3 \`not run\`, and return one coverage line per detector (\`run\`, \`not run\`, or \`nothing found\`) plus at most 8 Moderate and 5 Low ranked findings (path, line number, raw one-line quote, severity, one-sentence fix). The parent runs any detector a subagent skipped before reporting it clean and merges parallel copies of one pattern into one finding that cites both sites.
   - **Severity Calibration**: Cross-workspace mutation is **Critical**; wrong-tool dispatch, false success, a dropped isolation field, or a file over 500 lines is **High**. A primary-key update that already rejects a workspace mismatch is **Moderate**. A database-wide maintenance function with no scope parameter (or optional workspace kept database-wide on purpose) is a product note, not an automatic Critical. Merge one pattern across call sites into one finding before ranking. Assign prompt and schema modules so they are not skipped.
   - **Parent Verification & Caps**: The parent dedupes a handler that drops a field and the callee branch it reaches into one finding with both lines, re-reads every Critical/High citation (and any cross-workspace, authz, or false-success citation marked Moderate), strips one wrapping backtick pair, and drops any citation whose quote is not a substring of that one physical line. Cap Moderate at 8 and Low at 5 per subsystem (parent table max: 12 Moderate, 8 Low; never cap Critical or High). Record which directories were opened and which detectors found nothing.
   - **Mandatory Deep-Quality Detectors**: Run all 11 detectors on every audit (Detector 3 by the parent only).
${DETECTORS}
2. **Scan for files exceeding 500 lines using two redundant methods.** Run both from the target repository root, scoped to \`src\` and \`scripts\` when those directories exist (\`src\` only if \`scripts\` is absent). Skip test files and vendored or build trees (\`vendor\`, \`src/vendor\`, \`third_party\`, \`node_modules\`, \`dist\`, \`coverage\`, \`build\`, \`.next\`, \`out\`) by name before descending, in every detector. Both methods count lines by splitting on \`\\r?\\n\` and dropping one trailing empty segment, match extensions case-sensitively, and must print the same \`SCAN_OK scanned=<n> over500=<n>\` counts plus \`WATCH <lines> <path>\` for each file of 451 to 500 lines. A scan that does not print that line failed; a healer banner before SCAN_OK does not fail it, but scanned=0 does (never treat that as zero files over 500 lines).
   - **Method 1 (Native PowerShell)**:
${SCAN_METHOD_1}
   - **Method 2 (Bun file)**: ${TEMP_SCRIPT_RULE}. Do not pass it to \`node\`. The walk can take more than 60 seconds. If \`bun\` is unavailable or the script does not print \`SCAN_OK\`, report method 2 as \`not run\` and method 1 stands.
${SCAN_METHOD_2}

> [!IMPORTANT]
> **High Priority — File Size**: Any file exceeding 500 lines is a **High** finding. Files of 451 to 500 lines, function length, and nesting are appendix-only watch items, not High or Moderate findings (unless nesting hides one of the defects above). Do NOT begin refactoring automatically — present them to the user for approval.

3. Group findings by category and severity (**Critical**, **High**, **Moderate**, **Low**).
4. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
5. Present a summary table to the user (incorporating Copilot findings if applicable) and await approval. Diagnostic scans in step 2, and read-only lint or typecheck when the target defines them, are part of the audit. **CRITICAL**: Do not edit project files, apply fixes, or commit until the user explicitly approves the implementation plan. Present the plan as markdown in the chat. Do not add an audit plan file to the repository. The plan must be readable in Cursor and in Antigravity.
6. After approval, fix critical issues first, then run the target's lint and typecheck and the tests that cover the change.
7. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

Load prior code-quality audits by the tag \`code-quality-audit\`, not by a hybrid search for that phrase.

${priorAuditSection}`
}

export function getCodeQualityAuditPromptDefinition(): InternalPromptDef {
    return buildAuditPromptDefinition({
        name: 'adversarial-audit-code-quality',
        description:
            'Multi-pass adversarial code quality audit (dead code, type safety, silent failures, workspace isolation, complexity, file size). Optional parameters: target, copilot, workspace_id',
        tag: 'code-quality-audit',
        heading: 'Prior code-quality audits',
        copilotCommand: (copilotTarget) =>
            `gh copilot -- -p "Perform an exhaustive code quality audit on ${copilotTarget}. Focus on dead code, duplication, type safety, magic values, monkey-patching, and anti-patterns." --allow-all`,
        body: ({ target, copilotInstruction, priorAuditSection }) =>
            buildCodeQualityBody(target, copilotInstruction, priorAuditSection),
    })
}
