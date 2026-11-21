/**
 * Path-neutral rewriting for vendored Markdown docs (e.g. `src/vendor/<lib>/AGENT_README.md`).
 *
 * [INTENT] Upstream READMEs reference host-only wrappers such as `bun .\.agents\scripts\commit.ts`.
 * Inside this repository `.agents/scripts` does not exist, so agents that follow those instructions
 * verbatim hit "file not found" friction. `sync-vendor.ts` pipes every vendored `.md` file through
 * {@link neutralizeVendoredDoc} so the shipped copies describe the wrappers without host paths.
 * [INVARIANT] The transform is idempotent: its output contains no rewritable `.agents/scripts` forms.
 */

/** `bun [test] .\.agents\scripts\<path> <args>` (any slash style) wrapped in a single backtick span. */
const BUN_WRAPPER_SPAN = /`bun\s+(?:(test)\s+)?(?:\.[\\/])?\.agents[\\/]scripts[\\/]([^`\s]+)([^`]*)`/g;

/** Bare backticked `.agents/scripts/<file>.<ext>` or directory-trailing `.agents/scripts/<dir>/` references. */
const BARE_SCRIPT_SPAN = /`(?:\.[\\/])?\.agents[\\/]scripts[\\/]([\w./\\-]+\.(?:ts|mts|mjs|md)|[\w./\\-]+[/\\])`/g;

/** Detects any remaining rewritable form (used by `sync-vendor.ts --check`). */
const REWRITABLE_FORM = /`bun\s+(?:test\s+)?(?:\.[\\/])?\.agents[\\/]scripts[\\/]|`(?:\.[\\/])?\.agents[\\/]scripts[\\/](?:[\w./\\-]+\.(?:ts|mts|mjs|md)|[\w./\\-]+[/\\])`/;

const COMMIT_WRAPPER = 'commit.ts';
const LOCAL_COMMIT_COMMAND = 'pnpm exec tsx scripts/commit.ts';

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Rewrite host-specific `.agents/scripts` invocations into path-neutral wording.
 * - `` `bun .\.agents\scripts\commit.ts --msg x` `` → `` `pnpm exec tsx scripts/commit.ts --msg x` ``
 * - `` `bun .\.agents\scripts\get-git-history-json.ts --help` `` → ``the host's `get-git-history-json.ts --help` wrapper``
 * - `` `bun test .agents/scripts/lib-git-history/tests/` `` → ``the host's `bun test lib-git-history/tests/` suite``
 * - `` `.agents/scripts/usability/coordinator-workflow.md` `` → ``the host's `usability/coordinator-workflow.md` ``
 */
export function neutralizeVendoredDoc(content: string): string {
  return content
    .replace(BUN_WRAPPER_SPAN, (_match: string, subcmd: string | undefined, rawPath: string, rest: string) => {
      const scriptPath = toForwardSlashes(rawPath);
      if (subcmd === 'test') return `the host's \`bun test ${scriptPath}${rest}\` suite`;
      if (scriptPath === COMMIT_WRAPPER) return `\`${LOCAL_COMMIT_COMMAND}${rest}\``;
      return `the host's \`${scriptPath}${rest}\` wrapper`;
    })
    .replace(BARE_SCRIPT_SPAN, (_match: string, rawPath: string) => `the host's \`${toForwardSlashes(rawPath)}\``);
}

/** True when the document still contains a form that {@link neutralizeVendoredDoc} would rewrite. */
export function hasHostScriptReferences(content: string): boolean {
  return REWRITABLE_FORM.test(content);
}
