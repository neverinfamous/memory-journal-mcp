export const IO_HELP = `# IO Operations
- **Exporting**: Supports exporting entries to JSON or Markdown (\`export_entries\`, read-only) or writing individual \`.md\` files on disk (\`export_markdown\`). Native \`.md\` exports wrap **JSON frontmatter** (\`mj_id\`, \`entry_type\`, \`tags\`, \`relationships\`, \`workspace_id\`, etc.) inside \`---\` delimiters for lossless round-tripping.
- **Importing**: \`import_markdown\` re-imports native JSON-frontmattered \`.md\` files and upserts existing entries by \`mj_id\`. \`import_external\` imports external Markdown vaults (\`source_format: "notion" | "obsidian" | "logseq"\`) with standard YAML frontmatter. Both support \`dry_run: true\`.
- **Filesystem Sandbox (\`ALLOWED_IO_ROOTS\`)**: File-based tools (\`export_markdown\`, \`import_markdown\`, \`import_external\`) require paths inside directories permitted by \`--allowed-io-roots\` (\`ALLOWED_IO_ROOTS\`).

## Available Tools

- **Export**: \`export_entries\`, \`export_markdown\`
- **Import**: \`import_markdown\`, \`import_external\`
`;
