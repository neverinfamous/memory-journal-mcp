---
name: llm-app-engineering
description: |
  Master modern LLM application engineering patterns. Use when designing prompt chains, evaluating output quality, managing token limits, streaming responses, or integrating LLMs into full-stack applications.
---

# LLM App Engineering

Core principles and implementation standards for building robust, production-ready LLM applications.

## 1. Prompt Engineering Standards

- **System Instructions**: Establish character, constraints, and specific output formats at the system level.
- **Few-Shot Prompting**: Provide 2-3 examples of ideal input/output pairs to ground the model.
- **Chain of Thought (CoT)**: Force the model to output its reasoning `<thinking>` before the final answer to improve logical accuracy.
- **Structured Outputs**: Always use JSON schemas or Zod validation when the application expects structured data (e.g., via tool calls or JSON mode).

## 2. Token Management & Optimization

- **Context Window Limits**: Never blindly append logs or documents. Always truncate, summarize, or chunk inputs before sending.
- **Token Efficiency**: Strip unnecessary HTML/Markdown boilerplate from inputs. Use clean text or JSON.
- **Context Caching**: For APIs that support it (like Anthropic's Prompt Caching), structure your prompts to place static context (system prompts, large documents) at the beginning of the prompt.

## 3. Streaming & UX Patterns

- **Always Stream**: Unless the output is strictly structured data meant for background parsing, stream the response to the client.
- **Optimistic UI**: Display skeleton loaders or loading states instantly while the LLM request initializes.
- **Partial Parsing**: When streaming structured data (like JSON), use partial JSON parsers to render intermediate states to the UI.

## 4. Evaluation & Testing (Evals)

- **Deterministic Assertions**: Use traditional unit tests for exact string matches, JSON schema validation, or regex patterns.
- **LLM-as-a-Judge**: Use a stronger model (e.g., GPT-4) to evaluate the output of a weaker/faster model based on a rubric.
- **Golden Datasets**: Maintain a dataset of 50-100 tricky edge-case inputs and run regressions against them whenever prompt engineering changes.

## 5. Security & Safety

- **Prompt Injection**: Never trust user input. Sandbox LLM outputs when rendering to the DOM (use DOMPurify or React's auto-escaping).
- **Tool Call Safety**: Require explicit User Confirmation (HITL - Human in the Loop) for any tool call that mutates data or performs irreversible actions.
