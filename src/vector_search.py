"""
Memory Journal MCP Server - Vector Search Module
Semantic search functionality using sentence transformers and FAISS.
"""

import asyncio
import sqlite3
import sys
import pickle
from typing import Any, List, Tuple
from concurrent.futures import ThreadPoolExecutor

from constants import VECTOR_SEARCH_MODEL, VECTOR_SEARCH_DIMENSIONS, DEFAULT_SIMILARITY_THRESHOLD
from exceptions import (
    VectorSearchError,
    VectorSearchNotInitializedError, EmbeddingGenerationError
)

# Import numpy only when needed for vector operations
HAS_NUMPY = False
np: Any = None
try:
    import numpy as np  # type: ignore[no-redef]
    HAS_NUMPY = True  # pyright: ignore[reportConstantRedefinition]
except ImportError:
    pass

# Vector search availability check (defer actual imports for faster startup)
VECTOR_SEARCH_AVAILABLE = False
try:
    import importlib.util
    if importlib.util.find_spec("sentence_transformers") and importlib.util.find_spec("faiss"):
        VECTOR_SEARCH_AVAILABLE = True  # pyright: ignore[reportConstantRedefinition]
        print("[INFO] Vector search capabilities available (will load on first use)", file=sys.stderr)
except Exception:
    print("Vector search dependencies not found. Install with: pip install sentence-transformers faiss-cpu", file=sys.stderr)
    print("Continuing without semantic search capabilities...", file=sys.stderr)

# Lazy imports for vector search (loaded on first use)
SentenceTransformer: Any = None
faiss: Any = None

