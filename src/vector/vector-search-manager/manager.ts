import { logger } from '../../utils/logger.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { JournalEntry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { DEFAULT_MODEL, type SemanticSearchResult } from './types.js'
import { rebuildIndex } from './rebuild.js'

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
        return this.initializationPromise !== null && this.pipeline !== null
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

        this.initializationPromise = this._initialize()
        return this.initializationPromise
    }

    private async _initialize(): Promise<void> {
        try {
            logger.info('Initializing vector search...')

            // Lazy load transformers
            if (this.transformers === null) {
                const transformersModule = await import('@huggingface/transformers')
                this.transformers = transformersModule
                // Configure transformers to only use local models if we're in a completely offline environment,
                // otherwise let it download models to cache.
                transformersModule.env.allowRemoteModels = true
                transformersModule.env.localModelPath = '.cache/huggingface'
            }

            // Load model
            logger.info(`Loading embedding model: ${this.modelName}`)
            const transformersModule = this.transformers as { pipeline: (task: string, model: string, options: unknown) => Promise<unknown> }
            this.pipeline = await transformersModule.pipeline('feature-extraction', this.modelName, {
                dtype: 'fp32',
            })
            logger.info('Embedding model loaded')

            // Detect dimensions dynamically by doing a test embedding
            logger.info('Detecting embedding dimensions...')
            const pipelineFunc = this.pipeline as (text: string, options: unknown) => Promise<{ data: unknown[] }>
            const testResult = await pipelineFunc('test', { pooling: 'mean', normalize: true })
            this.dimensions = testResult.data.length
            logger.info(`Detected ${this.dimensions} dimensions for ${this.modelName}`)

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
            needsRecreation = true
            logger.warning('Failed to verify vector table dimensions, recreating', { error: err })
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
            this.dbAdapter.deleteVector(entryId)
            return true;
        } catch (error) {
            logger.warning(`Failed to remove entry ${entryId} from vector index`, { error })
            // Non-fatal
            return false;
        }
    }

    /**
     * Search for similar entries by text query
     */
    public async search(query: string, limit = 10, threshold = 0.0): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            const queryEmbedding = await this.generateEmbedding(query)
            
            // searchVectors returns { entry_id: number; distance: number }[]
            const results = this.dbAdapter.searchVectors(queryEmbedding, limit)
            
            const searchResults: SemanticSearchResult[] = []
            
            for (const result of results) {
                const entry = this.dbAdapter.getEntryById(result.entry_id)
                if (entry) {
                    // Cosine distance maps: 0 = exact match, 2 = opposite
                    // Standard cosine similarity: 1 = exact match, -1 = opposite
                    // Standard normalized vectors: distance = 1 - similarity
                    // So similarity = 1 - distance
                    const similarityScore = Math.max(0, 1 - result.distance)
                    
                    if (similarityScore >= threshold) {
                        searchResults.push({
                            entryId: result.entry_id,
                            entry,
                            distance: result.distance,
                            score: similarityScore,
                            similarityScore
                        })
                    }
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
    public async searchByEntryId(entryId: number, limit = 10, threshold = 0.0): Promise<SemanticSearchResult[]> {
        await this.initialize()

        try {
            let queryEmbedding = this.dbAdapter.getVector(entryId)
            
            if (!queryEmbedding) {
                // If not in index, fetch the entry and generate embedding
                const entry = this.dbAdapter.getEntryById(entryId)
                if (!entry) {
                    throw new Error(`Entry ${entryId} not found`)
                }
                
                const tagsText = entry.tags !== undefined && entry.tags !== null && entry.tags.length > 0 ? ` [Tags: ${entry.tags.join(', ')}]` : ''
                const text = `[${entry.entryType}]${tagsText} ${entry.content}`
                queryEmbedding = await this.generateEmbedding(text)
                
                // Add it to the index while we're at it
                this.dbAdapter.upsertVector(entryId, queryEmbedding)
            }
            
            // Search (request limit + 1 to account for the entry itself)
            const results = this.dbAdapter.searchVectors(queryEmbedding, limit + 1)
            
            const searchResults: SemanticSearchResult[] = []
            
            for (const result of results) {
                // Skip the original entry
                if (result.entry_id === entryId) continue
                
                const entry = this.dbAdapter.getEntryById(result.entry_id)
                if (entry) {
                    const similarityScore = Math.max(0, 1 - result.distance)
                    if (similarityScore >= threshold) {
                        searchResults.push({
                            entryId: result.entry_id,
                            entry,
                            distance: result.distance,
                            score: similarityScore,
                            similarityScore
                        })
                    }
                }
                
                // Only return up to limit results
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
        options?: { force?: boolean; batchSize?: number; pageSize?: number }
    ): Promise<{ success: boolean; indexed: number; failed: number; firstError: string | null }> {
        await this.initialize()
        return rebuildIndex(this, this.dbAdapter, progress, options)
    }
}
