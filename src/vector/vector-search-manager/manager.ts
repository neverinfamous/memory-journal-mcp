import { logger } from '../../utils/logger.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { DEFAULT_MODEL, type SemanticSearchResult } from './types.js'
import { rebuildIndex, verifyVecTableSchema } from './rebuild.js'
import { effectiveWorkspace } from '../../database/workspace-scope.js'
import type { TransformersPipelineModule } from './model-cache.js'
import {
    resolveCandidates,
    runEntryIdVectorLookup,
    runVectorCandidateQuery,
    type VectorCandidate,
} from './candidate-search.js'
import {
    DISPOSED_MANAGER_ERROR,
    disposePipelineHandle,
    drainVectorPendingState,
    filterLiveVectorsForUpsert,
    flushPendingVectorRemovals,
    generateValidatedBatchEmbeddingsSettled,
    generateValidatedSingleEmbedding,
    isEntryLiveForVectorUpsert,
    loadDefaultEmbeddingSession,
    runAddBatchVectorEntries,
    runAddSingleVectorEntry,
    trackVectorRead,
    withModelLoadLock,
} from './lifecycle-helpers.js'

const MAX_VECTOR_SEARCH_LIMIT = 10_000

export class VectorSearchManager {
    private dbAdapter: IDatabaseAdapter
    private modelName: string
    private dimensions: number | null = null
    // Lazy-loaded dependencies
    private pipeline: unknown = null
    private transformers: TransformersPipelineModule | null = null
    private initializationPromise: Promise<void> | null = null
    private writeTail: Promise<void> = Promise.resolve()
    private pendingMutationCount = 0
    private rebuildActiveCount = 0
    private readonly pendingRemovedIds = new Set<number>()
    private activeReads: Set<Promise<unknown>> | undefined = new Set()
    private disposed = false
    private ready = false

    constructor(dbAdapter: IDatabaseAdapter, options?: { modelName?: string | undefined }) {
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
        return this.ready && !this.disposed
    }

    /** Check whether `dispose()` has been initiated on this manager. */
    public isDisposed(): boolean {
        return this.disposed
    }

    /** Record concurrent entry deletions so in-flight writes do not resurrect stale vectors. */
    public markRemoved(entryIds: number | readonly number[]): void {
        if (this.disposed || (this.pendingMutationCount === 0 && this.rebuildActiveCount === 0)) {
            return
        }
        if (typeof entryIds === 'number') {
            this.pendingRemovedIds.add(entryIds)
            return
        }
        for (const id of entryIds) {
            this.pendingRemovedIds.add(id)
        }
    }

    /** Filter out tombstoned or SQLite-deleted entries immediately prior to batch vector upsert. */
    public filterLiveVectors(
        items: readonly { entryId: number; embedding: Float32Array }[]
    ): { entryId: number; embedding: Float32Array }[] {
        if (this.disposed) return []
        return filterLiveVectorsForUpsert(this.dbAdapter, items, this.pendingRemovedIds)
    }

