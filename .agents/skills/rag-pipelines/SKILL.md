---
name: rag-pipelines
description: |
  Best practices for Retrieval-Augmented Generation (RAG) pipelines. Use when working with vector databases, embeddings, chunking strategies, semantic search, or hybrid search architectures.
---

# RAG Pipelines

Standards for building high-precision Retrieval-Augmented Generation systems.

## 1. Chunking Strategies

- **Semantic Chunking**: Avoid naive fixed-length character chunking (e.g., strictly 1000 chars). Chunk by natural boundaries: paragraphs, markdown headers, or logical sections.
- **Overlap**: Include a 10-20% token overlap between sequential chunks to preserve cross-boundary context.
- **Metadata Tagging**: Attach rich metadata to every chunk (e.g., document title, author, date, category). This enables pre-filtering before vector similarity search.

## 2. Embeddings & Vector Stores

- **Model Selection**: Use modern embedding models (e.g., OpenAI `text-embedding-3-small`, or specialized open-source models like `BGE` or `Nomic`).
- **Dimensionality**: Higher dimensionality isn't always better if it slows down search. Use dimensionality reduction techniques if supported by the model.
- **Indexing**: Use HNSW (Hierarchical Navigable Small World) indexes for scalable, fast approximate nearest neighbor (ANN) searches.

## 3. Retrieval Optimization

- **Hybrid Search**: Combine Dense (Vector/Semantic) search with Sparse (Keyword/BM25) search. Vector search is good for concepts; Keyword search is critical for exact IDs, names, or acronyms.
- **Re-ranking**: Retrieve a larger set of documents (e.g., top 20) using fast ANN search, then use a Cross-Encoder or an LLM to re-rank the results to the top 5 most relevant chunks.
- **Query Expansion**: Before searching, use an LLM to rewrite or expand the user's query into multiple synonymous queries to increase retrieval recall.

## 4. Context Injection & Generation

- **Formatting**: Present retrieved chunks to the LLM cleanly, enclosed in XML tags (e.g., `<context> <document id="1">...</document> </context>`).
- **Lost in the Middle**: LLMs pay more attention to the beginning and end of their context window. Place the most highly-ranked retrieved chunks at the very top or very bottom of the prompt context.
- **Attribution / Citations**: Prompt the LLM to cite the source document ID when generating its answer (e.g., "According to the handbook [doc_1]...").

## 5. Evaluation

- **RAGAS (RAG Assessment)**: Evaluate the pipeline on separate axes:
  - *Context Precision*: Did we retrieve the right chunks?
  - *Answer Faithfulness*: Did the LLM answer solely based on the chunks (no hallucinations)?
  - *Answer Relevance*: Did the LLM actually answer the user's question?
