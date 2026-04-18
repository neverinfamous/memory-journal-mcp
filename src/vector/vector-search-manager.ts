/**
 * Memory Journal MCP Server - Vector Search Manager
 *
 * Semantic search using @huggingface/transformers for embeddings
 * and sqlite-vec for vector indexing (stored in the same SQLite database).
 */

// @huggingface/transformers is loaded lazily via dynamic import() in initialize()
// to avoid 1.5s cold-start penalty from eagerly loading the module.
import { logger } from '../utils/logger.js'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { JournalEntry } from '../types/index.js'
import { sendProgress, type ProgressContext } from '../utils/progress-utils.js'
import { ConfigurationError } from '../types/errors.js'

/** Default model for embeddings (same as Python version) */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'

/** Embedding dimensions for all-MiniLM-L6-v2 */
const EMBEDDING_DIMENSIONS = 384

/** Number of entries to embed concurrently during rebuild */
const REBUILD_BATCH_SIZE = 5

/** Number of entries to fetch per page during rebuild */
const REBUILD_PAGE_SIZE = 200

/** Search result with similarity score */
export interface SemanticSearchResult {
    entryId: number
    score: number
    entry?: JournalEntry
}

/**
 * VectorSearchManager - Handles semantic search with local embeddings
 *
 * Stores embeddings in the same SQLite database using the sqlite-vec extension.
 * Uses vec0 virtual tables for efficient KNN vector search via SQL.
 */
export class VectorSearchManager {
    // Use a more flexible type since FeatureExtractionPipeline doesn't fully implement Pipeline
    private embedder:
        | ((text: string, options?: Record<string, unknown>) => Promise<unknown>)
        | null = null
    private get db(): IDatabaseAdapter | null {
        return this.dbAdapter
    }
    private readonly modelName: string
    private initialized = false
    private initPromise: Promise<void> | null = null

    constructor(
        private readonly dbAdapter: IDatabaseAdapter,
        modelName = DEFAULT_MODEL
    ) {
        this.modelName = modelName
    }



    /**
     * Check if vector search is initialized
     */
    isInitialized(): boolean {
        return this.initialized
    }

    /**
     * Initialize the vector search manager (lazy loading)
     */
    async initialize(): Promise<void> {
        if (this.initialized) return
        if (this.initPromise) return this.initPromise

        this.initPromise = (async () => {
            try {
                logger.info('Initializing vector search...', { module: 'VectorSearch' })

                // Load embedding model (downloads on first use, ~23MB)
                // Dynamic import avoids 1.5s cold-start penalty from eagerly loading the module
                logger.info(`Loading embedding model: ${this.modelName}`, { module: 'VectorSearch' })
                const { pipeline } = await import('@huggingface/transformers')
                this.embedder = await pipeline('feature-extraction', this.modelName, {
                    dtype: 'q8', // Quantized int8 for faster inference and smaller model size
                })
                logger.info('Embedding model loaded', { module: 'VectorSearch' })

                // Get the raw better-sqlite3 database instance
                // sqlite-vec extension is already loaded by NativeConnectionManager

                this.initialized = true
                logger.info('Vector search initialized successfully', { module: 'VectorSearch' })
            } catch (error) {
                logger.error('Failed to initialize vector search', {
                    module: 'VectorSearch',
                    error: error instanceof Error ? error.message : String(error),
                })
                throw error
            } finally {
                this.initPromise = null
            }
        })()
        
        return this.initPromise
    }

    /**
     * Generate embedding for text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        if (!this.embedder) {
            throw new ConfigurationError('Vector search not initialized')
        }

        // Generate embedding using feature-extraction pipeline
        // The pipeline returns a Tensor with a data property containing the embeddings
        const output = (await this.embedder(text, {
            pooling: 'mean',
            normalize: true,
        })) as { data: ArrayLike<number> }

        // Convert to number array
        const embedding = Array.from(output.data)
        return embedding
    }

    /**
     * Add an entry to the vector index (upsert - replaces if exists)
     */
    async addEntry(
        entryId: number,
        content: string
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.initialized) {
            try {
                await this.initialize()
            } catch (initError) {
                const msg = initError instanceof Error ? initError.message : String(initError)
                return { success: false, error: `Vector search initialization failed: ${msg}` }
            }
        }

        if (!this.db) {
            return { success: false, error: 'Vector database not available' }
        }

