# Adamic Scripts Master Coordinator Workflow

We're working in the `adamic` project/repository in this thread.

> **This document is optimized for an autonomous agent acting as a Master Coordinator.**

This guide instructs the Coordinator agent on how to run the full `adamic` `.agents/scripts` test suite using subagents. 

## Goal

Execute the testing suite (`Tier 1 Usability Fuzzing`) to harden the core agent infrastructure (`lib-agent-exec`, `lib-git-history`, `commit.ts`) focusing purely on reliability, speed, and token efficiency.

## Workflow Rules

1. **Sequential Execution**: All workflows and tests MUST be executed sequentially (one subagent at a time) to prevent parallel mutation conflicts in the core scripts.
2. **Subagent Delegation**:
   - Use the `invoke_subagent` tool to spawn a `self` subagent for each test file.
   - Provide the exact path to the test file as the subagent's prompt.
3. **Local Verification (NO PAUSING)**:
   - If a subagent modifies `lib-agent-exec`, `lib-git-history` or `commit.ts`, they MUST successfully run `bun run typecheck` and `bun run lint` **BEFORE** committing.
   - **WARNING**: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later.
4. **Commit**:
   - Once local tests pass, the subagent will commit the code using `commit.ts`.
   - The coordinator marks the task as done and moves to the next test in the queue.
5. **Coordinator Progress Reporting**:
   - The Coordinator MUST respond to the user with at least these two things as each test proceeds:
     1. "Executing Tier X: Test number X out of X."
     2. "X code issues fixed in previous step."
   - The Coordinator MUST also confirm when subagents are actively working, answer user inquiries, and communicate freely to ensure a smooth workflow.
