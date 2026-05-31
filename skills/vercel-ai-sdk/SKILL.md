---
name: vercel-ai-sdk
description: |
  Vercel AI SDK best practices and patterns. Use when building AI applications with React/Next.js and `@ai-sdk/react`, `@ai-sdk/core`, or `@ai-sdk/ui`. Covers `useChat`, `streamText`, `generateObject`, tool calling, and streaming architectures. SECURITY: Never pass raw user inputs to executable tools without strict Zod schema validation.
---

# Vercel AI SDK Guidelines

The Vercel AI SDK is the de facto standard for building streaming AI applications in TypeScript and React.

## 1. Core API (`@ai-sdk/core`)

- **Text Generation**: Use `streamText` for any user-facing chat or text response to minimize perceived latency. Only use `generateText` for background tasks where the user is not waiting for a real-time response.
- **Structured Outputs**: Use `streamObject` or `generateObject` paired with Zod schemas to guarantee type-safe JSON outputs. Never prompt the model manually to "return JSON".
- **Tool Calling**: Define tools using the `tool()` helper with strict Zod schemas.

```typescript
import { streamText, tool } from 'ai'
import { z } from 'zod'

const result = streamText({
  model: myModel,
  messages,
  tools: {
    weather: tool({
      description: 'Get the weather in a location',
      parameters: z.object({ location: z.string() }),
      execute: async ({ location }) => fetchWeather(location),
    }),
  },
})
```

## 2. UI Hooks (`@ai-sdk/react`)

- **`useChat`**: The primary hook for conversational interfaces. It automatically manages message history, streaming state, and tool invocations.
- **Error Handling**: Implement the `onError` callback in `useChat` to gracefully handle API rate limits or network failures.
- **Data Streaming**: Use the `data` property exported from `useChat` to stream auxiliary data (like tool execution metadata or citations) alongside the main text stream.

## 3. Server Actions & Next.js Integration

- **App Router**: When using Next.js App Router, implement Route Handlers (`app/api/chat/route.ts`) that return `result.toDataStreamResponse()` for seamless streaming to `useChat`.
- **RSC (React Server Components)**: For generative UI, use the `ai/rsc` module to stream React components directly from the server to the client.

## 4. Security & Safety

- **Rate Limiting**: Always apply rate limiting to your chat endpoints, as LLM APIs are expensive and vulnerable to abuse.
- **Provider API Keys**: Ensure `OPENAI_API_KEY` (or equivalent) is strictly kept server-side. Never expose these keys to the client.