        try {
            // Generate embedding
            const embedding = await this.generateEmbedding(content)

            const vec = new Float32Array(embedding)
            
            this.dbAdapter.upsertVector(entryId, vec)

            logger.debug('Added entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId,
            })

            return { success: true }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            logger.error('Failed to add entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId,
                error: errorMessage,
            })
            return { success: false, error: errorMessage }
        }
    }

    /**
     * Perform semantic search
     *
     * sqlite-vec returns L2 distance (lower = more similar).
     * We convert to a similarity score: score = 1 / (1 + distance)
     */
    async search(
        query: string,
        limit = 10,
        similarityThreshold = 0.3
    ): Promise<SemanticSearchResult[]> {
        if (!this.initialized) {
            await this.initialize()
        }

        if (!this.db) {
            throw new ConfigurationError('Vector database not available')
        }

        try {
            // Generate query embedding
            const queryEmbedding = await this.generateEmbedding(query)
            const queryVec = new Float32Array(queryEmbedding)

            // KNN search via adapter
            const results = this.dbAdapter.searchVectors(queryVec, limit)

            // Convert L2 distance to similarity score and filter by threshold
            const filteredResults: SemanticSearchResult[] = results
                .map((r) => ({
                    entryId: r.entry_id,
                    score: 1 / (1 + r.distance),
                }))
                .filter((r) => r.score >= similarityThreshold)
                .slice(0, limit)

            return filteredResults
        } catch (error) {
            logger.error('Semantic search failed', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    /**
     * Find entries related to a given entry by its existing embedding.
     * Uses the stored embedding directly, skipping the re-embedding step.
     *
     * @param entryId - Entry ID whose embedding is used as the search vector
     * @param limit - Max number of results
     * @param similarityThreshold - Minimum similarity score
     */
    async searchByEntryId(
        entryId: number,
        limit = 10,
        similarityThreshold = 0.3
    ): Promise<SemanticSearchResult[]> {
        if (!this.initialized) {
            await this.initialize()
        }

        if (!this.db) {
            throw new ConfigurationError('Vector database not available')
        }

        try {
            // Look up the stored embedding for this entry
            const storedEmbedding = this.dbAdapter.getVector(entryId)

            if (!storedEmbedding) {
                logger.debug('No embedding found for entry', {
                    module: 'VectorSearch',
                    entityId: entryId,
                })
                return []
            }

            // KNN search — fetch extra to allow excluding the source entry
            const results = this.dbAdapter.searchVectors(storedEmbedding, limit + 1)

            // Convert L2 distance to similarity, exclude the source entry, filter by threshold
            const filteredResults: SemanticSearchResult[] = results
                .filter((r) => r.entry_id !== entryId)
                .map((r) => ({
                    entryId: r.entry_id,
                    score: 1 / (1 + r.distance),
                }))
                .filter((r) => r.score >= similarityThreshold)
                .slice(0, limit)

            return filteredResults
        } catch (error) {
            logger.error('searchByEntryId failed', {
                module: 'VectorSearch',
                entityId: entryId,
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
    }

    /**
     * Remove an entry from the vector index
     */
    removeEntry(entryId: number): boolean {
        if (!this.db) return false

        try {
            this.dbAdapter.deleteVector(entryId)
            return true
        } catch (error) {
            logger.debug('Vector removeEntry failed (item may not exist)', {
                module: 'VectorSearch',
                entityId: entryId,
                error: error instanceof Error ? error.message : String(error),
            })
            return false
        }
    }

    /**
     * Rebuild index from database entries.
     * Uses paginated fetching and parallel batch embedding for performance.
     * @param db - Database adapter
     * @param progress - Optional progress context for notifications
     */
    async rebuildIndex(
        db: IDatabaseAdapter,
        progress?: ProgressContext,
        options?: { budget?: number; isCancelled?: () => boolean }
    ): Promise<{ indexed: number; failed: number; firstError: string | null; partial: boolean }> {
        if (!this.initialized) {
            try {
                await this.initialize()
            } catch (initError) {
                const msg = initError instanceof Error ? initError.message : String(initError)
                return {
                    indexed: 0,
                    failed: 0,
                    firstError: `Vector search initialization failed: ${msg}`,
                    partial: false,
                }
            }
        }

        if (!this.db) {
            return { indexed: 0, failed: 0, firstError: null, partial: false }
        }

        logger.info('Rebuilding vector index from database...', { module: 'VectorSearch' })

        // Step 1: Get total entry count for progress reporting
        const totalEntries = db.getActiveEntryCount()

        // Step 2: Clear existing embeddings (O(1) operation) - REMOVED for Fail-Closed behavior
        // this.dbAdapter.clearVectors()
        // logger.info('Cleared vec_embeddings table for rebuild', { module: 'VectorSearch' })

        // Step 3: Re-index all entries using paginated fetch
        // Embeddings are generated in parallel batches (CPU-bound, safe),
        // then inserted into SQLite (synchronous, fast, concurrency-safe via WAL)
        await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild...')



        let indexed = 0
        let failed = 0
        let processed = 0
        const budget = options?.budget ?? 10000
        let firstError: string | null = null
        let partial = false
        for (let offset = 0; offset < totalEntries; offset += REBUILD_PAGE_SIZE) {
            if (options?.isCancelled?.() || processed >= budget) {
                partial = true
                break
            }
            const page = db.getEntriesPage(offset, REBUILD_PAGE_SIZE)

            // Generate embeddings in parallel batches
            for (let i = 0; i < page.length; i += REBUILD_BATCH_SIZE) {
                const batch = page.slice(i, i + REBUILD_BATCH_SIZE)

                // Parallel embedding generation
                const embeddings = await Promise.all(
                    batch.map(async (entry: JournalEntry) => {
                        try {
                            return {
                                entry,
                                embedding: await this.generateEmbedding(entry.content),
                                error: null,
                            }
                        } catch (embError) {
                            const errorMsg =
                                embError instanceof Error ? embError.message : String(embError)
                            logger.debug('Failed to generate embedding for entry', {
                                module: 'VectorSearch',
                                entityId: entry.id,
                                error: errorMsg,
                            })
                            return { entry, embedding: null as number[] | null, error: errorMsg }
                        }
                    })
                )

                // Insert embeddings into SQLite
                for (const { entry, embedding, error: embError } of embeddings) {
                    if (embedding !== null) {
                        try {
                            const vec = new Float32Array(embedding)
                            this.dbAdapter.upsertVector(entry.id, vec)
                            indexed++
                        } catch (error) {
                            failed++
                            const errorMsg = error instanceof Error ? error.message : String(error)
                            firstError ??= errorMsg
                            logger.error('Failed to insert entry into vector index', {
                                module: 'VectorSearch',
                                entityId: entry.id,
                                error: errorMsg,
                            })
                        }
                    } else {
                        failed++
                        if (embError !== null) firstError ??= embError
                    }
                }

                // Report progress every 10 entries to avoid flooding
                if (indexed % 10 === 0 || indexed === totalEntries) {
                    await sendProgress(
                        progress,
                        indexed,
                        totalEntries,
                        `Indexed ${String(indexed)} of ${String(totalEntries)} entries`
                    )
                }
                
                processed += batch.length
                
                if (options?.isCancelled?.()) {
                    firstError ??= 'Operation cancelled'
                    partial = true
                    break
                }
                if (processed >= budget) {
                    firstError ??= `Rebuild index budget of ${String(budget)} items reached`
                    partial = true
                    break
                }
            }
        }

        // Final progress
        await sendProgress(progress, indexed, totalEntries, 'Vector index rebuild complete')

        if (failed > 0 || firstError) {
            logger.warning(
                `Vector index rebuild: ${String(indexed)} indexed, ${String(failed)} failed`,
                {
                    module: 'VectorSearch',
                }
            )
        } else {
            // Prune any stale embeddings only if the entire operation succeeded
            try {
                this.dbAdapter.cleanupStaleVectors()
                logger.info('Cleared stale embeddings post-rebuild', { module: 'VectorSearch' })
            } catch (cleanupError) {
                logger.warning('Failed to clear stale embeddings', { module: 'VectorSearch', error: String(cleanupError) })
            }

            logger.info(`Rebuilt vector index with ${String(indexed)} entries`, {
                module: 'VectorSearch',
            })
        }
        return { indexed, failed, firstError, partial }
    }

    /**
     * Get index statistics
     */
    getStats(): { itemCount: number; modelName: string; dimensions: number; isReady: boolean } {
        if (!this.db) {
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS, isReady: this.initialized }
        }

        try {
            const count = this.dbAdapter.getVectorCount()
            return {
                itemCount: count,
                modelName: this.modelName,
                dimensions: EMBEDDING_DIMENSIONS,
                isReady: this.initialized,
            }
        } catch (error) {
            logger.debug('Failed to get vector index stats', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error),
            })
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS, isReady: this.initialized }
        }
    }
}
