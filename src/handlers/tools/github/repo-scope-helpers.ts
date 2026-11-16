/**
 * GitHub Tool Scope & Slug Helpers
 *
 * Extracted from `helpers.ts` to enforce strict URL/filesystem path parsing,
 * project-registry scope pairing, and watch-list headroom (<400 lines).
 */

import * as path from 'node:path'
import type { ToolContext } from '../../../types/index.js'
import {
    cwdMatchesRegistryPath,
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveWorkspaceFromFilePath,
} from '../../../utils/workspace-resolver.js'

export interface ParsedRepoSlug {
    owner?: string
    repo?: string
    isFilesystemPath?: boolean
    invalidPath?: boolean
    rawInput?: string
}

type Registry = ReturnType<typeof loadProjectRegistryFromConfig>
export type RegistryEntry = NonNullable<Registry>[string]

export interface RegistryScopeResolution {
    matchedRegistryKey: string | undefined
    registryEntry: RegistryEntry | undefined
    hasRegistry: boolean
    registry: Registry | undefined
    effectiveWorkspaceScope: string | undefined
}

export function githubScopeValidationError(error: string): {
    error: true
    response: Record<string, unknown>
} {
    return {
        error: true,
        response: {
            success: false,
            error,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        },
    }
}

const GITHUB_HTTPS_URL_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i
const GITHUB_SSH_URL_RE = /^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:\/.*)?$/i
const GITHUB_SCP_SSH_RE = /^git@([^:]+):([^/]+)\/([^/\s]+?)(?:\.git)?$/i

/**
 * Parse a `repo` parameter (`owner/repo`, GitHub URL, repo name, or filesystem path)
 * without misinterpreting URLs or relative paths (`./foo`, `../foo`) as `owner/repo`.
 */
export function parseRepoSlug(repo?: string): ParsedRepoSlug {
    if (!repo) return {}
    const trimmed = repo.trim()
    if (trimmed === '') return {}

    const urlMatch =
        GITHUB_HTTPS_URL_RE.exec(trimmed) ??
        GITHUB_SSH_URL_RE.exec(trimmed) ??
        GITHUB_SCP_SSH_RE.exec(trimmed)
    if (urlMatch?.[2] && urlMatch[3]) {
        return {
            owner: urlMatch[2],
            repo: urlMatch[3].replace(/\.git$/i, ''),
            rawInput: trimmed,
        }
    }

    const isFilesystemPath =
        /^[a-zA-Z]:[/\\]|^[/\\]|^\.\.?[/\\]|^\.\.?$/.test(trimmed) || trimmed.includes('\\')
    if (isFilesystemPath) {
        if (/^(?:[a-zA-Z]:[/\\]*|[/\\]+|\.\.?[/\\]*)$/.test(trimmed)) {
            return { isFilesystemPath: true, invalidPath: true, rawInput: trimmed }
        }
        const parts = trimmed.split(/[/\\]/).filter(Boolean)
        const leaf = parts.pop()?.replace(/\.git$/i, '')
        if (!leaf || /^[a-zA-Z]:$/.test(leaf) || leaf === '.' || leaf === '..') {
            return { isFilesystemPath: true, invalidPath: true, rawInput: trimmed }
        }
        return { repo: leaf, isFilesystemPath: true, rawInput: trimmed }
    }

    if (trimmed.includes('/')) {
        const parts = trimmed.split('/').filter(Boolean)
        if (parts.length === 2 && parts[0] && parts[1]) {
            return { owner: parts[0], repo: parts[1].replace(/\.git$/i, ''), rawInput: trimmed }
        }
        const leaf = parts.pop()?.replace(/\.git$/i, '')
        return leaf ? { repo: leaf, rawInput: trimmed } : { repo: trimmed, rawInput: trimmed }
    }

    return { repo: trimmed.replace(/\.git$/i, ''), rawInput: trimmed }
}