# Try importing at module level if available
if VECTOR_SEARCH_AVAILABLE:
    try:
        from sentence_transformers import SentenceTransformer as ST  # type: ignore[import-not-found]
        import faiss as faiss_module  # type: ignore[import-not-found]
        SentenceTransformer = ST
        faiss = faiss_module
        print("[INFO] Vector search dependencies pre-loaded at startup", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Could not pre-load vector search dependencies: {e}", file=sys.stderr)
        VECTOR_SEARCH_AVAILABLE = False  # pyright: ignore[reportConstantRedefinition]


# Thread pool for ML operations (will be set by server.py)
_thread_pool: ThreadPoolExecutor = None  # type: ignore


def set_thread_pool(pool: ThreadPoolExecutor):
    """Set the thread pool for async operations."""
    global _thread_pool
    _thread_pool = pool


class VectorSearchManager:
    """Manages vector embeddings and semantic search functionality."""

    def __init__(self, db_path: str, model_name: str = VECTOR_SEARCH_MODEL):
        """
        Initialize vector search manager.
        
        Args:
            db_path: Path to the SQLite database
            model_name: Name of the sentence transformer model to use
        """
        self.db_path = db_path
        self.model_name = model_name
        self.model: Any = None
        self.faiss_index: Any = None
        self.entry_id_map: dict[int, int] = {}  # Maps FAISS index positions to entry IDs
        self.initialized = False
        self._initialization_lock = asyncio.Lock()
        self._initialization_task = None

        # Don't initialize immediately - do it lazily on first use for faster startup

    async def ensure_initialized(self):
        """Lazy initialization - only initialize on first use (async to avoid blocking)."""
        # If already initialized, return immediately
        if self.initialized:
            return
        
        # If initialization is in progress, wait for it to complete
        async with self._initialization_lock:
            # Double-check after acquiring lock (another task might have completed it)
            if self.initialized:
                return
            
            if not VECTOR_SEARCH_AVAILABLE:
                return

            try:
                # Dependencies should already be imported at module level
                if SentenceTransformer is None or faiss is None:
                    print("[ERROR] Vector search dependencies not available", file=sys.stderr)
                    self.initialized = False
                    return

                # Use stderr for initialization messages to avoid MCP JSON parsing errors
                print(f"[INFO] Step 1/3: Loading ML model ({self.model_name})...", file=sys.stderr)
                
                # Run model loading in thread pool to avoid blocking the event loop
                loop = asyncio.get_event_loop()
                assert SentenceTransformer is not None, "SentenceTransformer should be imported"
                
                # Add explicit flush to ensure message appears
                sys.stderr.flush()
                
                self.model = await loop.run_in_executor(
                    _thread_pool,
                    lambda: SentenceTransformer(self.model_name)  # type: ignore[misc]
                )
                print("[INFO] Step 1/3: ✅ Model loaded", file=sys.stderr)

                # Create FAISS index (384 dimensions for all-MiniLM-L6-v2)
                print("[INFO] Step 2/3: Creating FAISS index...", file=sys.stderr)
                self.faiss_index = faiss.IndexFlatIP(VECTOR_SEARCH_DIMENSIONS)  # Inner product for cosine similarity
                print("[INFO] Step 2/3: ✅ FAISS index created", file=sys.stderr)

                # Load existing embeddings from database
                print("[INFO] Step 3/3: Loading existing embeddings from database...", file=sys.stderr)
                self._load_existing_embeddings()
                print(f"[INFO] Step 3/3: ✅ Loaded {self.faiss_index.ntotal} embeddings", file=sys.stderr)

                self.initialized = True
                print(f"[INFO] 🎉 Semantic search ready! ({self.faiss_index.ntotal} entries indexed)", file=sys.stderr)
                sys.stderr.flush()
            except Exception as e:
                print(f"[ERROR] Vector search initialization failed: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc(file=sys.stderr)
                self.initialized = False
                raise VectorSearchError(f"Initialization failed: {e}")

    def _load_existing_embeddings(self):
        """Load existing embeddings from database into FAISS index."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    SELECT entry_id, embedding_vector
                    FROM memory_journal_embeddings
                    WHERE embedding_model = ?
                    ORDER BY entry_id
                """, (self.model_name,))

                vectors: list[Any] = []
                entry_ids: list[int] = []

                for entry_id, embedding_blob in cursor.fetchall():
                    # Deserialize the embedding vector
                    embedding: Any = pickle.loads(embedding_blob)
                    vectors.append(embedding)
                    entry_ids.append(entry_id)

                if vectors:
                    # Normalize vectors for cosine similarity
                    if not HAS_NUMPY:
                        raise RuntimeError("numpy is required for vector operations but not installed")
                    vectors = np.array(vectors, dtype=np.float32)
                    faiss.normalize_L2(vectors)  # type: ignore[call-arg]

                    # Add to FAISS index
                    self.faiss_index.add(vectors)  # type: ignore[call-arg]

                    # Update entry ID mapping
                    for i, entry_id in enumerate(entry_ids):
                        self.entry_id_map[i] = entry_id
        except Exception as e:
            raise VectorSearchError(f"Failed to load embeddings: {e}")

    async def generate_embedding(self, text: str):
        """
        Generate embedding for text using sentence transformer.
        
        Args:
            text: Text to generate embedding for
            
        Returns:
            Numpy array containing the embedding vector
            
        Raises:
            VectorSearchNotInitializedError: If vector search not initialized
            EmbeddingGenerationError: If embedding generation fails
        """
        await self.ensure_initialized()
        
        if not self.initialized or self.model is None:
            raise VectorSearchNotInitializedError()

        # Capture for type narrowing
        model = self.model
        
        try:
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            embedding = await loop.run_in_executor(
                _thread_pool,
                lambda: model.encode([text], convert_to_tensor=False)[0]
            )

            if not HAS_NUMPY:
                raise RuntimeError("numpy is required for vector operations but not installed")
            return embedding.astype(np.float32)
        except Exception as e:
            raise EmbeddingGenerationError(f"Failed to generate embedding: {e}")

    async def add_entry_embedding(self, entry_id: int, content: str) -> bool:
        """
        Generate and store embedding for a journal entry.
        
        Args:
            entry_id: ID of the journal entry
            content: Content of the entry
            
        Returns:
            True if successful, False otherwise
        """
        await self.ensure_initialized()
        
        if not self.initialized or self.faiss_index is None:
            return False

        # Capture for type narrowing
        faiss_idx = self.faiss_index
        
        try:
            # Generate embedding
            embedding = await self.generate_embedding(content)

            # Normalize for cosine similarity
            embedding_norm = embedding.copy()
            faiss.normalize_L2(embedding_norm.reshape(1, -1))  # type: ignore[call-arg]

            # Store in database
            def store_embedding():
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("""
                        INSERT OR REPLACE INTO memory_journal_embeddings
                        (entry_id, embedding_model, embedding_vector, embedding_dimension)
                        VALUES (?, ?, ?, ?)
                    """, (entry_id, self.model_name, pickle.dumps(embedding), len(embedding)))

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(_thread_pool, store_embedding)

            # Add to FAISS index
            faiss_idx.add(embedding_norm.reshape(1, -1))  # type: ignore[call-arg]

            # Update entry ID mapping
            new_index = faiss_idx.ntotal - 1
            self.entry_id_map[new_index] = entry_id

            return True

        except Exception as e:
            print(f"Error adding embedding for entry {entry_id}: {e}", file=sys.stderr)
            return False

    async def semantic_search(
        self,
        query: str,
        limit: int = 10,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    ) -> List[Tuple[int, float]]:
        """
        Perform semantic search and return entry IDs with similarity scores.
        
        Args:
            query: Search query text
            limit: Maximum number of results to return
            similarity_threshold: Minimum similarity score (0.0-1.0)
            
        Returns:
            List of (entry_id, similarity_score) tuples, sorted by score descending
        """
        await self.ensure_initialized()
        
        if not self.initialized or self.faiss_index is None or self.faiss_index.ntotal == 0:
            return []

        # Capture for type narrowing
        faiss_idx = self.faiss_index
        
        try:
            # Generate query embedding
            query_embedding = await self.generate_embedding(query)

            # Normalize for cosine similarity
            query_norm = query_embedding.copy()
            faiss.normalize_L2(query_norm.reshape(1, -1))  # type: ignore[call-arg]

            # Search FAISS index
            scores, indices = faiss_idx.search(
                query_norm.reshape(1, -1),
                min(limit * 2, faiss_idx.ntotal)
            )  # type: ignore[call-arg]

            # Convert to entry IDs and filter by threshold
            results: list[tuple[int, float]] = []
            for score, idx in zip(scores[0], indices[0]):
                if idx != -1 and score >= similarity_threshold:  # -1 means no more results
                    entry_id = self.entry_id_map.get(idx)
                    if entry_id is not None:
                        results.append((entry_id, float(score)))

            # Sort by similarity score (descending) and limit results
            results.sort(key=lambda x: x[1], reverse=True)
            return results[:limit]

        except Exception as e:
            print(f"Error in semantic search: {e}", file=sys.stderr)
            return []

