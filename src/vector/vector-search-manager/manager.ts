import { logger } from '../../utils/logger.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { DEFAULT_MODEL, type SemanticSearchResult } from './types.js'
import { rebuildIndex, verifyVecTableSchema } from './rebuild.js'
import { effectiveWorkspace } from '../../database/workspace-scope.js'
import {
    dbPathFromAdapter,
    isModelCachedOnDisk,
    isTransientFileLockError,
    MODEL_LOAD_RETRY_DELAY_MS,
    resolveEmbeddingCacheDir,
} from './model-cache.js'
import {
    collectCandidates,
    formatEntryForEmbedding,
    resolveCandidates,
    runPipelineBatchEmbeddingsSettled,
    searchSimilarEntriesById,
    type VectorCandidate,
} from './candidate-search.js'

export class VectorSearchManager {
    private dbAdapter: IDatabaseAdapter
    private modelName: string
    private dimensions: number | null = null
    // Lazy-loaded dependencies
    private pipeline: unknown = null
    private transformers: unknown = null
    private initializationPromise: Promise<void> | null = null
    private ready = false

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
        return this.ready
    }

    /**
     * Initialize the vector search manager.
     * This loads the huggingface transformer model and creates the virtual table.
     */
    public async initialize(): Promise<void> {
        // Defensive runtime guard: callers outside the type system (tests, plugins) may omit the adapter.
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

    private async loadDefaultEmbeddingModel(): Promise<void> {
        const cacheDir = resolveEmbeddingCacheDir(dbPathFromAdapter(this.dbAdapter))
        if (this.transformers === null) {
            const transformersModule = await import('@huggingface/transformers')
            this.transformers = transformersModule
            const cachedLocally = isModelCachedOnDisk(cacheDir, this.modelName)
            transformersModule.env.allowRemoteModels = !cachedLocally
            transformersModule.env.cacheDir = cacheDir
            transformersModule.env.localModelPath = cacheDir
        }

        logger.info(`Loading embedding model: ${this.modelName}`)
        const transformersModule = this.transformers as {
            pipeline: (task: string, model: string, options: unknown) => Promise<unknown>
            env: { allowRemoteModels: boolean; cacheDir: string; localModelPath: string }
        }
        this.pipeline = await this.loadPipelineWithRetry(transformersModule, cacheDir)
        logger.info('Embedding model loaded')

        const pipelineFunc = this.pipeline as (
            text: string,
            options: unknown
        ) => Promise<{ data: unknown[] }>
        const testResult = await pipelineFunc('test', { pooling: 'mean', normalize: true })
        this.dimensions = testResult.data.length
        logger.info(`Detected ${this.dimensions} dimensions for ${this.modelName}`)
    }

    private async loadPipelineWithRetry(
        transformersModule: {
            pipeline: (task: string, model: string, options: unknown) => Promise<unknown>
            env: { allowRemoteModels: boolean }
        },
        cacheDir: string
    ): Promise<unknown> {
        const maxAttempts = 5
        let lastError: unknown
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (isModelCachedOnDisk(cacheDir, this.modelName)) {
                    transformersModule.env.allowRemoteModels = false
                }
                return await transformersModule.pipeline('feature-extraction', this.modelName, { dtype: 'fp32' })
            } catch (pipelineErr) {
                lastError = pipelineErr
                if (attempt < maxAttempts && isTransientFileLockError(pipelineErr)) {
                    transformersModule.env.allowRemoteModels = true
                    await new Promise((r) => setTimeout(r, MODEL_LOAD_RETRY_DELAY_MS * attempt))
                    continue
                }
                throw pipelineErr
            }
        }
        throw lastError instanceof Error ? lastError : new Error('Failed to load embedding model')
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
                await this.loadDefaultEmbeddingModel()
            }
            this.verifyAndCreateVecTable()
            this.ready = true
            logger.info('Vector search initialized successfully')
        } catch (error) {
            this.ready = false
            this.pipeline = null
            this.dimensions = null
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
        verifyVecTableSchema(this.dbAdapter, this.modelName, dimensions)
    }

    /** True when subclass/instance overrides `generateEmbedding` or lacks a pipeline function. */
    public hasCustomEmbeddingGenerator(): boolean {
        return (
            this.generateEmbedding !== VectorSearchManager.prototype.generateEmbedding ||
            typeof this.pipeline !== 'function'
        )
    }

    /** Generate an embedding for text. */
    public async generateEmbedding(text: string): Promise<Float32Array> {
        await this.initialize()

        if (this.getDimensions() === null) {
            throw new Error('Vector search not initialized properly. Cannot rebuild index.')
        }

        const pipelineFunc = this.pipeline as (text: string, options: unknown) => Promise<{ data: number[] }>
        const result = await pipelineFunc(text, { pooling: 'mean', normalize: true })
        return new Float32Array(result.data)
    }

    /** Generate settled per-item embeddings for a batch of texts, using tensor batching on the HF pipeline. */
    public async generateEmbeddingsSettled(
        texts: readonly string[]
    ): Promise<PromiseSettledResult<Float32Array>[]> {
        if (texts.length === 0) return []
        await this.initialize()

        const dims = this.getDimensions()
        if (dims === null) {
            throw new Error('Vector search not initialized properly. Cannot rebuild index.')
        }
        if (this.hasCustomEmbeddingGenerator()) {
            const settled: PromiseSettledResult<Float32Array>[] = []
            for (const text of texts) {
                try {
                    settled.push({ status: 'fulfilled', value: await this.generateEmbedding(text) })
                } catch (reason) {
                    settled.push({ status: 'rejected', reason })
                }
            }
            return settled
        }
        return runPipelineBatchEmbeddingsSettled(this.pipeline, texts, dims, (text) =>
            this.generateEmbedding(text)
        )
    }

    /** Generate embeddings for a batch of texts, using tensor batching on the HF pipeline. */
    public async generateEmbeddings(texts: readonly string[]): Promise<Float32Array[]> {
        const settled = await this.generateEmbeddingsSettled(texts)
        return settled.map((item) => {
            if (item.status === 'rejected') throw item.reason
            return item.value
        })
    }

    public async addEntry(entry: JournalEntry): Promise<void> {
        await this.initialize()

        try {
            const embedding = await this.generateEmbedding(formatEntryForEmbedding(entry))
            this.dbAdapter.upsertVector(entry.id, embedding)
        } catch (error) {
            logger.error(`Failed to add entry ${entry.id} to vector index`, {
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    /** Batch-embed and upsert multiple entries in one database transaction. */
    public async addEntries(entries: readonly JournalEntry[]): Promise<void> {
        if (entries.length === 0) return
        if (entries.length === 1 && entries[0] !== undefined) {
            await this.addEntry(entries[0])
            return
        }
        await this.initialize()

        const embeddings = await this.generateEmbeddings(entries.map(formatEntryForEmbedding))
        const items: { entryId: number; embedding: Float32Array }[] = []
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            const embedding = embeddings[i]
            if (entry && embedding) items.push({ entryId: entry.id, embedding })
        }
        if (items.length === 0) return
        if (typeof this.dbAdapter.upsertVectors === 'function') {
            this.dbAdapter.upsertVectors(items)
        } else {
            for (const item of items) this.dbAdapter.upsertVector(item.entryId, item.embedding)
        }
    }

    /** Remove an entry from the vector index. */
    public removeEntry(entryId: number): boolean {
        if ((this.dbAdapter as unknown) == null) return false

        try {
            return this.dbAdapter.deleteVector(entryId)
        } catch (error) {
            logger.warning(`Failed to remove entry ${entryId} from vector index`, { error })
            return false
        }
    }

    /** Return raw vector candidates above `threshold` without hydrating full entries from SQLite. */
    public async searchCandidates(
        query: string,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string,
        projectNumber?: number
    ): Promise<VectorCandidate[]> {
        await this.initialize()

        try {
            const queryEmbedding = await this.generateEmbedding(query)
            const targetWs = effectiveWorkspace(workspaceId)
            const results = this.dbAdapter.searchVectors(
                queryEmbedding,
                limit,
                targetWs,
                projectNumber
            )
            return collectCandidates(results, threshold)
        } catch (error) {
            logger.error('Semantic candidate search failed', {
                error: error instanceof Error ? error.message : String(error),
                query
            })
            throw error
        }
    }

    /** Search for similar entries by text query. */
    public async search(
        query: string,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string,
        projectNumber?: number
    ): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            const queryEmbedding = await this.generateEmbedding(query)
            const targetWs = effectiveWorkspace(workspaceId)
            const results = this.dbAdapter.searchVectors(
                queryEmbedding,
                limit,
                targetWs,
                projectNumber
            )
            const candidates = collectCandidates(results, threshold)
            return resolveCandidates(this.dbAdapter, candidates, limit, targetWs, projectNumber)
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
        workspaceId?: string,
        projectNumber?: number
    ): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            const targetWs = effectiveWorkspace(workspaceId)
            return await searchSimilarEntriesById(
                this.dbAdapter,
                (text) => this.generateEmbedding(text),
                entryId,
                limit,
                threshold,
                targetWs,
                projectNumber
            )
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
    public getStats(): { itemCount: number | null; dimensions: number; modelName: string; isReady: boolean } {
        let itemCount: number | null = null
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
        options?: {
            force?: boolean
            batchSize?: number
            pageSize?: number
            projectNumber?: number
            workspaceId?: string
        }
    ): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null; warning?: string }> {
        await this.initialize()
        if (
            this.dimensions !== null &&
            typeof this.dbAdapter.getVectorMetadata === 'function' &&
            typeof this.dbAdapter.createVecTable === 'function'
        ) {
            this.verifyAndCreateVecTable()
        }
        return rebuildIndex(this, this.dbAdapter, progress, options)
    }
}
