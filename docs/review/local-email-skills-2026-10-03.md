# Local email skill evaluation — 3 October 2026

Three Luna-medium subagents independently assessed the task prompt, comment prompt, and factual/safety constraints. This review concerns the two configurable prompts, not the repository's development skills. All model inputs were fictional; no real vault was read or modified.

## Decisions

Keep the existing default prompts. Candidate rewrites were not reliably better on installed Qwen3 4B in non-thinking mode. Their stronger instructions are proposals, not verified protection. Do not overwrite saved per-vault/custom prompts. No model replacement, live-vault installation or GitHub push is part of this pass.

The reviewers proposed action-first titles, handling related requests together, following the latest message, attributing disagreements, direct activity wording, and omitting passwords/access codes. Several candidates were tested through the actual application service, preserving its schema, limits, source-date guard and explicit-save boundary.

Observed candidate failures:

- Direct-writing instructions still produced “the email requests…” narration.
- A fictional style example was copied into an unrelated meter update. That candidate and example were discarded.
- Broader task rewrites invented “2:00 PM” for an email containing only an ISO deadline. The runtime rejected the output.
- A comment candidate reported a requested schedule enquiry as already made; another became repetitive and hit the output limit. Those candidates were discarded.
- Even the minimal “omit passwords and access codes” instruction copied the fictional access code into a task description. It did not establish redaction protection and was not adopted.

These outcomes disprove the assumption that a tightly written prompt alone removes the need for model capability and human review. The guards reject some bad outputs, not every unsupported statement or copied secret.

## Evaluation improvements

`scripts/evaluate-local-email.mjs` now tests related requests, an informational comment with no follow-up, and a fictional access code in addition to the earlier fixtures. It checks title labels, latest-message uncertainty and unexecuted requested actions. It distinguishes direct-writing style warnings from hard failures, records every fixture failure rather than stopping at the first, and exposes rejected fictional output for diagnosis. Only the intended no-action error counts as a successful no-action refusal.

The expanded evaluation is expected to fail if either draft copies the fictional access code. That is an uncovered quality defect, not a passing safety check. The script does not redact user emails or guarantee semantic accuracy. Automated phrase checks are limited; inspect printed drafts as well.

Final actual-model run with the unchanged defaults: 16 mode-specific checks, two hard failures (the fictional code copied in both task and comment), and two narration warnings (deadline and conflicting-report comments). The other scripted checks passed, including two before-inference hostile-input refusals and the intended no-action refusal. This is a limited fixture result, not a general 14/16 accuracy score.

Application verification: all 173 unit/integration tests passed; lint, TypeScript/production build, release validation and diff checks passed. The expanded optional model evaluation exited with status 1 as intended for those two unresolved failures. The rebuilt bundle is unchanged because no runtime/default prompt changes were retained.

## User impact and next step

Existing defaults, runtime and config behavior remain unchanged. Remove secrets before pasting email text and review every preview before Create Task/Add. No draft is applied by this evaluation. Improving instruction-following further should be evaluated with a different local model or a deterministic safeguard; neither was silently added here.
