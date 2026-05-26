---
name: rag-pipelines
description: |
  Best practices for Retrieval-Augmented Generation (RAG) pipelines. Use when working with vector databases, embeddings, chunking strategies, semantic search, or hybrid search architectures.
---

# RAG Pipelines

## Core Concepts
- **Chunking**: Chunk by semantics or document structure, not just fixed lengths. Avoid naive character-based chunking. Use semantic chunking (splitting at sentence/paragraph boundaries) or structure-aware chunking (e.g., Markdown header splitting).
- **Embeddings**: Select appropriate models (e.g. text-embedding-3-small).
- **Retrieval**: Use hybrid search (vector + keyword) and re-ranking for optimal precision. Do not rely purely on dense vector embeddings. Combine vector search (for semantic meaning) with keyword search (BM25 for exact matches/IDs/names) using Reciprocal Rank Fusion (RRF). Always add a cross-encoder reranking step after initial retrieval. Retrieve a larger pool of documents (e.g., top-20) and rerank them to select the top-5 most relevant chunks to inject into the prompt.
- **Context Injection**: Carefully format retrieved chunks into the prompt for maximum LLM attention. Instruct the LLM to cite specific retrieved chunks in its response. Reject answers that rely on pre-trained knowledge if the task requires strict adherence to retrieved context.
