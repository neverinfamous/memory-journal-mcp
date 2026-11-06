import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../utils/logger.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { DEFAULT_MODEL, type SemanticSearchResult } from './types.js'
import { rebuildIndex } from './rebuild.js'

function dbPathFromAdapter(adapter: { getDbPath?: () => string }): string | undefined {
    if (typeof adapter.getDbPath !== 'function') {
        return undefined
    }
    return adapter.getDbPath()
}

function resolveEmbeddingCacheDir(dbPath: string | undefined): string {
    const override = process.env['EMBEDDING_CACHE_DIR']
    if (override !== undefined && override !== '') {
        return override
    }
    if (dbPath !== undefined && dbPath !== '') {
        return path.join(path.dirname(dbPath), '.cache', 'huggingface')
    }
    return path.join('.cache', 'huggingface')
}

function isModelCachedOnDisk(cacheDir: string, modelName: string): boolean {
    try {
        const modelParts = modelName.split('/')
        const onnxPath = path.join(cacheDir, ...modelParts, 'onnx', 'model.onnx')
        const configPath = path.join(cacheDir, ...modelParts, 'config.json')
        return fs.existsSync(onnxPath) && fs.existsSync(configPath)
    } catch {
        return false
    }
}

function isTransientFileLockError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes('EPERM') || msg.includes('EBUSY') || msg.includes('EACCES')
}

export class VectorSearchManager {
    private dbAdapter: IDatabaseAdapter
    private modelName: string
    private dimensions: number | null = null
    // Lazy-loaded dependencies
    private pipeline: unknown = null
    private transformers: unknown = null
    private initializationPromise: Promise<void> | null = null

    constructor(dbAdapter: IDatabaseAdapter, options?: { modelName?: string }) {
        this.dbAdapter = dbAdapter
        this.modelName = options?.modelName || DEFAULT_MODEL
    }

    /**
     * Get the active model name
     */
    public getModelName(): string {
        return this.modelName
    }

    /**
     * Get the detected dimensions for the current model
     */
    public getDimensions(): number | null {
        return this.dimensions
    }

    /**
     * Check if the vector search manager is initialized
     */
    public isInitialized(): boolean {
        return this.initializationPromise !== null && (this.pipeline !== null || this.dimensions !== null)
    }

    /**
     * Initialize the vector search manager.
     * This loads the huggingface transformer model and creates the virtual table.
     */
    public async initialize(): Promise<void> {
        if ((this.dbAdapter as unknown) == null) {
            throw new Error('Vector database not available')
        }

        if (this.initializationPromise) {
            return this.initializationPromise
        }

        this.initializationPromise = this._initialize().catch((error: unknown) => {
            this.initializationPromise = null
            throw error
        })
        return this.initializationPromise
    }

    private async _initialize(): Promise<void> {
        try {
            logger.info('Initializing vector search...')

            const hasCustomEmbeddingFn =
                this.generateEmbedding !== VectorSearchManager.prototype.generateEmbedding

            if (hasCustomEmbeddingFn) {
                logger.info('Detecting embedding dimensions via custom embedding generator...')
                const testEmbedding = await this.generateEmbedding('test')
                this.dimensions = testEmbedding.length
                this.pipeline = true
                logger.info(`Detected ${this.dimensions} dimensions for ${this.modelName}`)
            } else {
                // Lazy load transformers
                const cacheDir = resolveEmbeddingCacheDir(dbPathFromAdapter(this.dbAdapter))
                if (this.transformers === null) {
                    const transformersModule = await import('@huggingface/transformers')
                    this.transformers = transformersModule
                    // Configure transformers to use local models directly if already cached on disk,
                    // avoiding concurrent Hub re-validation and model.onnx rename EPERM races on Windows.
                    const cachedLocally = isModelCachedOnDisk(cacheDir, this.modelName)
                    transformersModule.env.allowRemoteModels = !cachedLocally
                    transformersModule.env.cacheDir = cacheDir
                    transformersModule.env.localModelPath = cacheDir
                }

                // Load model (with retry backoff for transient Windows file lock races across processes)
                logger.info(`Loading embedding model: ${this.modelName}`)
                const transformersModule = this.transformers as {
                    pipeline: (task: string, model: string, options: unknown) => Promise<unknown>
                    env: { allowRemoteModels: boolean; cacheDir: string; localModelPath: string }
                }

                const maxAttempts = 5
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        if (isModelCachedOnDisk(cacheDir, this.modelName)) {
                            transformersModule.env.allowRemoteModels = false
                        }
                        this.pipeline = await transformersModule.pipeline(
                            'feature-extraction',
                            this.modelName,
                            {
                                dtype: 'fp32',
                            }
                        )
                        break
                    } catch (pipelineErr) {
                        if (attempt < maxAttempts && isTransientFileLockError(pipelineErr)) {
                            transformersModule.env.allowRemoteModels = true
                            await new Promise((r) => setTimeout(r, 250 * attempt))
                            continue
                        }
                        throw pipelineErr
                    }
                }
                logger.info('Embedding model loaded')

                // Detect dimensions dynamically by doing a test embedding
                logger.info('Detecting embedding dimensions...')
                const pipelineFunc = this.pipeline as (
                    text: string,
                    options: unknown
                ) => Promise<{ data: unknown[] }>
                const testResult = await pipelineFunc('test', { pooling: 'mean', normalize: true })
                this.dimensions = testResult.data.length
                logger.info(`Detected ${this.dimensions} dimensions for ${this.modelName}`)
            }

