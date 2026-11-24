import { Octokit, graphql } from './octokit-runtime.js'
import type { OctokitClient, OctokitGraphqlFn } from './octokit-types.js'
import * as simpleGitImport from 'simple-git'
import { logger } from '../../utils/logger.js'
import type { RateLimitSnapshot } from './types.js'

export const CACHE_TTL_MS = 5 * 60 * 1000
export const TRAFFIC_CACHE_TTL_MS = 10 * 60 * 1000

export interface CacheEntry<T> {
    data: T
    timestamp: number
    sizeBytes: number
}

type SimpleGitType = typeof simpleGitImport.simpleGit
const simpleGit: SimpleGitType = simpleGitImport.simpleGit

export class GitHubClient {
    public octokit: OctokitClient | null = null
    public graphqlWithAuth: OctokitGraphqlFn | null = null
    public git: simpleGitImport.SimpleGit
    public latestRateLimit: RateLimitSnapshot | null = null

    public readonly apiCache = new Map<string, CacheEntry<unknown>>()
    private totalCacheBytes = 0
    private readonly MAX_CACHE_BYTES = 50 * 1024 * 1024 // 50MB global limit
    private readonly MAX_ENTRY_BYTES = 10 * 1024 * 1024 // 10MB per-item limit

    constructor(workingDir = '.', token?: string) {
        const resolvedToken = token ?? process.env['GITHUB_TOKEN']

        const effectiveDir = workingDir

        const resolvedDir = effectiveDir === '.' ? process.cwd() : effectiveDir
        logger.info('GitHub integration using directory', {
            module: 'GitHub',
            workingDir,
            effectiveDir,
            resolvedDir,
            cwd: process.cwd(),
        })

        // simple-git sets windowsHide: true internally; spawnOptions only accepts uid/gid.
        const gitOptions: Partial<simpleGitImport.SimpleGitOptions> = {
            baseDir: effectiveDir,
        }
        this.git = simpleGit(gitOptions)

        if (resolvedToken) {
            this.octokit = new Octokit({
                auth: resolvedToken,
                request: { timeout: 15_000 },
            })
            
            // Passively capture rate limit state from all REST API responses
            this.octokit.hook.after('request', (response) => {
                const headers = response.headers
                if (headers['x-ratelimit-remaining'] !== undefined) {
                    this.latestRateLimit = {
                        limit: Number(headers['x-ratelimit-limit']),
                        remaining: Number(headers['x-ratelimit-remaining']),
                        used: Number(headers['x-ratelimit-used']),
                        reset: Number(headers['x-ratelimit-reset']),
                        resource: String(headers['x-ratelimit-resource'] ?? 'core'),
                        capturedAt: new Date().toISOString(),
                    }
                }
            })

            this.graphqlWithAuth = graphql.defaults({
                headers: { authorization: `token ${resolvedToken}` },
                request: { timeout: 15_000 },
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

    private normalizeCacheKey(key: string): string {
        return key.toLowerCase()
    }

    getCached(key: string): unknown {
        const normalizedKey = this.normalizeCacheKey(key)
        const entry = this.apiCache.get(normalizedKey)
        if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
            // Map iteration order is insertion order: delete and re-set to make it newest (LRU)
            this.apiCache.delete(normalizedKey)
            this.apiCache.set(normalizedKey, entry)
            return entry.data
        }
        if (entry) {
            this.totalCacheBytes -= entry.sizeBytes
            this.apiCache.delete(normalizedKey)
        }
        return undefined
    }

    getCachedWithTtl(key: string, ttlMs: number): unknown {
        const normalizedKey = this.normalizeCacheKey(key)
        const entry = this.apiCache.get(normalizedKey)
        if (entry && Date.now() - entry.timestamp < ttlMs) {
            // Map iteration order is insertion order: delete and re-set to make it newest (LRU)
            this.apiCache.delete(normalizedKey)
            this.apiCache.set(normalizedKey, entry)
            return entry.data
        }
        if (entry) {
            this.totalCacheBytes -= entry.sizeBytes
            this.apiCache.delete(normalizedKey)
        }
        return undefined
    }

    setCache(key: string, data: unknown): void {
        const normalizedKey = this.normalizeCacheKey(key)
        let sizeBytes: number
        try {
            sizeBytes = Buffer.byteLength(JSON.stringify(data) || '', 'utf8')
        } catch {
            sizeBytes = 1024 // Fallback rough estimate if circular
        }

        if (sizeBytes > this.MAX_ENTRY_BYTES) {
            return // Skip caching items that are too large
        }

        const existing = this.apiCache.get(normalizedKey)
        if (existing) {
            this.totalCacheBytes -= existing.sizeBytes
        }

        this.apiCache.delete(normalizedKey) // Ensure it is inserted at the end of iteration order
        this.apiCache.set(normalizedKey, { data, timestamp: Date.now(), sizeBytes })
        this.totalCacheBytes += sizeBytes

        // Prevent unbounded memory growth (Max 1000 items OR Max 50MB)
        while (this.apiCache.size > 1000 || this.totalCacheBytes > this.MAX_CACHE_BYTES) {
            const oldestKey = this.apiCache.keys().next().value
            if (oldestKey !== undefined) {
                const oldestEntry = this.apiCache.get(oldestKey)
                if (oldestEntry) {
                    this.totalCacheBytes -= oldestEntry.sizeBytes
                }
                this.apiCache.delete(oldestKey)
            } else {
                break
            }
        }
    }

    invalidateCache(prefix: string): void {
        const normalizedPrefix = this.normalizeCacheKey(prefix)
        const boundaryPrefix = normalizedPrefix.endsWith(':')
            ? normalizedPrefix
            : `${normalizedPrefix}:`
        for (const [key, entry] of this.apiCache.entries()) {
            if (key === normalizedPrefix || key.startsWith(boundaryPrefix)) {
                this.totalCacheBytes -= entry.sizeBytes
                this.apiCache.delete(key)
            }
        }
    }

    clearCache(): void {
        this.apiCache.clear()
        this.totalCacheBytes = 0
    }
}