    /**
     * Initialize the vector search manager.
     * This loads the huggingface transformer model and creates the virtual table.
     */
    public async initialize(): Promise<void> {
        if (this.disposed) {
            throw new Error(DISPOSED_MANAGER_ERROR)
        }
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
        return withModelLoadLock(async () => {
            this.dimensions = await loadDefaultEmbeddingSession(
                this.dbAdapter,
                this.modelName,
                this.transformers,
                (mod) => {
                    this.transformers = mod
                },
                (pipeline) => {
                    this.pipeline = pipeline
                }
            )
        })
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
            if (this.disposed) {
                throw new Error(DISPOSED_MANAGER_ERROR)
            }
            this.verifyAndCreateVecTable()
            if (this.disposed) {
                throw new Error(DISPOSED_MANAGER_ERROR)
            }
            this.ready = true
            logger.info('Vector search initialized successfully')
        } catch (error) {
            const failedPipeline = this.pipeline
            this.ready = false
            this.pipeline = null
            this.dimensions = null
            await disposePipelineHandle(failedPipeline)
            logger.error('Failed to initialize vector search', {
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    /** Latch disposed state synchronously, drain pending init/mutations/reads, and dispose ONNX pipeline. */
    public async dispose(timeoutMs = 5_000): Promise<void> {
        this.disposed = true
        await drainVectorPendingState(
            () => ({
                init: this.initializationPromise,
                tail: this.writeTail,
                reads: this.activeReads !== undefined ? [...this.activeReads] : [],
                isUnchanged: (init, tail) =>
                    this.initializationPromise === init &&
                    this.writeTail === tail &&
                    (this.activeReads === undefined || this.activeReads.size === 0),
            }),
            timeoutMs
        )
        const pipelineToDispose = this.pipeline
        this.pipeline = null
        this.ready = false
        this.dimensions = null
        this.initializationPromise = null
        this.pendingRemovedIds.clear()
        await disposePipelineHandle(pipelineToDispose)
    }

    private verifyAndCreateVecTable(): void {
        if (this.dimensions === null) {
            throw new Error('Dimensions not detected. Cannot create vector table.')
        }
        verifyVecTableSchema(this.dbAdapter, this.modelName, this.dimensions)
    }

    /** True when subclass/instance overrides `generateEmbedding` or lacks a pipeline function. */
    public hasCustomEmbeddingGenerator(): boolean {
        return (
            this.generateEmbedding !== VectorSearchManager.prototype.generateEmbedding ||
            typeof this.pipeline !== 'function'
        )
    }

    /** Generate an embedding for text. */
    public generateEmbedding(
        text: string,
        options?: { bypassQueryCache?: boolean }
    ): Promise<Float32Array> {
        return this.trackRead(() =>
            generateValidatedSingleEmbedding({
                text,
                modelName: this.modelName,
                bypassQueryCache: options?.bypassQueryCache === true,
                hasCustomGenerator: this.hasCustomEmbeddingGenerator(),
                hasTransformers: this.transformers !== null,
                initialize: () => this.initialize(),
                getDimensions: () => this.getDimensions(),
                getPipeline: () => this.pipeline,
                isDisposed: () => this.disposed,
            })
        )
    }

    /** Generate settled per-item embeddings for a batch of texts, using tensor batching on the HF pipeline. */
    public generateEmbeddingsSettled(
        texts: readonly string[]
    ): Promise<PromiseSettledResult<Float32Array>[]> {
        if (texts.length === 0) return Promise.resolve([])
        return this.trackRead(() =>
            generateValidatedBatchEmbeddingsSettled({
                texts,
                hasCustomGenerator: this.hasCustomEmbeddingGenerator(),
                initialize: () => this.initialize(),
                getDimensions: () => this.getDimensions(),
                getPipeline: () => this.pipeline,
                isDisposed: () => this.disposed,
                generateSingle: (text) => this.generateEmbedding(text, { bypassQueryCache: true }),
            })
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

    public addEntry(entry: JournalEntry): Promise<void> {
        if (this.disposed) return Promise.reject(new Error(DISPOSED_MANAGER_ERROR))
        this.pendingRemovedIds.delete(entry.id)
        return this.enqueueMutation(() =>
            runAddSingleVectorEntry({
                entry,
                dbAdapter: this.dbAdapter,
                pendingRemovedIds: this.pendingRemovedIds,
                isDisposed: () => this.disposed,
                initialize: () => this.initialize(),
                generateEmbedding: (text) =>
                    this.generateEmbedding(text, { bypassQueryCache: true }),
            })
        )
    }

    /** Batch-embed and upsert entries in bounded chunks to avoid single-tensor OOM spikes. */
    public addEntries(entries: readonly JournalEntry[]): Promise<void> {
        if (entries.length === 0) return Promise.resolve()
        if (this.disposed) return Promise.reject(new Error(DISPOSED_MANAGER_ERROR))
        if (entries.length === 1 && entries[0] !== undefined) {
            return this.addEntry(entries[0])
        }
        for (const entry of entries) {
            this.pendingRemovedIds.delete(entry.id)
        }
        return this.enqueueMutation(() =>
            runAddBatchVectorEntries({
                entries,
                dbAdapter: this.dbAdapter,
                pendingRemovedIds: this.pendingRemovedIds,
                isDisposed: () => this.disposed,
                initialize: () => this.initialize(),
                generateEmbeddingsSettled: (texts) => this.generateEmbeddingsSettled(texts),
            })
        )
    }

    /** Remove an entry from the vector index. */
    public removeEntry(entryId: number): boolean {
        if (this.disposed || (this.dbAdapter as unknown) == null) return false
        if (this.pendingMutationCount > 0 || this.rebuildActiveCount > 0) {
            this.pendingRemovedIds.add(entryId)
        }

        try {
            return this.dbAdapter.deleteVector(entryId)
        } catch (error) {
            logger.warning(`Failed to remove entry ${entryId} from vector index`, { error })
            return false
        }
    }

    private queryVectorCandidates(
        query: string,
        limit: number,
        threshold: number,
        targetWs: string,
        projectNumber: number | undefined,
        logLabel: string
    ): Promise<VectorCandidate[] | undefined> {
        return runVectorCandidateQuery({
            dbAdapter: this.dbAdapter,
            query,
            limit,
            threshold,
            targetWs,
            projectNumber,
            logLabel,
            initialize: () => this.initialize(),
            generateEmbedding: (text) => this.generateEmbedding(text),
            isDisposed: () => this.disposed,
            disposedErrorMessage: DISPOSED_MANAGER_ERROR,
        })
    }

    /** Return raw vector candidates above `threshold` without hydrating full entries from SQLite. */
    public searchCandidates(
        query: string,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string,
        projectNumber?: number
    ): Promise<VectorCandidate[]> {
        return this.trackRead(async () => {
            const targetWs = effectiveWorkspace(workspaceId)
            const candidates = await this.queryVectorCandidates(
                query, limit, threshold, targetWs, projectNumber, 'Semantic candidate search failed'
            )
            return candidates ?? []
        })
    }

    /** Search for similar entries by text query. */
    public search(
        query: string,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string,
        projectNumber?: number
    ): Promise<SemanticSearchResult[]> {
        return this.trackRead(async () => {
            const targetWs = effectiveWorkspace(workspaceId)
            const candidates = await this.queryVectorCandidates(
                query, limit, threshold, targetWs, projectNumber, 'Semantic search failed'
            )
            if (candidates === undefined) return []
            return resolveCandidates(
                this.dbAdapter,
                candidates,
                Math.min(limit, MAX_VECTOR_SEARCH_LIMIT),
                targetWs,
                projectNumber
            )
        })
    }

    /** Search for similar entries using an existing entry as the query */
    public searchByEntryId(
        entryId: number,
        limit = 10,
        threshold = 0.0,
        workspaceId?: string,
        projectNumber?: number,
        prefetchedEntry?: JournalEntry
    ): Promise<SemanticSearchResult[]> {
        return this.trackRead(() =>
            runEntryIdVectorLookup({
                dbAdapter: this.dbAdapter,
                entryId,
                limit,
                threshold,
                targetWs: effectiveWorkspace(workspaceId),
                projectNumber,
                prefetchedEntry,
                expectedDimensions: () => this.dimensions ?? undefined,
                initialize: () => this.initialize(),
                generateEmbedding: (text) =>
                    this.generateEmbedding(text, { bypassQueryCache: true }),
                isDisposed: () => this.disposed,
                disposedErrorMessage: DISPOSED_MANAGER_ERROR,
                persistVector: async (id, embedding) => {
                    await this.enqueueMutation(() => {
                        if (
                            !this.disposed &&
                            isEntryLiveForVectorUpsert(this.dbAdapter, id, this.pendingRemovedIds)
                        ) {
                            this.dbAdapter.upsertVector(id, embedding)
                        }
                        return Promise.resolve()
                    })
                },
            })
        )
    }

    /**
     * Helper to get vector search statistics
     */
    public getStats(): { itemCount: number | null; dimensions: number; modelName: string; isReady: boolean } {
        let itemCount: number | null = null
        let isReady = false

        try {
            itemCount = this.dbAdapter.getVectorCount()
            isReady = this.ready
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

    private trackRead<T>(fn: () => Promise<T>): Promise<T> {
        this.activeReads ??= new Set()
        return trackVectorRead(this.activeReads, () => this.disposed, fn)
    }

    private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
        if (this.disposed) return Promise.reject(new Error(DISPOSED_MANAGER_ERROR))
        this.pendingMutationCount++
        const run = async (): Promise<T> => {
            try {
                if (this.disposed) throw new Error(DISPOSED_MANAGER_ERROR)
                return await fn()
            } finally {
                this.pendingMutationCount--
                if (this.pendingMutationCount === 0 && this.rebuildActiveCount === 0 && !this.disposed) {
                    flushPendingVectorRemovals(this.dbAdapter, this.pendingRemovedIds)
                }
            }
        }
        const next = this.writeTail.then(run, run)
        this.writeTail = next.then(() => undefined, () => undefined)
        return next
    }

    public async rebuildIndex(
        progress?: ProgressContext,
        options?: { force?: boolean; batchSize?: number; pageSize?: number; projectNumber?: number; workspaceId?: string }
    ): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null; warning?: string }> {
        return this.enqueueMutation(async () => {
            this.rebuildActiveCount++
            try {
                const wasReady = this.ready
                await this.initialize()
                if (this.disposed) throw new Error(DISPOSED_MANAGER_ERROR)
                if (
                    wasReady &&
                    this.dimensions !== null &&
                    typeof this.dbAdapter.getVectorMetadata === 'function' &&
                    typeof this.dbAdapter.createVecTable === 'function'
                ) {
                    this.verifyAndCreateVecTable()
                }
                return await rebuildIndex(this, this.dbAdapter, progress, options)
            } finally {
                this.rebuildActiveCount--
            }
        })
    }
}
