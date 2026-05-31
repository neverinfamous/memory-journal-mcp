---
name: biome
description: |
  Biome formatting and linting standards. Use when configuring Biome (biome.json) for fast formatting, linting, and sorting imports. NOT for Prettier or ESLint configuration. Do NOT trigger for generic formatting/linting tasks unless Biome is explicitly requested.
---

# Biome Guidelines

Biome is a high-performance toolchain for web projects, intended to replace Prettier and ESLint in modern codebases.

## 1. Configuration (`biome.json`)

- **Single Config**: Define all rules in a unified `biome.json` at the root of the project.
- **Formatting Match**: Configure Biome's formatter to match standard Prettier settings (e.g., `lineWidth: 80`, `indentStyle: "space"`).
- **Import Sorting**: Enable `organizeImports` to automatically sort and group imports on save.

```json
{
  "$schema": "https://biomejs.dev/schemas/1.8.3/schema.json",
  "formatter": {
    "enabled": true,
    "formatWithErrors": false,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useImportType": "error"
      }
    }
  }
}
```

## 2. CI/CD Integration

- **Check Command**: Run `npx @biomejs/biome ci .` in CI pipelines. This command checks formatting, runs the linter, and verifies import sorting all in one pass. It fails if any violations are found.
- **Pre-commit Hooks**: Integrate `biome check --write --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}` into Husky/lint-staged to format code before committing.

## 3. Editor Integration

- **VS Code**: Ensure the `.vscode/settings.json` sets Biome as the default formatter and enables "format on save" and "organize imports on save".

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.organizeImports.biome": "explicit"
  }
}
```
