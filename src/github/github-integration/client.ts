import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'
import * as simpleGitImport from 'simple-git'
import { logger } from '../../utils/logger.js'

export const CACHE_TTL_MS = 5 * 60 * 1000
export const TRAFFIC_CACHE_TTL_MS = 10 * 60 * 1000

export interface CacheEntry<T> {
    data: T
    timestamp: number
}

type SimpleGitType = typeof simpleGitImport.simpleGit
const simpleGit: SimpleGitType = simpleGitImport.simpleGit

export class GitHubClient {
    public octokit: Octokit | null = null
    public graphqlWithAuth: typeof graphql | null = null
    public git: simpleGitImport.SimpleGit
    private readonly token: string | undefined

    public readonly apiCache = new Map<string, CacheEntry<unknown>>()

    constructor(workingDir = '.') {
        this.token = process.env['GITHUB_TOKEN']

        const effectiveDir = workingDir

        const resolvedDir = effectiveDir === '.' ? process.cwd() : effectiveDir
        logger.info('GitHub integration using directory', {
            module: 'GitHub',
            workingDir,
            effectiveDir,
            resolvedDir,
            cwd: process.cwd(),
        })

        this.git = simpleGit(effectiveDir)

        if (this.token) {
            this.octokit = new Octokit({ auth: this.token })
            this.graphqlWithAuth = graphql.defaults({
                headers: { authorization: `token ${this.token}` },
            })
            logger.info('GitHub integration initialized with token', { module: 'GitHub' })
        } else {
            logger.info('GitHub integration initialized without token (limited functionality)', {
                module: 'GitHub',
            })
        }
    }

    isApiAvailable(): boolean {
        return this.octokit !== null
    }

    getCached(key: string): unknown {
        const entry = this.apiCache.get(key)
        if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
            // Map iteration order is insertion order: delete and re-set to make it newest (LRU)
            this.apiCache.delete(key)
            this.apiCache.set(key, entry)
            return entry.data
        }
        if (entry) {
            this.apiCache.delete(key)
        }
        return undefined
    }

    getCachedWithTtl(key: string, ttlMs: number): unknown {
        const entry = this.apiCache.get(key)
        if (entry && Date.now() - entry.timestamp < ttlMs) {
            // Map iteration order is insertion order: delete and re-set to make it newest (LRU)
            this.apiCache.delete(key)
            this.apiCache.set(key, entry)
            return entry.data
        }
        if (entry) {
            this.apiCache.delete(key)
        }
        return undefined
    }

    setCache(key: string, data: unknown): void {
        this.apiCache.delete(key) // Ensure it is inserted at the end of iteration order
        this.apiCache.set(key, { data, timestamp: Date.now() })

        // Prevent unbounded memory growth (Max 100 items)
        if (this.apiCache.size > 100) {
            const oldestKey = this.apiCache.keys().next().value
            if (oldestKey !== undefined) {
                this.apiCache.delete(oldestKey)
            }
        }
    }

    invalidateCache(prefix: string): void {
        for (const key of this.apiCache.keys()) {
            if (key.startsWith(prefix)) {
                this.apiCache.delete(key)
            }
        }
    }

    clearCache(): void {
        this.apiCache.clear()
    }
}