/** Resolve project number explicitly or via ProjectRegistry mapping. */
export function resolveProjectNumber(
    context: ToolContext,
    repo: string | undefined,
    explicitProjectNumber?: number | null,
    owner?: string,
    detectedOwner?: string | null
): number | undefined {
    if (explicitProjectNumber != null) return explicitProjectNumber
    const slug = repo !== undefined ? parseRepoSlug(repo) : undefined
    if (slug?.invalidPath === true) return undefined
    const effectiveOwner = owner ?? slug?.owner
    if (
        effectiveOwner !== undefined &&
        detectedOwner !== undefined &&
        detectedOwner !== null &&
        effectiveOwner.toLowerCase() !== detectedOwner.toLowerCase()
    ) {
        return undefined
    }
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (!registry || !repo) return undefined
    const repoName = slug?.repo ?? repo
    const canonicalKey = findCanonicalRegistryKey(repoName, registry) ?? repoName
    if (Object.prototype.hasOwnProperty.call(registry, canonicalKey)) {
        const entry = registry[canonicalKey]
        if (entry?.project_number != null) {
            return entry.project_number
        }
    }
    return undefined
}

function resolveFilesystemRegistryKey(
    slug: ParsedRepoSlug,
    registry: Registry | undefined,
    inputWorkspaceId: string | undefined
): { key: string | undefined } | { error: true; response: Record<string, unknown> } {
    if (slug.invalidPath === true) {
        return githubScopeValidationError(
            `Repository path '${slug.rawInput ?? ''}' is not a valid repository directory.`
        )
    }
    const rawPath = slug.rawInput
    if (rawPath === undefined) return { key: undefined }

    const resolvedAbs = path.resolve(rawPath)
    if (registry !== undefined && Object.keys(registry).length > 0) {
        const pathMatch = resolveWorkspaceFromFilePath(resolvedAbs, { projectRegistry: registry })
        if (pathMatch !== undefined) {
            return { key: pathMatch.workspaceId }
        }
        const leafKey = slug.repo ? findCanonicalRegistryKey(slug.repo, registry) : undefined
        const leafEntry = leafKey !== undefined ? registry[leafKey] : undefined
        if (leafEntry !== undefined) {
            // [INVARIANT] Registered entries with a non-empty path reject foreign clones of the same folder name;
            // path-less registry entries (`path: ""`) only bind when explicit workspace_id confirms intent.
            if (leafEntry.path !== undefined && leafEntry.path.trim() !== '') {
                return githubScopeValidationError(
                    `Repository path '${rawPath}' does not match registered path '${leafEntry.path}' for workspace '${leafKey ?? ''}'.`
                )
            }
            if (
                inputWorkspaceId !== undefined &&
                inputWorkspaceId.trim().toLowerCase() === leafKey?.toLowerCase()
            ) {
                return { key: leafKey }
            }
        }
        return githubScopeValidationError(
            `Repository path '${rawPath}' is not registered in projectRegistry.`
        )
    }

    if (!cwdMatchesRegistryPath(process.cwd(), resolvedAbs)) {
        return githubScopeValidationError(
            `Repository path '${rawPath}' does not match the current workspace directory.`
        )
    }
    return { key: undefined }
}

