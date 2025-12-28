/**
 * Memory Journal MCP Server - Vector Search Manager
 * 
 * Semantic search using @xenova/transformers for embeddings
 * and vectra for vector indexing.
 */

import { pipeline } from '@xenova/transformers';
import { LocalIndex } from 'vectra';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from '../utils/logger.js';
import type { SqliteAdapter } from '../database/SqliteAdapter.js';
import type { JournalEntry } from '../types/index.js';

/** Default model for embeddings (same as Python version) */
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

/** Embedding dimensions for all-MiniLM-L6-v2 */
const EMBEDDING_DIMENSIONS = 384;

/** Search result with similarity score */
export interface SemanticSearchResult {
    entryId: number;
    score: number;
    entry?: JournalEntry;
}

/**
 * VectorSearchManager - Handles semantic search with local embeddings
 */
export class VectorSearchManager {
    // Use a more flexible type since FeatureExtractionPipeline doesn't fully implement Pipeline
    private embedder: ((text: string, options?: Record<string, unknown>) => Promise<unknown>) | null = null;
    private index: LocalIndex | null = null;
    private readonly indexPath: string;
    private readonly modelName: string;
    private initialized = false;
    private initializing = false;

    constructor(dbPath: string, modelName = DEFAULT_MODEL) {
        // Store index in same directory as database
        const dbDir = path.dirname(dbPath);
        this.indexPath = path.join(dbDir, '.vectra_index');
        this.modelName = modelName;
    }

    /**
     * Check if vector search is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Initialize the vector search manager (lazy loading)
     */
    async initialize(): Promise<void> {
        if (this.initialized || this.initializing) return;

        this.initializing = true;

        try {
            logger.info('Initializing vector search...', { module: 'VectorSearch' });

            // Load embedding model (downloads on first use, ~23MB)
            logger.info(`Loading embedding model: ${this.modelName}`, { module: 'VectorSearch' });
            this.embedder = await pipeline('feature-extraction', this.modelName, {
                quantized: true, // Use quantized model for faster inference
            });
            logger.info('Embedding model loaded', { module: 'VectorSearch' });

            // Create or load vectra index
            if (!fs.existsSync(this.indexPath)) {
                fs.mkdirSync(this.indexPath, { recursive: true });
            }

            this.index = new LocalIndex(this.indexPath);

            // Check if index exists
            if (!await this.index.isIndexCreated()) {
                await this.index.createIndex();
                logger.info('Created new vector index', { module: 'VectorSearch' });
            } else {
                logger.info('Loaded existing vector index', { module: 'VectorSearch' });
            }

            this.initialized = true;
            this.initializing = false;
            logger.info('Vector search initialized successfully', { module: 'VectorSearch' });
        } catch (error) {
            this.initializing = false;
            logger.error('Failed to initialize vector search', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Generate embedding for text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        if (!this.embedder) {
            throw new Error('Vector search not initialized');
        }

        // Generate embedding using feature-extraction pipeline
        // The pipeline returns a Tensor with a data property containing the embeddings
        const output = await this.embedder(text, {
            pooling: 'mean',
            normalize: true,
        }) as { data: ArrayLike<number> };

        // Convert to number array
        const embedding = Array.from(output.data);
        return embedding;
    }

    /**
     * Add an entry to the vector index (upsert - replaces if exists)
     */
    async addEntry(entryId: number, content: string): Promise<boolean> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.index) {
            return false;
        }

        try {
            // Delete existing item first to support upsert behavior
            try {
                await this.index.deleteItem(String(entryId));
            } catch {
                // Item may not exist, ignore
            }

            // Generate embedding
            const embedding = await this.generateEmbedding(content);

            // Add to vectra index with entry ID as metadata
            await this.index.insertItem({
                id: String(entryId),
                vector: embedding,
                metadata: { entryId, contentPreview: content.slice(0, 100) }
            });

            logger.debug('Added entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId
            });

            return true;
        } catch (error) {
            logger.error('Failed to add entry to vector index', {
                module: 'VectorSearch',
                entityId: entryId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
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
            await this.initialize();
        }

        if (!this.index) {
            return [];
        }

        try {
            // Generate query embedding
            const queryEmbedding = await this.generateEmbedding(query);

            // Search vectra index
            const results = await this.index.queryItems(queryEmbedding, limit * 2);

            // Filter by threshold and map to our format
            const filteredResults: SemanticSearchResult[] = results
                .filter(r => r.score >= similarityThreshold)
                .slice(0, limit)
                .map(r => ({
                    entryId: (r.item.metadata as { entryId: number }).entryId,
                    score: r.score
                }));

            return filteredResults;
        } catch (error) {
            logger.error('Semantic search failed', {
                module: 'VectorSearch',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Remove an entry from the vector index
     */
    async removeEntry(entryId: number): Promise<boolean> {
        if (!this.index) return false;

        try {
            await this.index.deleteItem(String(entryId));
            return true;
        } catch {
            // Item might not exist in index
            return false;
        }
    }

    /**
     * Rebuild index from database entries
     */
    async rebuildIndex(db: SqliteAdapter): Promise<number> {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.index) {
            return 0;
        }

        logger.info('Rebuilding vector index from database...', { module: 'VectorSearch' });

        // Get all entries
        const entries = db.getRecentEntries(10000); // Get up to 10k entries

        let indexed = 0;
        for (const entry of entries) {
            // Delete existing item first to avoid "already exists" error
            try {
                await this.index.deleteItem(String(entry.id));
            } catch {
                // Item may not exist, ignore
            }

            const success = await this.addEntry(entry.id, entry.content);
            if (success) indexed++;
        }

        logger.info(`Rebuilt vector index with ${String(indexed)} entries`, { module: 'VectorSearch' });
        return indexed;
    }

    /**
     * Get index statistics
     */
    async getStats(): Promise<{ itemCount: number; modelName: string; dimensions: number }> {
        if (!this.index) {
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS };
        }

        try {
            const items = await this.index.listItems();
            return {
                itemCount: items.length,
                modelName: this.modelName,
                dimensions: EMBEDDING_DIMENSIONS
            };
        } catch {
            return { itemCount: 0, modelName: this.modelName, dimensions: EMBEDDING_DIMENSIONS };
        }
    }
}