            // Create/verify table structure
            this.verifyAndCreateVecTable()

            logger.info('Vector search initialized successfully')
        } catch (error) {
            logger.error('Failed to initialize vector search', {
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    /**
     * Verify the vec_journal_entries table exists and has the correct dimensions.
     * If the model or dimensions changed, drops the old table and creates a new one.
     */
    private verifyAndCreateVecTable(): void {
        const dimensions = this.dimensions
        if (dimensions === null) {
            throw new Error('Dimensions not detected. Cannot create vector table.')
        }

        let needsRecreation = false

        try {
            const existingDimStr = this.dbAdapter.getVectorMetadata('dimensions')
            if (existingDimStr) {
                const existingDim = parseInt(existingDimStr, 10)
                if (existingDim !== this.dimensions) {
                    needsRecreation = true
                    logger.info(`Vector model or dimensions changed, dropping old index`, {
                        oldModel: this.dbAdapter.getVectorMetadata('model_name') || 'unknown',
                        newModel: this.modelName,
                        oldDimensions: existingDim,
                        newDimensions: this.dimensions
                    })
                }
            } else {
                needsRecreation = true
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes('no such table')) {
                needsRecreation = true
                logger.warning('Vector metadata table not found, recreating vector index', { error: err })
            } else {
                logger.error('Failed to verify vector table dimensions due to database error', { error: err })
                throw err
            }
        }

        if (needsRecreation) {
            try {
                this.dbAdapter.executeInTransaction(() => {
                    this.dbAdapter.dropVecTable()
                    this.dbAdapter.createVecTable(dimensions)
                    this.dbAdapter.setVectorMetadata('model_name', this.modelName)
                    this.dbAdapter.setVectorMetadata('dimensions', dimensions.toString())
                })
                logger.info(`Created new vec_journal_entries table with ${this.dimensions} dimensions`)
            } catch (err) {
                logger.error('Failed to recreate vector table', { error: err })
                throw err
            }
        }
    }

    /**
     * Generate an embedding for text
     */
    public async generateEmbedding(text: string): Promise<Float32Array> {
        await this.initialize()

        if (this.getDimensions() === null) {
            throw new Error('Vector search not initialized properly. Cannot rebuild index.')
        }

        const pipelineFunc = this.pipeline as (text: string, options: unknown) => Promise<{ data: number[] }>
        const result = await pipelineFunc(text, { pooling: 'mean', normalize: true })
        return new Float32Array(result.data)
    }

    public async addEntry(entry: JournalEntry): Promise<void> {
        await this.initialize()

        try {
            // Text to embed - include entry type and tags for better semantic matching
            const tagsText = entry.tags !== undefined && entry.tags !== null && entry.tags.length > 0 ? ` [Tags: ${entry.tags.join(', ')}]` : ''
            const text = `[${entry.entryType}]${tagsText} ${entry.content}`

            const embedding = await this.generateEmbedding(text)

            this.dbAdapter.upsertVector(entry.id, embedding)
        } catch (error) {
            logger.error(`Failed to add entry ${entry.id} to vector index`, {
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    /**
     * Remove an entry from the vector index
     */
    public removeEntry(entryId: number): boolean {
        if ((this.dbAdapter as unknown) == null) return false;

        try {
            return this.dbAdapter.deleteVector(entryId)
        } catch (error) {
            logger.warning(`Failed to remove entry ${entryId} from vector index`, { error })
            // Non-fatal
            return false;
        }
    }

    /**
     * Search for similar entries by text query
     */
    public async search(
        query: string,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string
    ): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            const queryEmbedding = await this.generateEmbedding(query)

            // searchVectors returns { entry_id: number; distance: number }[]
            const targetWs = workspaceId ?? 'default'
            const results = this.dbAdapter.searchVectors(queryEmbedding, limit, targetWs)

            const candidates: { entryId: number; distance: number; similarityScore: number }[] = []
            for (const result of results) {
                // sqlite-vec MATCH computes L2 distance by default.
                // For normalized unit vectors: L2_distance^2 = 2 - 2 * cosine_similarity
                // Therefore: cosine_similarity = 1 - (L2_distance^2 / 2)
                const similarityScore = Math.max(-1, 1 - (result.distance * result.distance) / 2)
                if (similarityScore >= threshold) {
                    candidates.push({
                        entryId: result.entry_id,
                        distance: result.distance,
                        similarityScore,
                    })
                }
            }

            if (candidates.length === 0) {
                return []
            }

            const entriesMap =
                typeof (this.dbAdapter as { getEntriesByIds?: unknown }).getEntriesByIds ===
                'function'
                    ? this.dbAdapter.getEntriesByIds(candidates.map((c) => c.entryId), targetWs)
                    : null

            const searchResults: SemanticSearchResult[] = []
            for (const candidate of candidates) {
                const entry = entriesMap
                    ? (entriesMap.get(candidate.entryId) ?? null)
                    : this.dbAdapter.getEntryById(candidate.entryId, targetWs)
                if (entry && (targetWs === '*' || entry.workspaceId === targetWs)) {
                    searchResults.push({
                        entryId: candidate.entryId,
                        entry,
                        distance: candidate.distance,
                        score: candidate.similarityScore,
                        similarityScore: candidate.similarityScore,
                    })
                }
                if (searchResults.length >= limit) break
            }

            return searchResults
        } catch (error) {
            logger.error('Semantic search failed', {
                error: error instanceof Error ? error.message : String(error),
                query
            })
            throw error
        }
    }

    /**
     * Search for similar entries using an existing entry as the query
     */
    public async searchByEntryId(
        entryId: number,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string
    ): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            const targetWs = workspaceId ?? 'default'
            const sourceEntry = this.dbAdapter.getEntryById(entryId, targetWs)
            if (!sourceEntry) {
                throw new Error(`Entry ${entryId} not found`)
            }

            let queryEmbedding = this.dbAdapter.getVector(entryId)

            if (!queryEmbedding) {
                const tagsText = sourceEntry.tags !== undefined && sourceEntry.tags !== null && sourceEntry.tags.length > 0 ? ` [Tags: ${sourceEntry.tags.join(', ')}]` : ''
                const text = `[${sourceEntry.entryType}]${tagsText} ${sourceEntry.content}`
                queryEmbedding = await this.generateEmbedding(text)

                // Add it to the index while we're at it
                this.dbAdapter.upsertVector(entryId, queryEmbedding)
            }

            // Search (request limit + 1 to account for the entry itself)
            const results = this.dbAdapter.searchVectors(queryEmbedding, limit + 1, targetWs)

            const candidates: { entryId: number; distance: number; similarityScore: number }[] = []
            for (const result of results) {
                const candidateId = result.entry_id
                if (candidateId === entryId) continue
                const similarityScore = Math.max(-1, 1 - (result.distance * result.distance) / 2)
                if (similarityScore >= threshold) {
                    candidates.push({
                        entryId: candidateId,
                        distance: result.distance,
                        similarityScore,
                    })
                }
            }

            if (candidates.length === 0) {
                return []
            }

            const entriesMap =
                typeof (this.dbAdapter as { getEntriesByIds?: unknown }).getEntriesByIds ===
                'function'
                    ? this.dbAdapter.getEntriesByIds(candidates.map((c) => c.entryId), targetWs)
                    : null

            const searchResults: SemanticSearchResult[] = []
            for (const candidate of candidates) {
                const entry = entriesMap
                    ? (entriesMap.get(candidate.entryId) ?? null)
                    : this.dbAdapter.getEntryById(candidate.entryId, targetWs)
                if (entry && (targetWs === '*' || entry.workspaceId === targetWs)) {
                    searchResults.push({
                        entryId: candidate.entryId,
                        entry,
                        distance: candidate.distance,
                        score: candidate.similarityScore,
                        similarityScore: candidate.similarityScore,
                    })
                }
                if (searchResults.length >= limit) break
            }

            return searchResults
        } catch (error) {
            logger.error(`Semantic search by entry ID ${entryId} failed`, {
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    /**
     * Helper to get vector search statistics
     */
    public getStats(): { itemCount: number; dimensions: number; modelName: string; isReady: boolean } {
        let itemCount = 0
        let isReady = false

        try {
            itemCount = this.dbAdapter.getVectorCount()
            isReady = this.pipeline !== null
        } catch (error) {
            logger.warning('Failed to get vector search stats', { error })
        }

        return {
            itemCount,
            dimensions: this.dimensions ?? 0,
            modelName: this.modelName,
            isReady
        }
    }

    public async rebuildIndex(
        progress?: ProgressContext,
        options?: { force?: boolean; batchSize?: number; pageSize?: number; projectNumber?: number }
    ): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null }> {
        await this.initialize()
        return rebuildIndex(this, this.dbAdapter, progress, options)
    }
}
