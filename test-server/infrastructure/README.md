# Memory Journal MCP Observability Stack

This directory contains the satellite monitoring stack for `memory-journal-mcp`, powering Local Grafana and Cloud Datadog monitoring.

## 🚀 Quick Start

1. **Configure Environment:**
   Copy `.env.example` to `.env` (or let the automated tools populate it). Make sure `DD_API_KEY` and `WINDOWS_HOST_IP` are set.
2. **Start Infrastructure:**
   ```bash
   pnpm infra:up
   ```
3. **Verify:**
   ```bash
   pnpm infra:status
   ```
4. **Access:**
   - **Grafana**: [http://localhost:3001](http://localhost:3001) (admin/admin)
   - **Dozzle**: [http://localhost:8080](http://localhost:8080)

## How It Works

The observability stack runs in decoupled Docker containers. It **does not** run the MCP server itself. 

You run the MCP server normally in your IDE or terminal. Whenever you use the `--metrics-export prometheus` flag, the server automatically spins up a lightweight, embedded metrics server on port `9465` (even in standard `stdio` mode).

The Dockerized Prometheus instance scrapes `host.docker.internal:9465`, making those metrics available to Grafana and Datadog.

## Included Dashboards
- **Token & Tool Metrics:** Real-time visibility into LLM token consumption, latency percentiles, and tool usage distribution.
- **AI Efficiency:** Advanced metrics estimating token costs, agent quality scores, and session error recovery.
- **Audit Logs:** Integrated Loki streams for all `mcp-audit.jsonl` entries.
