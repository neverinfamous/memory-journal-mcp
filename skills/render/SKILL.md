---
name: render
description: |
  Render platform deployment and management best practices. Use when configuring render.yaml (Blueprint specs), deploying web services, background workers, cron jobs, or managing Render PostgreSQL/Redis instances. NOT for AWS, GCP, Azure, or generic container orchestration. Require explicit target environment before triggering.
---

# Render Deployment Best Practices

Guidelines for managing infrastructure and deploying applications on the Render platform.

## 1. Infrastructure as Code (render.yaml)

- **Blueprints**: Always use Render Blueprints (`render.yaml`) to define your infrastructure. This enables GitOps, ensures reproducibility, and prevents configuration drift in the dashboard.
- **Sync Environments**: Define multiple environments (e.g., staging, production) using environment-specific branches and `render.yaml` configurations.

## 2. Web Services & Background Workers

- **Health Checks**: Always define a `healthCheckPath` in `render.yaml`. Render uses this to ensure zero-downtime deployments. If the health check fails, the new deploy is aborted and the old version remains live.
- **Start Commands**: Ensure your start command starts a production-ready web server (e.g., `gunicorn`, `pm2`, or Node.js `server.js`). Do not use development servers (e.g., `npm run dev`, `flask run`) in production.
- **Background Workers**: Separate long-running tasks into Background Workers. Background Workers do not have exposed HTTP ports and won't be killed for failing to bind to a port (unlike Web Services).

## 3. Databases (PostgreSQL & Redis)

- **Internal Connections**: Always connect Web Services to Databases using the **Internal Database URL**. This traffic stays within Render's private network, which is faster and vastly more secure.
- **External Access**: Restrict external database access. If you must connect externally (e.g., for local debugging), use the Access Control list to whitelist specific IP addresses rather than allowing `0.0.0.0/0`.
- **Migrations**: Execute database migrations using the `preDeployCommand`. This runs before the new code goes live, ensuring the schema is ready for the new application version.

## 4. Environment Variables & Secrets

- **Secret Files**: For files like `.env`, use Render's Secret Files feature. Reference them in `render.yaml`.
- **Env Var Groups**: Group common environment variables (like AWS credentials or API keys used across multiple services) into Environment Groups and link them to services in your Blueprint.

## 5. Disks & Stateful Data

- **Persistent Disks**: Render's ephemeral filesystems are wiped on every deploy. If your application needs to store files locally (e.g., SQLite databases, uploaded images), you MUST attach a Persistent Disk to the service and mount it to the correct path.
