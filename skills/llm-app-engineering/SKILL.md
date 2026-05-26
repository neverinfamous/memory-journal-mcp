---
name: llm-app-engineering
description: |
  Master modern LLM application engineering patterns. Use when designing prompt chains, evaluating output quality, managing token limits, streaming responses, or integrating LLMs into full-stack applications. SECURITY: Always sanitize user input before passing to LLM prompts to prevent prompt injection.
---

# LLM App Engineering

Core principles for building robust LLM applications.

## Key Patterns
- **Prompt Engineering**: Use few-shot, chain-of-thought, and clear system instructions.
- **Context Window Management**: Do not blindly append history to prompts. Implement sliding windows, summarization hooks, or token-based pruning to keep inputs within context limits and ensure high recall for recent instructions.
- **Token Management**: Track usage, handle limits gracefully, and summarize context dynamically.
- **Structured Outputs**: Always force structured outputs (e.g., JSON) using schema-guided generation or strict function calling rather than relying on prompt engineering to "ask nicely for JSON".
- **Streaming**: Always stream responses for perceived performance improvements in UX.
- **Evaluations (Evals)**: Build automated eval pipelines for your prompts to catch regressions. Do not rely solely on human vibe checks. Implement automated deterministic evals (e.g., regex matching, JSON validation) and LLM-as-a-judge evals for semantic quality.
