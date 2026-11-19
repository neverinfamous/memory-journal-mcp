# Memory Journal MCP Observability Stack

This directory contains the satellite monitoring stack for `memory-journal-mcp`, powering Local Grafana and Cloud Datadog monitoring.

## 🚀 Quick Start

1. **Configure Environment:**
   Create a local `.env` in this directory with `DD_API_KEY=<your_key>` if using Datadog (optional for local Prometheus, Grafana, Loki, and Dozzle). On Windows + WSL2 `docker-ce`, run `node test-server/infrastructure/scripts/recreate-ecosystem.mjs` once to install the `mj-metrics-relay.service` loopback bridge automatically.
2. **Start Infrastructure:**
   ```bash
   pnpm infra:up
   ```
3. **Verify:**
   ```bash
   pnpm infra:status
   ```
4. **Access:**
   - **Grafana**: [http://localhost:3002](http://localhost:3002) (`grafana/grafana:13.3.1`, login: `admin` / `admin`)
   - **Prometheus**: [http://localhost:9091](http://localhost:9091) (`prom/prometheus:v3.16.0`)
   - **Loki**: [http://localhost:3102](http://localhost:3102) (`grafana/loki:3.7.10`)
   - **Dozzle**: [http://localhost:8082](http://localhost:8082) (`amir20/dozzle:v11.4.3`, persistent `mj-dozzle-data:/data` volume)

## How It Works

The observability stack runs in decoupled Docker containers (`mj-*`). It **does not** run the MCP server itself.

Whenever you pass `--metrics-export prometheus` (`METRICS_EXPORT=prometheus`), the server automatically spins up an embedded metrics server bound strictly to loopback (`127.0.0.1:9465`, configurable via `MJ_METRICS_PORT` / `MJ_METRICS_HOST`) even in `stdio` mode.

`mj-prometheus` (`:9091`) and `mj-datadog-unified` (`gcr.io/datadoghq/agent:7.85.5`) scrape `host.docker.internal:9465` (`host-gateway`). On Windows + WSL2 `docker-ce` hosts, `scripts/recreate-ecosystem.mjs` installs a lightweight user-systemd relay (`mj-metrics-relay.service` from `scripts/wsl-metrics-relay.mjs`) on WSL2 `docker0` (`172.17.0.1:9465`) to forward scrapes safely to Windows `127.0.0.1:9465` without opening Windows Firewall, while preserving `mj-dozzle-data:/data` (`:8082`) across stack recreations.

## Included Dashboards
- **Token & Tool Metrics:** Real-time visibility into LLM token consumption (`gen_ai.*`), latency percentiles, and tool usage distribution.
- **AI Efficiency:** Advanced metrics estimating token costs, agent quality scores, and session error recovery.
- **Audit & Issue Logs:** Grafana Alloy (`grafana/alloy:v1.22.0`) streams `mcp-audit.jsonl` and `agent-issues.jsonl` into Loki (`:3102`).
