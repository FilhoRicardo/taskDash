# Complete email skills — 3 October 2026

Historical report: later integration and verification are recorded in [the completion report](email-assistant-completion-2026-10-03.md). Its runtime and handoff statements describe the state at the time of this experiment.

Verdict: full-skill wiring verified; model-quality acceptance FAILED. Not ready for a reliability claim. No push, installed-plugin replacement or live-vault edits performed.

## Implementation

The two user-supplied SKILL.md files are bundled verbatim in src/ai/emailSkills.ts, including frontmatter and all instructions. Independent SHA256 assertions verify their exact contents. A separate system instruction handles TaskDash's structured output and application boundaries. Full redacted email history is retained alongside a labelled latest message; historical attachments are no longer discarded by source preparation. Custom saved skill text remains untouched.

## Evidence

- 184 application tests, lint, TypeScript/production build and release validation passed. These checks establish implementation behavior, not factual accuracy of model drafts.
- The fictional local-model evaluation failed two checks: unknown shipment status became asserted non-shipment, and a check-in recipient was described as the sender.
- Three full-skill evaluations of the user's private email failed the requested current-state/action acceptance. Two separate system messages were tested with latest-first and latest-last source layouts (37.06 and 93.25 seconds). A single-system transport experiment also failed (30.05 seconds). All revived historical actions rather than awaiting the latest check-in's response. Private source and identifying drafts are not recorded here.
- The single-system experiment does not establish that multiple system messages caused the problem. No such root cause is confirmed.

## Boundaries

Qwen3.5:9b, thinking disabled, temperature 0 and 8,192-token context were used locally. Full skill text alone did not make the requested output reliable. Native Obsidian checks have not been repeated for this candidate. The older adapted-prompt acceptance report is superseded; human review remains essential.
