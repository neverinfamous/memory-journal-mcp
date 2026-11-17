import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { assertSafeDirectoryPath } from '../../utils/security-utils.js'
import {
    cwdMatchesRegistryPath,
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../utils/workspace-resolver.js'

export interface GitWorkingDirInput {
    cwd?: string
    repo?: string
    repo_name?: string
    workspace_id?: string
    workspaceId?: string
    project_number?: number | string
    path?: string
}

function hasGitAncestor(dir: string): boolean {
    let current = path.resolve(dir)
    for (let depth = 0; depth < 10; depth++) {
        if (fs.existsSync(path.join(current, '.git'))) return true
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    return false
}

function buildAllowedGitRoots(
    config: ToolHandlerConfig | undefined,
    registry: ToolHandlerConfig['projectRegistry']
): string[] {
    return [
        ...(config?.allowedIoRoots ?? []),
        ...Object.values(registry ?? {})
            .map((entry) => entry.path)
            .filter((entryPath) => entryPath.length > 0),
    ]
}

function formatRegisteredReposHint(registry: ToolHandlerConfig['projectRegistry']): string {
    const keys = Object.keys(registry ?? {})
    return keys.length > 0
        ? `Registered repositories: ${keys.join(', ')}.`
        : 'No repositories are registered in projectRegistry.'
}

export function parseGitProjectNumber(raw: number | string | undefined): number | undefined {
    if (raw === undefined) return undefined
    if (typeof raw === 'string' && raw.trim() === '') return undefined
    const parsed = parsePositiveProjectNumber(raw)
    if (parsed === undefined) {
        throw new ValidationError(
            `Invalid project_number '${String(raw)}': expected a positive integer.`
        )
    }
    return parsed
}

function findMatchedRegistryKey(
    registry: NonNullable<ToolHandlerConfig['projectRegistry']>,
    target: string
): string | undefined {
    return (
        findCanonicalRegistryKey(target, registry) ??
        (Object.prototype.hasOwnProperty.call(registry, target) ? target : undefined) ??
        Object.entries(registry).find(
            ([, entry]) => Boolean(entry.path) && cwdMatchesRegistryPath(entry.path, target)
        )?.[0]
    )
}

export function assertConsistentGitScope(
    registry: ToolHandlerConfig['projectRegistry'],
    pNum: number | undefined,
    trimmedRawTarget: string | undefined,
    target: string | undefined
): void {
    if (!registry || pNum === undefined || trimmedRawTarget === undefined || trimmedRawTarget === '' || trimmedRawTarget === '*') {
        return
    }
    const owners = Object.entries(registry)
        .filter(([, entry]) => entry.project_number === pNum)
        .map(([key]) => key)
    if (trimmedRawTarget.toLowerCase() === 'default' && owners.length > 0) {
        throw new ValidationError(
            `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not 'default'.`
        )
    }
    if (target === undefined || target === '') return
    const matchedKey = findMatchedRegistryKey(registry, target)
    if (matchedKey !== undefined) {
        const registeredProj = registry[matchedKey]?.project_number
        if (registeredProj !== undefined && registeredProj !== pNum) {
            throw new ValidationError(
                `project_number ${String(pNum)} does not match registered project ${String(registeredProj)} for workspace '${matchedKey}'.`
            )
        }
        if (owners.length > 0 && !owners.some((o) => o.toLowerCase() === matchedKey.toLowerCase())) {
            throw new ValidationError(
                `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not '${matchedKey}'.`
            )
        }
    } else if (owners.length > 0) {
        throw new ValidationError(
            `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not '${target}'.`
        )
    }
}

export function resolveExplicitGitTarget(
    target: string | undefined,
    pNum: number | undefined,
    registry: ToolHandlerConfig['projectRegistry'],
    allowedRoots: string[]
): string | undefined {
    if (target !== undefined && target !== '') {
        if (registry) {
            const canonicalKey = findCanonicalRegistryKey(target, registry)
            const entry = canonicalKey !== undefined ? registry[canonicalKey] : registry[target]
            if (entry?.path !== undefined && entry.path !== '' && fs.existsSync(entry.path)) {
                return entry.path
            }
            for (const regEntry of Object.values(registry)) {
                if (regEntry.path !== '' && cwdMatchesRegistryPath(regEntry.path, target) && fs.existsSync(regEntry.path)) {
                    return regEntry.path
                }
            }
        }
        if (fs.existsSync(target) && allowedRoots.length > 0) {
            assertSafeDirectoryPath(target, allowedRoots)
            return target
        }
        throw new ValidationError(
            `Git repository '${target}' did not resolve to an existing path. ${formatRegisteredReposHint(registry)} Pass repo, project_number, or a registered cwd.`
        )
    }
    if (pNum !== undefined && !Number.isNaN(pNum)) {
        for (const entry of Object.values(registry ?? {})) {
            if (entry.project_number === pNum && entry.path !== '' && fs.existsSync(entry.path)) {
                return entry.path
            }
        }
        throw new ValidationError(
            `Git repository for project ${String(pNum)} did not resolve to an existing path. ${formatRegisteredReposHint(registry)}`
        )
    }
    return undefined
}

export function resolveFallbackGitCwd(
    config: ToolHandlerConfig | undefined,
    registry: ToolHandlerConfig['projectRegistry']
): string {
    const currentCwd = process.cwd()
    const defaultWs = config?.defaultWorkspaceId?.trim()
    if (defaultWs !== undefined && defaultWs !== '' && defaultWs !== '*' && defaultWs.toLowerCase() !== 'default') {
        const canonicalKey = registry
            ? (findCanonicalRegistryKey(defaultWs, registry) ??
              (Object.prototype.hasOwnProperty.call(registry, defaultWs) ? defaultWs : undefined))
            : undefined
        const defaultEntry = canonicalKey !== undefined && registry !== undefined ? registry[canonicalKey] : undefined
        if (defaultEntry?.path !== undefined && defaultEntry.path !== '' && fs.existsSync(defaultEntry.path)) {
            return defaultEntry.path
        }
        if (
            hasGitAncestor(currentCwd) &&
            (registry === undefined || path.basename(currentCwd).toLowerCase() === defaultWs.toLowerCase())
        ) {
            return currentCwd
        }
        throw new ValidationError(
            `Configured workspace '${defaultWs}' did not resolve to an existing git repository path. ${formatRegisteredReposHint(registry)}`
        )
    }
    if (hasGitAncestor(currentCwd)) return currentCwd
    for (const entry of Object.values(registry ?? {})) {
        if (entry.path !== '' && cwdMatchesRegistryPath(entry.path, currentCwd) && fs.existsSync(entry.path)) {
            return entry.path
        }
    }
    throw new ValidationError(
        `No git repository found at server cwd (${currentCwd}) and no matching repo, workspace_id, or project_number was resolved. ${formatRegisteredReposHint(registry)} Pass repo, project_number, or cwd.`
    )
}

export function resolveGitWorkingDir(input: GitWorkingDirInput, config?: ToolHandlerConfig): string {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    const rawTarget = input.repo ?? input.repo_name ?? input.workspace_id ?? input.workspaceId
    const trimmedRawTarget = rawTarget?.trim()
    // [INVARIANT] Sentinel workspaces ('default', '*') never name a repository; fall through to project_number.
    const target =
        trimmedRawTarget !== undefined && ['default', '*'].includes(trimmedRawTarget.toLowerCase())
            ? undefined
            : trimmedRawTarget
    const pNum = parseGitProjectNumber(input.project_number)
    assertConsistentGitScope(registry, pNum, trimmedRawTarget, target)
    if (input.cwd !== undefined && input.cwd !== '') {
        const roots = buildAllowedGitRoots(config, registry)
        if (roots.length === 0) {
            throw new Error('Git working directory must be a registered repository path or an allowed I/O root')
        }
        assertSafeDirectoryPath(input.cwd, roots)
        if (!fs.existsSync(input.cwd)) {
            throw new Error(`Git working directory does not exist: ${input.cwd}`)
        }
        if (registry && (pNum !== undefined || target !== undefined)) {
            const cwdMatch = findMatchedRegistryKey(registry, input.cwd)
            if (pNum !== undefined && cwdMatch !== undefined) {
                const regProj = registry[cwdMatch]?.project_number
                if (regProj !== undefined && regProj !== pNum) {
                    throw new ValidationError(
                        `project_number ${String(pNum)} does not match registered project ${String(regProj)} for workspace '${cwdMatch}'.`
                    )
                }
            }
            if (target !== undefined && cwdMatch !== undefined) {
                const targetMatch = findMatchedRegistryKey(registry, target) ?? target
                if (targetMatch.toLowerCase() !== cwdMatch.toLowerCase()) {
                    throw new ValidationError(
                        `cwd '${input.cwd}' (workspace '${cwdMatch}') does not match target workspace '${target}'.`
                    )
                }
            }
        }
        return input.cwd
    }
    if (trimmedRawTarget !== undefined && (trimmedRawTarget === '*' || trimmedRawTarget.toLowerCase() === 'default') && pNum === undefined) {
        throw new ValidationError(
            `workspace_id '${trimmedRawTarget}' cannot identify a git repository without repo, project_number, or cwd. ${formatRegisteredReposHint(registry)}`
        )
    }
    return (
        resolveExplicitGitTarget(target, pNum, registry, buildAllowedGitRoots(config, registry)) ??
        resolveFallbackGitCwd(config, registry)
    )
}
