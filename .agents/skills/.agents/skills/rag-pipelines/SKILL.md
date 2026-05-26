---
name: rag-pipelines
description: |
  Best practices for Retrieval-Augmented Generation (RAG) pipelines. Use when working with vector databases, embeddings, chunking strategies, semantic search, or hybrid search architectures.
---

# RAG Pipelines

## Core Concepts
- **Chunking**: Chunk by semantics or document structure, not just fixed lengths.
- **Embeddings**: Select appropriate models (e.g. text-embedding-3-small).
- **Retrieval**: Use hybrid search (vector + keyword) and re-ranking for optimal precision.
- **Context Injection**: Carefully format retrieved chunks into the prompt for maximum LLM attention.
