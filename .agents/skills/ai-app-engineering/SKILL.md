---
name: ai-app-engineering
description: |
  Master modern AI application engineering patterns. Use when designing LLM applications, prompt chains, multi-agent orchestrations, RAG pipelines, or evaluating output quality. Covers LLM engineering, agent workflows (Supervisor, Plan-and-Execute), and Retrieval-Augmented Generation architectures.
---

# AI Application Engineering

This skill consolidates production-grade patterns for building robust LLM applications, multi-agent systems, and Retrieval-Augmented Generation (RAG) pipelines.

## 1. LLM Application Engineering

- **Context Window Management**: Do not blindly append history to prompts. Implement sliding windows, summarization hooks, or token-based pruning to keep inputs within context limits and ensure high recall for recent instructions.
- **Structured Outputs**: Always force structured outputs (e.g., JSON) using schema-guided generation or strict function calling rather than relying on prompt engineering to "ask nicely for JSON".
- **Evaluation Pipelines (Evals)**: Do not rely solely on human vibe checks. Implement automated deterministic evals (e.g., regex matching, JSON validation) and LLM-as-a-judge evals for semantic quality.

## 2. Multi-Agent Orchestration

- **Pattern: Plan and Execute**: For complex tasks, separate the planning phase (using a high-reasoning model) from the execution phase (using faster, specialized models or tools).
- **Pattern: Supervisor**: In a multi-agent setup, designate a Supervisor agent responsible for delegating sub-tasks to worker agents and synthesizing their final outputs.
- **State Management**: Use graph-based state machines (e.g., LangGraph) to model agent interactions as predictable state transitions with explicit human-in-the-loop (HITL) checkpoints for destructive actions.
- **Agent Isolation**: Worker agents should have the minimum tools required (Principle of Least Privilege). Do not give every agent access to file deletion or database writes.

## 3. RAG Pipelines (Retrieval-Augmented Generation)

- **Chunking Strategy**: Avoid naive character-based chunking. Use semantic chunking (splitting at sentence/paragraph boundaries) or structure-aware chunking (e.g., Markdown header splitting).
- **Hybrid Search**: Do not rely purely on dense vector embeddings. Combine vector search (for semantic meaning) with keyword search (BM25 for exact matches/IDs/names) using Reciprocal Rank Fusion (RRF).
- **Reranking**: Always add a cross-encoder reranking step after initial retrieval. Retrieve a larger pool of documents (e.g., top-20) and rerank them to select the top-5 most relevant chunks to inject into the prompt.
- **Citation and Grounding**: Instruct the LLM to cite specific retrieved chunks in its response. Reject answers that rely on pre-trained knowledge if the task requires strict adherence to retrieved context.
