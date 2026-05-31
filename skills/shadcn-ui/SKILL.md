---
name: shadcn-ui
description: |
  Use when adding, customizing, or structuring shadcn/ui components in a project.
  Also use when dealing with `components.json`, Tailwind configuration for shadcn, or component registries.
  Use when working with shadcn/ui, `components.json`, `lucide-react`, `radix-ui`, or Tailwind component registries.
---

# shadcn/ui Agent Workflow

When asked to work with shadcn/ui components, follow this imperative workflow to ensure you generate correct code that aligns with the project's configuration.

## 1. Context Gathering

Before generating any code or installing components, you must determine the project's configuration:

- Inspect `components.json` to find the `aliases`, `tailwind` configuration, and the `style` (e.g., `default` or `new-york`).
- Identify the base library being used (e.g., `lucide-react` or Radix primitives).
- Check which components are already installed in the `components/ui/` directory.

## 2. Component Installation & Discovery

- **Search first:** If a required component is not installed, search the documentation or registry for it.
- **Install securely:** To install a component, use the official CLI command `npx shadcn@latest add [component]`.
- **Registry Security:** Do NOT blindly install components from third-party or untrusted registries (e.g., via URLs) without explicitly reviewing the source code first and requesting user approval.

## 3. Composition & Customization

When assembling components (e.g., forms, dashboards, settings pages):

- **Follow patterns:** Use established shadcn/ui composition rules. For example, use `Form` and `FormField` wrappers for forms, and `ToggleGroup` for option sets.
- **Semantic CSS:** Use the project's semantic CSS variables (e.g., `bg-background text-foreground`, `bg-primary`) rather than hardcoded Tailwind colors.
- **Customization:** To customize a component, edit its source code in the `components/ui/` directory directly. Do not wrap it in unnecessary outer `div`s just to apply styles if modifying the component itself is cleaner.

## 4. Version Upgrades

When upgrading shadcn/ui components or the CLI itself, always review the [official changelog](https://ui.shadcn.com/docs/changelog) before running update commands to ensure no breaking changes affect customized components.
