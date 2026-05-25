---
name: building-ai-agent-on-cloudflare
description: |
  High-level integration guide for deploying AI agents on Cloudflare. 
  Use when initializing a new Cloudflare agent project using the CLI `create cloudflare` tools.
  For detailed implementation, state management, or WebSockets, refer to the `agents-sdk` skill.
---

# Deploying AI Agents on Cloudflare

This is a high-level integration guide for bootstrapping Cloudflare AI agents.

## 1. Project Initialization

When asked to scaffold a new agent, use the official Cloudflare CLI template:

```bash
npm create cloudflare@latest -- my-agent --template=cloudflare/agents-starter
cd my-agent
npm start
```

## 2. Delegation to `agents-sdk`

**CRITICAL**: This document no longer maintains detailed implementation logic to prevent duplication.

For all code implementation details, including:
- WebSockets (`onConnect`, `onMessage`)
- State Management (`this.state`, `this.setState`)
- Scheduled Tasks (`this.schedule`)
- Durable Workflows
- MCP Integration (`McpAgent`)

**→ You MUST refer to the `agents-sdk` skill and its references.**

## 3. Deployment

Once the agent is implemented using `agents-sdk` paradigms, deploy using:

```bash
# Deploy to Cloudflare Workers
npx wrangler deploy

# View live logs
wrangler tail

# Test endpoint
curl https://my-agent.workers.dev/agents/MyAgent/test-session
```