export function resolveGitHubRegistryScope(
    context: ToolContext,
    effectiveRepo: string | undefined,
    inputWorkspaceId: string | undefined,
    inputProjectNumber: number | undefined,
    slug?: ParsedRepoSlug
): RegistryScopeResolution | { error: true; response: Record<string, unknown> } {
    const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
    let fsMatchedKey: string | undefined
    if (slug?.isFilesystemPath === true) {
        const fsRes = resolveFilesystemRegistryKey(slug, registry, inputWorkspaceId)
        if ('error' in fsRes) return fsRes
        fsMatchedKey = fsRes.key
    }

    const trimmedWs = inputWorkspaceId?.trim()
    const namedDefault = trimmedWs?.toLowerCase() === 'default'
    const concreteWs =
        trimmedWs !== undefined && trimmedWs !== '' && trimmedWs !== '*' && !namedDefault
            ? trimmedWs
            : undefined
    const defaultWsRaw = context.config?.defaultWorkspaceId?.trim()
    const configuredDefaultWs =
        defaultWsRaw !== undefined &&
        defaultWsRaw !== '' &&
        defaultWsRaw !== '*' &&
        defaultWsRaw.toLowerCase() !== 'default'
            ? defaultWsRaw
            : undefined
    const effectiveWorkspaceScope =
        concreteWs ??
        (!effectiveRepo &&
        inputProjectNumber === undefined &&
        trimmedWs !== '*' &&
        !namedDefault
            ? configuredDefaultWs
            : undefined)

    const resolvedRepoName = fsMatchedKey ?? effectiveRepo

    if (registry) {
        const wsKey =
            concreteWs !== undefined ? findCanonicalRegistryKey(concreteWs, registry) : undefined
        const repoKey = resolvedRepoName
            ? findCanonicalRegistryKey(resolvedRepoName, registry)
            : undefined
        if (
            concreteWs !== undefined &&
            resolvedRepoName !== undefined &&
            resolvedRepoName !== '' &&
            (wsKey ?? concreteWs).toLowerCase() !== (repoKey ?? resolvedRepoName).toLowerCase()
        ) {
            return githubScopeValidationError(
                `workspace_id "${concreteWs}" does not match repository "${resolvedRepoName}".`
            )
        }
        if (inputProjectNumber !== undefined) {
            const matches = Object.entries(registry).filter(
                ([, entry]) => entry.project_number === inputProjectNumber
            )
            if (matches.length > 1) {
                return githubScopeValidationError(
                    `project_number ${String(inputProjectNumber)} is registered to more than one workspace.`
                )
            }
            const projectOwner = matches[0]?.[0]
            if (projectOwner !== undefined) {
                if (
                    concreteWs !== undefined &&
                    (wsKey ?? concreteWs).toLowerCase() !== projectOwner.toLowerCase()
                ) {
                    return githubScopeValidationError(
                        `project_number ${String(inputProjectNumber)} belongs to workspace "${projectOwner}", not "${concreteWs}".`
                    )
                }
                if (
                    resolvedRepoName !== undefined &&
                    resolvedRepoName !== '' &&
                    (repoKey ?? resolvedRepoName).toLowerCase() !== projectOwner.toLowerCase()
                ) {
                    return githubScopeValidationError(
                        `project_number ${String(inputProjectNumber)} belongs to workspace "${projectOwner}", not repository "${resolvedRepoName}".`
                    )
                }
            }
            const targetKey = repoKey ?? wsKey
            const registeredProject =
                targetKey !== undefined ? registry[targetKey]?.project_number : undefined
            if (registeredProject !== undefined && registeredProject !== inputProjectNumber) {
                return githubScopeValidationError(
                    `project_number ${String(inputProjectNumber)} does not match registered project ${String(registeredProject)} for workspace "${targetKey ?? ''}".`
                )
            }
        }
    }

    let matchedRegistryKey: string | undefined
    if (!resolvedRepoName && registry) {
        const lookupWs = concreteWs ?? effectiveWorkspaceScope
        if (lookupWs !== undefined) {
            matchedRegistryKey =
                findCanonicalRegistryKey(lookupWs, registry) ??
                (Object.prototype.hasOwnProperty.call(registry, lookupWs) ? lookupWs : undefined)
        }
        if (matchedRegistryKey === undefined && inputProjectNumber !== undefined && !namedDefault) {
            const matches = Object.entries(registry).filter(
                ([, entry]) => entry.project_number === inputProjectNumber
            )
            const matched = matches[0]
            if (matched !== undefined) matchedRegistryKey = matched[0]
        }
    }
    const registryKey =
        fsMatchedKey ??
        (resolvedRepoName
            ? (findCanonicalRegistryKey(resolvedRepoName, registry) ??
              (registry && Object.prototype.hasOwnProperty.call(registry, resolvedRepoName)
                  ? resolvedRepoName
                  : undefined))
            : matchedRegistryKey)
    const registryEntry = registryKey && registry ? registry[registryKey] : undefined
    const hasRegistry = registry !== undefined && Object.keys(registry).length > 0
    return {
        matchedRegistryKey: fsMatchedKey ?? matchedRegistryKey,
        registryEntry,
        hasRegistry,
        registry,
        effectiveWorkspaceScope,
    }
}
