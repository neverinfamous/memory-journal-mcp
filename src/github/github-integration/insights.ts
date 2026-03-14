import { logger } from '../../utils/logger.js'
import { TRAFFIC_CACHE_TTL_MS } from './client.js'
import type { GitHubClient } from './client.js'
import type { RepoStats, TrafficData, TrafficReferrer, PopularPath } from '../../types/index.js'

export class InsightsManager {
    constructor(private client: GitHubClient) {}

    async getRepoStats(owner: string, repo: string): Promise<RepoStats | null> {
        if (!this.client.octokit) {
            return null
        }

        const cacheKey = `repostats:${owner}:${repo}`
        const cached = this.client.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | RepoStats
            | undefined
        if (cached) return cached

        try {
            const response = await this.client.octokit.repos.get({ owner, repo })
            const data = response.data

            const result: RepoStats = {
                stars: data.stargazers_count,
                forks: data.forks_count,
                watchers: data.subscribers_count,
                openIssues: data.open_issues_count,
                size: data.size,
                defaultBranch: data.default_branch,
            }

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get repo stats', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return null
        }
    }

    async getTrafficData(owner: string, repo: string): Promise<TrafficData | null> {
        if (!this.client.octokit) {
            return null
        }

        const cacheKey = `traffic:${owner}:${repo}`
        const cached = this.client.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | TrafficData
            | undefined
        if (cached) return cached

        try {
            const [clonesRes, viewsRes] = await Promise.all([
                this.client.octokit.rest.repos.getClones({ owner, repo }),
                this.client.octokit.rest.repos.getViews({ owner, repo }),
            ])

            const clonesDays = clonesRes.data.clones?.length ?? 0
            const viewsDays = viewsRes.data.views?.length ?? 0

            const result: TrafficData = {
                clones: {
                    total: clonesRes.data.count,
                    unique: clonesRes.data.uniques,
                    dailyAvg: clonesDays > 0 ? Math.round(clonesRes.data.count / clonesDays) : 0,
                },
                views: {
                    total: viewsRes.data.count,
                    unique: viewsRes.data.uniques,
                    dailyAvg: viewsDays > 0 ? Math.round(viewsRes.data.count / viewsDays) : 0,
                },
                period: '14 days',
            }

            this.client.setCache(cacheKey, result)
            return result
        } catch (error) {
            logger.error('Failed to get traffic data', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return null
        }
    }

    async getTopReferrers(owner: string, repo: string, limit = 5): Promise<TrafficReferrer[]> {
        if (!this.client.octokit) {
            return []
        }

        const cacheKey = `referrers:${owner}:${repo}`
        const cached = this.client.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | TrafficReferrer[]
            | undefined
        if (cached) return cached.slice(0, limit)

        try {
            const response = await this.client.octokit.rest.repos.getTopReferrers({ owner, repo })

            const result: TrafficReferrer[] = response.data.map((r) => ({
                referrer: r.referrer,
                count: r.count,
                uniques: r.uniques,
            }))

            this.client.setCache(cacheKey, result)
            return result.slice(0, limit)
        } catch (error) {
            logger.error('Failed to get top referrers', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return []
        }
    }

    async getPopularPaths(owner: string, repo: string, limit = 5): Promise<PopularPath[]> {
        if (!this.client.octokit) {
            return []
        }

        const cacheKey = `paths:${owner}:${repo}`
        const cached = this.client.getCachedWithTtl(cacheKey, TRAFFIC_CACHE_TTL_MS) as
            | PopularPath[]
            | undefined
        if (cached) return cached.slice(0, limit)

        try {
            const response = await this.client.octokit.rest.repos.getTopPaths({ owner, repo })

            const result: PopularPath[] = response.data.map((p) => ({
                path: p.path,
                title: p.title,
                count: p.count,
                uniques: p.uniques,
            }))

            this.client.setCache(cacheKey, result)
            return result.slice(0, limit)
        } catch (error) {
            logger.error('Failed to get popular paths', {
                module: 'GitHub',
                error: error instanceof Error ? error.message : String(error),
                context: { owner, repo },
            })
            return []
        }
    }
}
