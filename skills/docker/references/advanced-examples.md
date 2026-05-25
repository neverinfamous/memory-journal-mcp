# Advanced Docker & Compose Examples

## Docker Compose v2

### Structure

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime # Target a specific stage
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

### Best Practices

- **Use `depends_on` with health checks** — not just service start order
- **Use named volumes** for persistent data — never bind-mount the entire project in production
- **Use environment files** (`env_file:`) for non-secret config
- **Use `secrets:`** for credentials — they are mounted as files, not env vars
- **Pin image versions** — `postgres:17-alpine`, not `postgres:latest`

## CI/CD Integration

### GitHub Actions Pattern

```yaml
- name: Build and push
  uses: docker/build-push-action@<sha>
  with:
    context: .
    push: true
    tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

- **Use GitHub Actions cache** (`type=gha`) for CI builds
- **Tag with commit SHA** — never `:latest` for production
- **Scan before push** — run vulnerability scanning as a build step
