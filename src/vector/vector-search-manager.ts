/**
 * Memory Journal MCP Server - Vector Search Manager
 *
 * Semantic search using @huggingface/transformers for embeddings
 * and vectra for vector indexing.
 */

// @huggingface/transformers is loaded lazily via dynamic import() in initialize()
// to avoid 1.5s cold-start penalty from eagerly loading the module.
// vectra is also loaded lazily via dynamic import() to avoid 0.9s cold-start penalty.
import type { LocalIndex } from 'vectra'
import * as path from 'node:path'
import * as fs from 'node:fs'
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
 */
export class VectorSearchManager {
    // Use a more flexible type since FeatureExtractionPipeline doesn't fully implement Pipeline
    private embedder:
        | ((text: string, options?: Record<string, unknown>) => Promise<unknown>)
        | null = null
    private index: LocalIndex | null = null
    private readonly indexPath: string
    private readonly modelName: string
    private initialized = false
    private initializing = false

    constructor(dbPath: string, modelName = DEFAULT_MODEL) {
        // Store index in same directory as database
        const dbDir = path.dirname(dbPath)
        this.indexPath = path.join(dbDir, '.vectra_index')
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
        if (this.initialized || this.initializing) return

        this.initializing = true

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

            // Create or load vectra index (dynamic import avoids 0.9s cold-start)
            const { LocalIndex } = await import('vectra')
            if (!fs.existsSync(this.indexPath)) {
                await fs.promises.mkdir(this.indexPath, { recursive: true })
            }

            this.index = new LocalIndex(this.indexPath)

            // Check if index exists
            if (!(await this.index.isIndexCreated())) {
                await this.index.createIndex()
                logger.info('Created new vector index', { module: 'VectorSearch' })
            } else {
                logger.info('Loaded existing vector index', { module: 'VectorSearch' })
            }

            this.initialized = true
            this.initializing = false
            logger.info('Vector search initialized successfully', { module: 'VectorSearch' })
        } catch (error) {
            this.initializing = false
            logger.error('Failed to initialize vector search', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error),
            })
            throw error
        }
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
    async addEntry(entryId: number, content: string): Promise<boolean> {
        if (!this.initialized) {
            await this.initialize()
        }

        if (!this.index) {
            return false
        }

        try {
            // Generate embedding
            const embedding = await this.generateEmbedding(content)

            // Upsert to vectra index (replaces if exists, inserts if new)
            await this.index.upsertItem({
                id: String(entryId),
                vector: embedding,
                metadata: { entryId, contentPreview: content.slice(0, 100) },
            })

            logger.debug('Added entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId,
            })

            return true
        } catch (error) {
            logger.error('Failed to add entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId,
                error: error instanceof Error ? error.message : String(error),
            })
            return false
        }
    }

    /**
     * Perform semantic search
     */
    async search(
        query: string,
        limit = 10,
        similarityThreshold = 0.3
    ): Promise<SemanticSearchResult[]> {
        if (!this.initialized) {
            await this.initialize()
        }

        if (!this.index) {
            return []
        }

        try {
            // Generate query embedding
            const queryEmbedding = await this.generateEmbedding(query)

            // Search vectra index (vectra 0.11.1+ requires query string for BM25 hybrid search)
            const results = await this.index.queryItems(queryEmbedding, query, limit * 2)

            // Filter by threshold and map to our format
            const filteredResults: SemanticSearchResult[] = results
                .filter((r) => r.score >= similarityThreshold)
                .slice(0, limit)
                .map((r) => ({
                    entryId: r.item.metadata['entryId'] as number,
                    score: r.score,
                }))

            return filteredResults
        } catch (error) {
            logger.error('Semantic search failed', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error),
            })
            return []
        }
    }

    /**
     * Remove an entry from the vector index
     */
    async removeEntry(entryId: number): Promise<boolean> {
        if (!this.index) return false

        try {
            await this.index.deleteItem(String(entryId))
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
    async rebuildIndex(db: IDatabaseAdapter, progress?: ProgressContext): Promise<number> {
        if (!this.initialized) {
            await this.initialize()
        }

        if (!this.index) {
            return 0
        }

        logger.info('Rebuilding vector index from database...', { module: 'VectorSearch' })

        // Step 1: Get total entry count for progress reporting
        const totalEntries = db.getActiveEntryCount()

        // Step 2: Clean-wipe existing index directory and recreate from scratch.
        // This is O(1) vs the old per-item sequential deletion which was O(n).
        try {
            if (fs.existsSync(this.indexPath)) {
                await fs.promises.rm(this.indexPath, { recursive: true, force: true })
            }
            await fs.promises.mkdir(this.indexPath, { recursive: true })
            const { LocalIndex: LI } = await import('vectra')
            this.index = new LI(this.indexPath)
            await this.index.createIndex()
            logger.info('Cleared and recreated vector index for rebuild', { module: 'VectorSearch' })
        } catch (cleanError) {
            logger.error('Failed to recreate vector index directory', {
                module: 'VectorSearch',
                error: cleanError instanceof Error ? cleanError.message : String(cleanError),
            })
            throw cleanError
        }

        // Step 4: Re-index all entries using paginated fetch
        // Embeddings are generated in parallel batches (CPU-bound, safe),
        // but vectra insertions are sequential (file I/O, not concurrency-safe)
        await sendProgress(progress, 0, totalEntries, 'Starting vector index rebuild...')

        let indexed = 0
        for (let offset = 0; offset < totalEntries; offset += REBUILD_PAGE_SIZE) {
            const page = db.getEntriesPage(offset, REBUILD_PAGE_SIZE)

            // Generate embeddings in parallel batches
            for (let i = 0; i < page.length; i += REBUILD_BATCH_SIZE) {
                const batch = page.slice(i, i + REBUILD_BATCH_SIZE)

                // Parallel embedding generation
                const embeddings = await Promise.all(
                    batch.map(async (entry: JournalEntry) => {
                        try {
                            return { entry, embedding: await this.generateEmbedding(entry.content) }
                        } catch (embError) {
                            logger.debug('Failed to generate embedding for entry', {
                                module: 'VectorSearch',
                                entityId: entry.id,
                                error: embError instanceof Error ? embError.message : String(embError),
                            })
                            return { entry, embedding: null }
                        }
                    })
                )

                // Sequential vectra insertion (file I/O not concurrency-safe)
                for (const { entry, embedding } of embeddings) {
                    if (embedding !== null) {
                        try {
                            await this.index.insertItem({
                                id: String(entry.id),
                                vector: embedding,
                                metadata: {
                                    entryId: entry.id,
                                    contentPreview: entry.content.slice(0, 100),
                                },
                            })
                            indexed++
                        } catch (error) {
                            logger.error('Failed to insert entry into vector index', {
                                module: 'VectorSearch',
                                entityId: entry.id,
                                error: error instanceof Error ? error.message : String(error),
                            })
                        }
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
            }
        }

        // Force index to refresh by re-listing items
        // This ensures the internal query structures are updated and ready for search
        await this.index.listItems()

        // Final progress
        await sendProgress(progress, indexed, totalEntries, 'Vector index rebuild complete')

        logger.info(`Rebuilt vector index with ${String(indexed)} entries`, {
            module: 'VectorSearch',
        })
        return indexed
    }

    /**
     * Get index statistics
     * Uses getIndexStats() which explicitly loads from disk for authoritative stats.
     */
    async getStats(): Promise<{ itemCount: number; modelName: string; dimensions: number }> {
        if (!this.index) {
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS }
        }

        try {
            // Use getIndexStats() which loads from disk for accurate count
            // This fixes inconsistency where listItems() could return stale in-memory data
            const stats = await this.index.getIndexStats()
            return {
                itemCount: stats.items,
                modelName: this.modelName,
                dimensions: EMBEDDING_DIMENSIONS,
            }
        } catch (error) {
            logger.debug('Failed to get vector index stats', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error),
            })
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS }
        }
    }
}
