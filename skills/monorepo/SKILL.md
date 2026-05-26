---
name: monorepo
description: |
  Monorepo architecture and configuration standards. Use when working with Turborepo, pnpm workspaces, npm workspaces, or configuring shared packages, tsconfig bases, and internal dependencies.
---

# Monorepo Standards

Monorepos organize multiple applications and packages in a single repository, but require strict configuration to avoid dependency hell and build-time bottlenecks.

## 1. Workspace Configuration (pnpm workspaces)

- **Root Definition**: Define the `pnpm-workspace.yaml` explicitly at the root, separating applications (`apps/*`) from internal libraries (`packages/*`).
- **Internal Dependencies**: Link internal packages using the `workspace:*` protocol. This ensures that the package manager resolves to the local source rather than attempting to fetch from the npm registry.

```json
{
  "dependencies": {
    "@my-org/ui": "workspace:*",
    "@my-org/tsconfig": "workspace:*"
  }
}
```

## 2. Turborepo Configuration

- **Pipeline Definition**: Define dependencies in `turbo.json`. Ensure `build` depends on `^build` (meaning a package's build step waits for its dependencies to build first).
- **Caching**: Ensure `outputs` are correctly defined for cache hits (e.g., `.next/**`, `dist/**`).
- **Dev Tasks**: The `dev` task should typically be configured as `persistent: true` since it starts a long-running server.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

## 3. Shared Configurations

- **Shared TSConfig**: Create a `packages/tsconfig` containing `base.json`, `nextjs.json`, and `react-library.json`. Applications should extend these rather than duplicating compiler options.
- **Shared ESLint/Prettier**: Centralize linting rules in a `packages/eslint-config` workspace to guarantee consistency across all apps.
- **Entrypoints**: Use `"main"`, `"module"`, and `"types"` fields in `package.json` correctly for shared packages. Alternatively, rely on modern bundlers and Next.js transpile packages to consume raw TypeScript (`src/index.ts`).

## 4. CI/CD Integration

- **Remote Caching**: Always enable Vercel Remote Caching or an equivalent remote cache in CI to drastically reduce build times for unmodified packages.
- **Affected Builds**: Use `--filter` commands (`turbo run build --filter=...[origin/main]`) to only test and build packages that changed in the current PR.