6. **Skill Enforcement**: The Coordinator MUST explicitly instruct all subagents in their prompt to strictly load and follow the `/pattern-matching` (`C:\Users\chris\Desktop\adamic\skills\pattern-matching\SKILL.md`), `/powershell` (`C:\Users\chris\Desktop\adamic\skills\powershell\SKILL.md`), `/typescript` (`C:\Users\chris\Desktop\adamic\skills\typescript\SKILL.md`), and `/zod` (`C:\Users\chris\Desktop\adamic\skills\zod\SKILL.md`) skills during their execution.
7. **Workspace Hygiene**: The Coordinator MUST explicitly instruct all subagents to NEVER leave temporary or scratch files in the project workspace (like `.json`, `.ts`, or `.txt` dumps). They should use their designated scratch storage (`<appDataDir>\brain\<conversation-id>\scratch\`), or clean up any garbage files they create before finishing their task.
8. **CRITICAL: Subagent Cleanup**: The Coordinator MUST explicitly kill subagents immediately after they report back and finish their tasks. Use the `manage_subagents` tool with the action `kill` (passing the specific conversation ID) or `kill_all` to terminate them. Failure to do so will result in rogue zombie processes draining system resources.
9. **Continuous Self-Improvement**: The Coordinator MUST explicitly instruct all subagents to proactively update `AGENT_README.md` files and testing prompts if they find missing tools, inaccurate docs, or inefficient sequences.

## The Testing Loop

The coordinator must execute the following queue sequentially.

**Tier 1: Usability Fuzzing**
1. `commit/test-usability-commit-cli-empty-staging.md`
2. `commit/test-usability-commit-cli-escaping.md`
3. `commit/test-usability-commit-cli-validation-bounds-impact.md`
4. `commit/test-usability-commit-cli-validation-bounds-confidence.md`
5. `commit/test-usability-commit-cli-validation-bounds-trust.md`
6. `commit/test-usability-commit-cli-validation-category.md`
7. `commit/test-usability-commit-cli-category-optional.md`
8. `commit/test-usability-commit-cli-validation-flags-impact.md`
9. `commit/test-usability-commit-cli-validation-flags-confidence.md`
10. `commit/test-usability-commit-cli-validation-flags-msg.md`
11. `commit/test-usability-commit-cli-validation-format-invalid.md`
12. `commit/test-usability-commit-cli-validation-format-missing-scope.md`
12b. `commit/test-usability-commit-cli-validation-format-breaking.md`
12c. `commit/test-usability-commit-cli-validation-format-breaking-no-scope.md`
13. `commit/test-usability-commit-cli-validation-status-alternative.md`
14. `commit/test-usability-commit-cli-validation-status-banned.md`
15. `commit/test-usability-commit-cli-validation-status-invalid.md`
16. `commit/test-usability-commit-cli-validation-types-impact.md`
17. `commit/test-usability-commit-cli-validation-types-confidence.md`
18. `commit/test-usability-commit-hallucination.md`
19. `commit/test-usability-commit-banned-commands.md`
20. `commit/test-usability-commit-cli-add.md`
21. `commit/test-usability-commit-cli-add-multiple.md`
21b. `commit/test-usability-commit-cli-add-invalid-path.md`
22. `commit/test-usability-commit-cli-msg-alias-message.md`
23. `commit/test-usability-commit-cli-msg-alias-positional.md`
24. `commit/test-usability-commit-cli-msg-alias-short.md`
25. `commit/test-usability-commit-cli-journal.md`
26. `commit/test-usability-commit-cli-help.md`
27. `commit/test-usability-commit-bypass-interceptor.md`
28. `commit/test-usability-commit-cli-history-inline.md`
29. `commit/test-usability-commit-cli-history-file.md`
30. `commit/test-usability-commit-cli-history-skip.md`
31. `commit/test-usability-commit-cli-metadata-significance.md`
32. `commit/test-usability-commit-cli-metadata-trust.md`
33. `commit/test-usability-commit-cli-metadata-cwd.md`
34. `commit/test-usability-commit-cli-metadata-journal-project.md`
35. `commit/test-usability-commit-cli-validation-flags-validation.md`
36. `commit/test-usability-commit-cli-validation-types-trust.md`
36b. `commit/test-usability-commit-cli-validation-types-journal-project.md`
36c. `commit/test-usability-commit-cli-validation-types-category.md`
36d. `commit/test-usability-commit-cli-category-fallback.md`
36e. `commit/test-usability-commit-cli-history-category-parse.md`
36f. `commit/test-usability-commit-cli-merge-state.md`
36g. `commit/test-usability-commit-cli-parseargs-errors.md`
36h. `commit/test-usability-commit-cli-history-missing-fallback.md`
36i. `commit/test-usability-commit-cli-metadata-cwd-invalid.md`
37. `lib-agent-exec/test-usability-agent-exec-payload-flags-bypass.md`
38. `lib-agent-exec/test-usability-agent-exec-payload-integration-context.md`
39. `lib-agent-exec/test-usability-agent-exec-payload-webhook-headers.md`
40. `lib-agent-exec/test-usability-agent-exec-payload-webhook-template.md`
41. `lib-agent-exec/test-usability-agent-exec-payload-webhook-method.md`
42. `lib-agent-exec/test-usability-agent-exec-payload-webhook-timeoutms.md`
43. `lib-agent-exec/test-usability-agent-exec-payload-webhook-onsuccess.md`
44. `lib-agent-exec/test-usability-agent-exec-payload-webhook-onfailure.md`
45. `lib-agent-exec/test-usability-agent-exec-auto-healing-hints.md`
<!-- removed hallucinated bypass tests -->
49. `lib-agent-exec/test-usability-agent-exec-cloud-cli-interceptor.md`
50. `lib-agent-exec/test-usability-agent-exec-environment-protected.md`
<!-- removed hallucinated test: environment-payload.md -->
<!-- removed hallucinated test: flag-stripping-follow.md -->
51. `lib-agent-exec/test-usability-agent-exec-flag-stripping-interactive.md`
51b. `lib-agent-exec/test-usability-agent-exec-flag-stripping-quotes.md`
52. `lib-agent-exec/test-usability-agent-exec-git-interceptor.md`
53. `lib-agent-exec/test-usability-agent-exec-graceful-exits-filters-diff.md`
54. `lib-agent-exec/test-usability-agent-exec-graceful-exits-filters-grep.md`
55. `lib-agent-exec/test-usability-agent-exec-graceful-exits-package-managers-npm.md`
55b. `lib-agent-exec/test-usability-agent-exec-graceful-exits-package-managers-pnpm.md`
56. `lib-agent-exec/test-usability-agent-exec-hallucinations-fs-cat.md`
56b. `lib-agent-exec/test-usability-agent-exec-hallucinations-fs-grep.md`
56c. `lib-agent-exec/test-usability-agent-exec-hallucinations-fs-ls.md`
57. `lib-agent-exec/test-usability-agent-exec-hallucinations-gh.md`
58. `lib-agent-exec/test-usability-agent-exec-hallucinations-inline-bash.md`
58b. `lib-agent-exec/test-usability-agent-exec-hallucinations-inline-pwsh.md`
59. `lib-agent-exec/test-usability-agent-exec-hallucinations-network-curl.md`
59b. `lib-agent-exec/test-usability-agent-exec-hallucinations-network-wget.md`
60. `lib-agent-exec/test-usability-agent-exec-hallucinations-node.md`
61. `lib-agent-exec/test-usability-agent-exec-hanging-repls.md`
62. `lib-agent-exec/test-usability-agent-exec-hanging-tuis.md`
63. `lib-agent-exec/test-usability-agent-exec-hanging-watch-cmd.md`
64. `lib-agent-exec/test-usability-agent-exec-native-proxies.md`
65. `lib-agent-exec/test-usability-agent-exec-payload-schema-bounds-args-limit.md`
66. `lib-agent-exec/test-usability-agent-exec-payload-schema-bounds-cwd-validation.md`
67. `lib-agent-exec/test-usability-agent-exec-payload-string-security.md`
68. `lib-agent-exec/test-usability-agent-exec-payload-timeout-timeoutms.md`
69. `lib-agent-exec/test-usability-agent-exec-payload-timeout-stalltimeoutms.md`
70. `lib-agent-exec/test-usability-agent-exec-payload-validation-envelopes.md`
71. `lib-agent-exec/test-usability-agent-exec-payload-validation-schema.md`
72. `lib-agent-exec/test-usability-agent-exec-payload-stdoutfile.md`
73. `lib-agent-exec/test-usability-agent-exec-payload-stderrfile.md`
74. `lib-agent-exec/test-usability-agent-exec-payload-maxbuffer.md`
75. `lib-agent-exec/test-usability-agent-exec-payload-truncateoutputlength.md`
76. `lib-agent-exec/test-usability-agent-exec-payloads-command-execution.md`
76b. `lib-agent-exec/test-usability-agent-exec-payloads-command-validation.md`
76c. `lib-agent-exec/test-usability-agent-exec-payload-target.md`
77. `lib-agent-exec/test-usability-agent-exec-payloads-eval-node.md`
77b. `lib-agent-exec/test-usability-agent-exec-payloads-eval-python.md`
78. `lib-agent-exec/test-usability-agent-exec-payloads-eval-bash.md`
78b. `lib-agent-exec/test-usability-agent-exec-payloads-eval-pwsh.md`
79. `lib-agent-exec/test-usability-agent-exec-payloads-script.md`
79b. `lib-agent-exec/test-usability-agent-exec-payloads-script-interpreter.md`
80. `lib-agent-exec/test-usability-agent-exec-pipes-basic.md`
81. `lib-agent-exec/test-usability-agent-exec-pipes-false-positives.md`
82. `lib-agent-exec/test-usability-agent-exec-pipes-wsl2.md`
83. `lib-agent-exec/test-usability-agent-exec-prompt-detector-inquirer.md`
83b. `lib-agent-exec/test-usability-agent-exec-prompt-detector-editor.md`
83c. `lib-agent-exec/test-usability-agent-exec-prompt-detector-tty.md`
83d. `lib-agent-exec/test-usability-agent-exec-prompt-detector-progress.md`
83e. `lib-agent-exec/test-usability-agent-exec-prompt-detector-gh.md`
84. `lib-agent-exec/test-usability-agent-exec-pwsh-enforcement.md`
85. `lib-agent-exec/test-usability-agent-exec-stream-multiplexing-formatting.md`
85b. `lib-agent-exec/test-usability-agent-exec-stream-multiplexing-crlf-backspace.md`
85c. `lib-agent-exec/test-usability-agent-exec-stream-multiplexing-flush.md`
86. `lib-agent-exec/test-usability-agent-exec-stream-multiplexing-truncation.md`
87. `lib-agent-exec/test-usability-agent-exec-wsl-boundaries-crlf.md`
88. `lib-agent-exec/test-usability-agent-exec-wsl-boundaries-quoting.md`
89. `lib-agent-exec/test-usability-agent-exec-wsl-core-environment.md`
90. `lib-agent-exec/test-usability-agent-exec-wsl-core-evaluation.md`
91. `lib-agent-exec/test-usability-agent-exec-wsl-paths-arguments.md`
92. `lib-agent-exec/test-usability-agent-exec-wsl-paths-cwd.md`
93. `lib-agent-exec/test-usability-agent-exec-wsl-execution-limits.md`
94. `lib-agent-exec/test-usability-agent-exec-wsl-core-script.md`
95. `lib-agent-exec/test-usability-agent-exec-wsl-io-stdin.md`
96. `lib-agent-exec/test-usability-agent-exec-payload-template-templateoverride.md`
97. `lib-agent-exec/test-usability-agent-exec-payload-template-keeppayload.md`
98. `lib-agent-exec/test-usability-agent-exec-payload-io.md`
99. `lib-agent-exec/test-usability-agent-exec-cli-args-extended-payloadpath.md`
100. `lib-agent-exec/test-usability-agent-exec-cli-args-extended-interceptors.md`
101. `lib-agent-exec/test-usability-agent-exec-cli-args-extended-plugin.md`
102. `lib-agent-exec/test-usability-agent-exec-cli-args-extended-help.md`
103. `lib-agent-exec/test-usability-agent-exec-cli-args-extended-json.md`
104. `lib-agent-exec/test-usability-agent-exec-payloads-eval-bun.md`
105. `lib-agent-exec/test-usability-agent-exec-payload-env.md`
105b. `lib-agent-exec/test-usability-agent-exec-interactive-bypass-agent-bypass.md`
105c. `lib-agent-exec/test-usability-agent-exec-interactive-bypass-native.md`
105d. `lib-agent-exec/test-usability-agent-exec-interactive-bypass-disable-agentexec.md`
107. `lib-git-history/test-usability-git-history-breaking-changes-trailer.md`
108. `lib-git-history/test-usability-git-history-breaking-changes-bang.md`
109. `lib-git-history/test-usability-git-history-banned-commands.md`
110. `lib-git-history/test-usability-git-history-cli-filters-author.md`
111. `lib-git-history/test-usability-git-history-cli-filters-breaking.md`
112. `lib-git-history/test-usability-git-history-cli-filters-range.md`
113. `lib-git-history/test-usability-git-history-cli-filters-since.md`
114. `lib-git-history/test-usability-git-history-cli-filters-until.md`
115. `lib-git-history/test-usability-git-history-cli-filters-category.md`
116. `lib-git-history/test-usability-git-history-cli-filters-type.md`
117. `lib-git-history/test-usability-git-history-cli-filters-path.md`
118. `lib-git-history/test-usability-git-history-cli-filters-search.md`
119. `lib-git-history/test-usability-git-history-cli-filters-grep.md`
120. `lib-git-history/test-usability-git-history-cli-filters-patch.md`
121. `lib-git-history/test-usability-git-history-cli-filters-diff-filter.md`
122. `lib-git-history/test-usability-git-history-cli-formatting-format-json.md`
123. `lib-git-history/test-usability-git-history-cli-formatting-format-markdown.md`
124. `lib-git-history/test-usability-git-history-cli-formatting-format-slack.md`
125. `lib-git-history/test-usability-git-history-cli-formatting-format-custom.md`
126. `lib-git-history/test-usability-git-history-cli-formatting-jsonl.md`
127. `lib-git-history/test-usability-git-history-cli-formatting-changelog.md`
128. `lib-git-history/test-usability-git-history-cli-formatting-no-body.md`
129. `lib-git-history/test-usability-git-history-cli-integration-cache.md`
130. `lib-git-history/test-usability-git-history-cli-integration-help.md`
131. `lib-git-history/test-usability-git-history-cli-integration-issue-pattern.md`
132. `lib-git-history/test-usability-git-history-cli-integration-issue-tracker.md`
133. `lib-git-history/test-usability-git-history-cli-integration-mailmap.md`
134. `lib-git-history/test-usability-git-history-cli-integration-slack-map.md`
135. `lib-git-history/test-usability-git-history-cli-limits-limit.md`
136. `lib-git-history/test-usability-git-history-cli-limits-max-body-length.md`
137. `lib-git-history/test-usability-git-history-cli-limits-max-patch.md`
138. `lib-git-history/test-usability-git-history-cli-diff-context.md`
139. `lib-git-history/test-usability-git-history-cli-traversal-first-parent.md`
140. `lib-git-history/test-usability-git-history-cli-traversal-include-merges.md`
141. `lib-git-history/test-usability-git-history-cli-traversal-all.md`
142. `lib-git-history/test-usability-git-history-cli-traversal-reverse.md`
143. `lib-git-history/test-usability-git-history-cli-formatting-include-patch.md`
144. `lib-git-history/test-usability-git-history-extraction-massive.md`
145. `lib-git-history/test-usability-git-history-extraction-wsl-payload.md`
146a. `lib-git-history/test-usability-git-history-metadata-core.md`
146b. `lib-git-history/test-usability-git-history-metadata-custom.md`
147. `lib-git-history/test-usability-git-history-metrics-binary.md`
148. `lib-git-history/test-usability-git-history-metrics-renames.md`
149. `lib-git-history/test-usability-git-history-nul-bytes-spaces.md`
150. `lib-git-history/test-usability-git-history-record-extended.md`
151a. `lib-git-history/test-usability-git-history-record-core.md`
151b. `lib-git-history/test-usability-git-history-record-authorship.md`
151c. `lib-git-history/test-usability-git-history-record-refs.md`
152. `lib-git-history/test-usability-git-history-record-issues.md`
153. `lib-git-history/test-usability-git-history-record-malformed.md`
154. `lib-git-history/test-usability-git-history-record-reverts.md`
155. `lib-git-history/test-usability-git-history-summary.md`
156. `lib-git-history/test-usability-git-history-schema-bounds.md`
157. `lib-git-history/test-usability-git-history-record-rebased.md`
158. `lib-git-history/test-usability-git-history-record-files-truncated.md`
159. `lib-git-history/test-usability-git-history-record-patch-truncated.md`
160. `lib-git-history/test-usability-git-history-record-size.md`
161. `lib-git-history/test-usability-git-history-schema-is-corrupted.md`

### Stabilization Loop Check
After completing all tests in the sequence above:
- **Did any of the subagents commit structural code changes?**
  - **YES:** The codebase has mutated. You MUST restart the queue from Step 1 (Tier 1) to verify that the recent fixes did not introduce new regressions in other modules.
  - **NO:** The system is completely stable and reliable. Proceed to Finalization.

## Finalization

Once the loop resolves with a completely clean pass (zero code changes committed):
1. Message the user: "The master test suite has stabilized. The infrastructure is robust and token-efficient."
2. Provide a detailed summary to the user outlining exactly what vulnerabilities were found and what reliability/speed fixes were applied across all iterative runs.
