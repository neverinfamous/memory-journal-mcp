/**
 * Memory Journal MCP Server - Shared factory for `adversarial-audit-*` prompt definitions.
 * [INTENT] Every audit prompt shares argument parsing, target sanitization, the opt-in Copilot
 * step, and the prior-audit section; only the name, tag, Copilot command, and body differ (L1).
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import type { BriefingConfig } from '../resources/shared.js'
import {
    auditArgsSchema,
    AUDIT_ARGUMENTS,
    buildCopilotStep,
    buildPriorAuditSection,
    sanitizeCopilotTarget,
    sanitizePromptTarget,
    validateAdversarialPromptScope,
} from './adversarial-helpers.js'

export const AUDIT_PROMPT_REVISION = '2026-11-18-audit-pass42'

export interface SharedAuditPreambleOptions {
    label?: 'Target' | 'Topic'
    placeholder?: '{target}' | '{topic}'
    actionVerb?: 'Audit' | 'Review'
}

export function buildSharedAuditPreamble(
    target: string,
    targetKind = 'file or module',
    options?: SharedAuditPreambleOptions
): string {
    const label = options?.label ?? 'Target'
    const labelLower = label.toLowerCase()
    const placeholder = options?.placeholder ?? '{target}'
    const actionVerb = options?.actionVerb ?? 'Audit'
    return `Prompt revision: ${AUDIT_PROMPT_REVISION}.
${label}: ${target}

If the ${labelLower} is '${placeholder}', determine it from the user's request. If the user hasn't specified a ${targetKind}, ask them for it now.

This prompt is shared by every project. ${actionVerb} the repository the user named. Do not assume that repository is memory-journal-mcp, and do not copy this server's directory layout, commit script, or parameter-normalizer filenames onto a different codebase. Discover those in the ${labelLower}.

If \`memory://briefing/{repo}\` cannot be read, continue the audit (and use \`memory://agent-context/{repo}\` rather than bare \`memory://agent-id\` for mid-task recovery in multi-project setups). Bind \`workspace_id\` and \`project_number\` only from the registry entry for the repository the user named. If that pair is missing, do not call \`create_entry\` or \`mj.core.createEntry\`. Record the resource failure.`
}

export interface AuditPromptBodyContext {
    target: string
    copilotInstruction: string
    priorAuditSection: string
}

export interface AuditPromptSpec {
    name: string
    description: string
    /** Journal tag used to load prior audits (e.g. `security-audit`). */
    tag: string
    /** Heading of the prior-audit section. */
    heading: string
    /** Builds the opt-in `gh copilot` command for the sanitized target. */
    copilotCommand: (copilotTarget: string) => string
    body: (ctx: AuditPromptBodyContext) => string
}

export function buildAuditPromptDefinition(spec: AuditPromptSpec): InternalPromptDef {
    return {
        name: spec.name,
        description: spec.description,
        icons: [ICON_PROMPT],
        arguments: AUDIT_ARGUMENTS,
        handler: (
            args: Record<string, string> | undefined,
            db: IDatabaseAdapter,
            _teamDb?: IDatabaseAdapter,
            _github?: unknown,
            briefingConfig?: BriefingConfig,
            runtime?: object | null
        ) => {
            const parsed = auditArgsSchema.parse(args ?? {})
            const scope = validateAdversarialPromptScope(
                parsed.workspace_id,
                parsed.project_number,
                briefingConfig,
                parsed.target
            )
            const target = sanitizePromptTarget(parsed.target ?? '{target}')
            const copilotInstruction = buildCopilotStep(
                parsed.copilot === 'true',
                spec.copilotCommand(sanitizeCopilotTarget(target))
            )
            const priorAuditSection = buildPriorAuditSection(
                db,
                spec.tag,
                spec.heading,
                briefingConfig,
                scope.effectiveWorkspaceId,
                parsed.target,
                runtime,
                scope.projectNumber
            )
            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: spec.body({ target, copilotInstruction, priorAuditSection }),
                        },
                    },
                ],
            }
        },
    }
}

/** Shared closing steps for the lighter audit prompts (approval gate + commit rule). */
export function buildStandardAuditClosing(copilotInstruction: string, priorAuditSection: string): string {
    return `2. **External Validation (Copilot — Opt-In)**: ${copilotInstruction}
3. Present findings table (incorporating Copilot findings if applicable).
4. Await approval before applying fixes. Diagnostic scans are part of the audit. Do not edit project files until the user approves the plan.
5. Commit with the target repository's own commit helper when one exists. Discover that helper. Do not invent a script path. Do not add an audit plan file to the repository.
**Rule**: If you don't make changes, do not commit.

${priorAuditSection}`
}
