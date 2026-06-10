import { logger } from '../../utils/logger.js'
import type { SQLiteAdapter } from '../../database/sqlite-adapter/index.js'
import type { Entry } from '../../types/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { DEFAULT_MODEL, type SemanticSearchResult } from './types.js'
import { rebuildIndex } from './rebuild.js'

export class VectorSearchManager {
    private dbAdapter: SQLiteAdapter
    private modelName: string
    private dimensions: number | null = null
    // Lazy-loaded dependencies
    private pipeline: any = null
    private transformers: any = null
    private initializationPromise: Promise<void> | null = null

    constructor(dbAdapter: SQLiteAdapter, options?: { modelName?: string }) {
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
     * Initialize the vector search manager.
     * This loads the huggingface transformer model and creates the virtual table.
     */
    public async initialize(): Promise<void> {
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
            if (!this.transformers) {
                this.transformers = await import('@huggingface/transformers')
                // Configure transformers to only use local models if we're in a completely offline environment,
                // otherwise let it download models to cache.
                this.transformers.env.allowRemoteModels = true
                this.transformers.env.localModelPath = '.cache/huggingface'
            }

            // Load model
            logger.info(\`Loading embedding model: \${this.modelName}\`)
            this.pipeline = await this.transformers.pipeline('feature-extraction', this.modelName, {
                dtype: 'fp32',
            })
            logger.info('Embedding model loaded')

            // Detect dimensions dynamically by doing a test embedding
            logger.info('Detecting embedding dimensions...')
            const testResult = await this.pipeline('test', { pooling: 'mean', normalize: true })
            this.dimensions = testResult.data.length
            logger.info(\`Detected \${this.dimensions} dimensions for \${this.modelName}\`)

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
        const db = this.dbAdapter.db
        if (!this.dimensions) {
            throw new Error('Dimensions not detected. Cannot create vector table.')
        }

        // 1. Check if the table exists
        let tableExists = false
        try {
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_journal_entries'").get()
            tableExists = !!result
        } catch (err) {
            logger.warning('Could not query sqlite_master, assuming table does not exist', { error: err })
        }

        let needsRecreation = !tableExists

        // 2. If it exists, check if the dimensions and model match the metadata
        if (tableExists) {
            try {
                // Try to get metadata from our app config
                // In a robust implementation, this would be stored in a dedicated metadata table
                // For now, we'll try to infer it from the table definition
                
                // Since sqlite-vec doesn't make it easy to extract dimensions after creation without parsing SQL,
                // and we're actively tracking changes in the app layer, we'll use a pragmatic approach:
                // We'll read the first row. If it errors because dimensions mismatch, we'll catch it.
                // Or better, we can query sqlite_master for the exact CREATE TABLE statement.
                
                const masterResult = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_journal_entries'").get() as { sql: string } | undefined
                if (masterResult && masterResult.sql) {
                    // Look for: embedding float[384]
                    const match = masterResult.sql.match(/embedding\s+float\[(\d+)\]/i)
                    if (match && match[1]) {
                        const existingDim = parseInt(match[1], 10)
                        if (existingDim !== this.dimensions) {
                            needsRecreation = true
                            logger.info(\`Vector model or dimensions changed, dropping old index\`, {
                                oldModel: 'unknown',
                                newModel: this.modelName,
                                oldDimensions: existingDim,
                                newDimensions: this.dimensions
                            })
                        }
                    }
                }
            } catch (err) {
                // If anything fails during verification, recreate to be safe
                needsRecreation = true
                logger.warning('Failed to verify vector table dimensions, recreating', { error: err })
            }
        }

        // 3. Recreate if needed
        if (needsRecreation) {
            try {
                db.exec('BEGIN IMMEDIATE')
                db.exec('DROP TABLE IF EXISTS vec_journal_entries')
                db.exec(\`
                    CREATE VIRTUAL TABLE vec_journal_entries USING vec0(
                        embedding float[\${this.dimensions}]
                    )
                \`)
                db.exec('COMMIT')
                logger.info('Vector index table created/recreated successfully')
            } catch (err) {
                try {
                    db.exec('ROLLBACK')
                } catch (e) {
                    /* ignore rollback error */
                }
                logger.error('Failed to create vector index table', { error: err })
                throw err
            }
        }
    }

    /**
     * Generate an embedding for text
     */
    public async generateEmbedding(text: string): Promise<Float32Array> {
        await this.initialize()

        if (!this.pipeline) {
            throw new Error('Pipeline not initialized')
        }

        const result = await this.pipeline(text, { pooling: 'mean', normalize: true })
        return new Float32Array(result.data)
    }

    /**
     * Add an entry to the vector index
     */
    public async addEntry(entry: Entry): Promise<void> {
        await this.initialize()

        const db = this.dbAdapter.db
        
        try {
            // Text to embed - include entry type and tags for better semantic matching
            const tagsText = entry.tags && entry.tags.length > 0 ? \` [Tags: \${entry.tags.join(', ')}]\` : ''
            const text = \`[\${entry.entryType}]\${tagsText} \${entry.content}\`
            
            const embedding = await this.generateEmbedding(text)
            
            const stmt = db.prepare('INSERT OR REPLACE INTO vec_journal_entries(rowid, embedding) VALUES (?, ?)')
            stmt.run(entry.id, embedding)
        } catch (error) {
            logger.error(\`Failed to add entry \${entry.id} to vector index\`, {
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    /**
     * Remove an entry from the vector index
     */
    public removeEntry(entryId: number): void {
        // Can be done synchronously as it doesn't require the model
        try {
            const db = this.dbAdapter.db
            
            // Check if table exists first (don't fail if we're not using vectors)
            const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_journal_entries'").get()
            if (!exists) return
            
            const stmt = db.prepare('DELETE FROM vec_journal_entries WHERE rowid = ?')
            stmt.run(entryId)
        } catch (error) {
            logger.warning(\`Failed to remove entry \${entryId} from vector index\`, {
                error: error instanceof Error ? error.message : String(error)
            })
            // Non-fatal
        }
    }

    /**
     * Search for similar entries by text query
     */
    public async search(query: string, limit: number = 10): Promise<SemanticSearchResult[]> {
        await this.initialize()

        const db = this.dbAdapter.db
        
        try {
            const queryEmbedding = await this.generateEmbedding(query)
            
            // sqlite-vec distance function uses cosine distance (1.0 - cosine_similarity)
            // L2 distance is available via vec_distance_L2
            // We use cosine distance as it's standard for semantic embeddings
            const stmt = db.prepare(\`
                SELECT 
                    rowid,
                    distance
                FROM vec_journal_entries
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT ?
            \`)
            
            // We need to convert distance to similarity score
            // sqlite-vec returns cosine distance (0 to 2)
            // Similarity = 1 - (distance / 2) to normalize to 0-1 range
            // Or roughly 1 - distance for standard normalized vectors
            const results = stmt.all(queryEmbedding, limit) as { rowid: number, distance: number }[]
            
            const searchResults: SemanticSearchResult[] = []
            
            for (const result of results) {
                const entry = this.dbAdapter.getEntryById(result.rowid)
                if (entry) {
                    // Cosine distance maps: 0 = exact match, 2 = opposite
                    // Standard cosine similarity: 1 = exact match, -1 = opposite
                    // Standard normalized vectors: distance = 1 - similarity
                    // So similarity = 1 - distance
                    const similarityScore = Math.max(0, 1 - result.distance)
                    
                    searchResults.push({
                        entry,
                        distance: result.distance,
                        similarityScore
                    })
                }
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
    public async searchByEntryId(entryId: number, limit: number = 10): Promise<SemanticSearchResult[]> {
        await this.initialize()

        const db = this.dbAdapter.db
        
        try {
            // Check if the entry exists in the vector index
            const getEmbeddingStmt = db.prepare('SELECT embedding FROM vec_journal_entries WHERE rowid = ?')
            const result = getEmbeddingStmt.get(entryId) as { embedding: Float32Array } | undefined
            
            let queryEmbedding: Float32Array
            
            if (result && result.embedding) {
                queryEmbedding = result.embedding
            } else {
                // If not in index, fetch the entry and generate embedding
                const entry = this.dbAdapter.getEntryById(entryId)
                if (!entry) {
                    throw new Error(\`Entry \${entryId} not found\`)
                }
                
                const tagsText = entry.tags && entry.tags.length > 0 ? \` [Tags: \${entry.tags.join(', ')}]\` : ''
                const text = \`[\${entry.entryType}]\${tagsText} \${entry.content}\`
                queryEmbedding = await this.generateEmbedding(text)
                
                // Add it to the index while we're at it
                const stmt = db.prepare('INSERT OR REPLACE INTO vec_journal_entries(rowid, embedding) VALUES (?, ?)')
                stmt.run(entryId, queryEmbedding)
            }
            
            // Search excluding the entry itself
            const stmt = db.prepare(\`
                SELECT 
                    rowid,
                    distance
                FROM vec_journal_entries
                WHERE embedding MATCH ? AND rowid != ?
                ORDER BY distance
                LIMIT ?
            \`)
            
            const results = stmt.all(queryEmbedding, entryId, limit) as { rowid: number, distance: number }[]
            
            const searchResults: SemanticSearchResult[] = []
            
            for (const result of results) {
                const entry = this.dbAdapter.getEntryById(result.rowid)
                if (entry) {
                    searchResults.push({
                        entry,
                        distance: result.distance,
                        similarityScore: Math.max(0, 1 - result.distance)
                    })
                }
            }
            
            return searchResults
        } catch (error) {
            logger.error(\`Semantic search by entry ID \${entryId} failed\`, {
                error: error instanceof Error ? error.message : String(error)
            })
            throw error
        }
    }

    /**
     * Helper to get vector search statistics
     */
    public getStats(): { indexedEntries: number; totalEntries: number; dimensions: number | null; modelName: string } {
        const db = this.dbAdapter.db
        
        let indexedEntries = 0
        let totalEntries = 0
        
        try {
            const result = db.prepare('SELECT COUNT(*) as count FROM journal_entries').get() as { count: number }
            totalEntries = result.count
            
            const vecExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_journal_entries'").get()
            if (vecExists) {
                const vecResult = db.prepare('SELECT COUNT(*) as count FROM vec_journal_entries').get() as { count: number }
                indexedEntries = vecResult.count
            }
        } catch (error) {
            logger.warning('Failed to get vector search stats', { error })
        }
        
        return {
            indexedEntries,
            totalEntries,
            dimensions: this.dimensions,
            modelName: this.modelName
        }
    }

    /**
     * Rebuild the vector index incrementally
     */
    public async rebuildIndex(
        progress?: ProgressContext,
        options?: { force?: boolean; batchSize?: number; pageSize?: number }
    ): Promise<{ success: boolean; indexed: number; skipped: number; errors: number }> {
        await this.initialize()
        return rebuildIndex(this, this.dbAdapter, progress, options)
    }
}
