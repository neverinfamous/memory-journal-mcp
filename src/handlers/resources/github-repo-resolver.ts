/**
 * Target repository and fallback project resolution for GitHub resources,
 * extracted from `resources/shared.ts` (Appendix A & M3).
 */

import type { GitHubIntegration } from '../../github/github-integration/index.js'
import { getGitHubIntegration } from '../../github/github-integration/index.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../utils/workspace-resolver.js'
import type { BriefingConfig, GitHubRepoResolved, ResourceResult } from './shared.js'

export interface ResolvedTargetGithub {
    github: GitHubIntegration
    expectedOwner?: string
}

/** Resolve the GitHub integration for an explicit `targetRepo`, or a ResourceResult error. */
export function resolveTargetRepoGithub(
    config: BriefingConfig | undefined,
    targetRepo: string,
    runtime: ServerRuntime | undefined,
    lastModified: string
): ResolvedTargetGithub | ResourceResult {
    if (!/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)?$/.test(targetRepo)) {
        return {
            data: { error: 'Invalid repository name format' },
            annotations: { lastModified },
        }
    }
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()

    let expectedOwner: string | undefined
    let registryKey: string | undefined = findCanonicalRegistryKey(targetRepo, registry)
    if (registryKey === undefined) {
        const parts = targetRepo.split('/')
        const ownerPart = parts[0]
        const repoPart = parts[1]
        if (parts.length === 2 && ownerPart !== undefined && repoPart !== undefined) {
            const matchedRepo = findCanonicalRegistryKey(repoPart, registry)
            if (matchedRepo !== undefined) {
                registryKey = matchedRepo
                expectedOwner = ownerPart
            }
        }
    }

    if (registry !== undefined && registryKey !== undefined && Object.hasOwn(registry, registryKey)) {
        const entry = registry[registryKey]
        if (entry && typeof entry.path === 'string' && entry.path.trim() !== '') {
            const github = getGitHubIntegration(entry.path, runtime)
            return expectedOwner !== undefined ? { github, expectedOwner } : { github }
        }
        return {
            data: {
                error: 'GitHub integration not available',
                hint: `Workspace '${registryKey}' has no local repository path configured.`,
            },
            annotations: { lastModified },
        }
    }
    if (targetRepo.trim().toLowerCase() === 'default') {
        return {
            data: { error: 'GitHub integration not available' },
            annotations: { lastModified },
        }
    }
    return {
        data: { error: `Repository not found in registry: ${targetRepo}` },
        annotations: { lastModified },
    }
}

/** Fall back to the first registered project that is a valid git repo (default project first). */
export async function resolveFallbackRegistryRepo(
    config: BriefingConfig | undefined,
    runtime: ServerRuntime | undefined,
    lastModified: string
): Promise<GitHubRepoResolved | undefined> {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (!registry) return undefined
    let fallbackKeys = Object.keys(registry)

    if (config?.defaultProjectNumber !== undefined) {
        const defaultKey = fallbackKeys.find(
            (key) => registry[key]?.project_number === config.defaultProjectNumber
        )
        if (defaultKey) {
            fallbackKeys = [defaultKey, ...fallbackKeys.filter((k) => k !== defaultKey)]
        }
    }

    const probeFallbackAt = async (index: number): Promise<GitHubRepoResolved | undefined> => {
        const key = fallbackKeys[index]
        if (key === undefined) return undefined
        const project = registry[key]
        if (project && typeof project.path === 'string' && project.path.trim() !== '') {
            const fallbackGithub = getGitHubIntegration(project.path, runtime)
            const fallbackRepoInfo = await fallbackGithub.getRepoInfo()
            if (fallbackRepoInfo.owner && fallbackRepoInfo.repo) {
                return {
                    owner: fallbackRepoInfo.owner,
                    repo: fallbackRepoInfo.repo,
                    branch: fallbackRepoInfo.branch ?? null,
                    lastModified,
                    github: fallbackGithub,
                }
            }
        }
        return probeFallbackAt(index + 1)
    }

    return probeFallbackAt(0)
}
