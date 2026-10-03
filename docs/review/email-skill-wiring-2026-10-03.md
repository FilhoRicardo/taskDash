# Email skill wiring candidate — 3 October 2026

Status: implemented locally, not installed or pushed; model-quality checks fail.

The user clarified the mapping: `email-to-taskdash` creates a new task (separate title and five description bullets); `email-context-action` creates a comment on an existing task (Context, Action and optional References). The defaults now implement those instructions. TaskDash assembles Markdown from schema-constrained sections instead of asking the model to format bullet labels. Exact previous built-in prompts migrate; custom instructions remain untouched. All drafts still require explicit review and normal save controls.

Verification:

- 179 application tests passed in Europe/Dublin and UTC; lint, TypeScript/production build, release validation and diff checks passed.
- The opt-in local model evaluation used only fictional email fixtures, including an anonymized progress enquiry with signature and quoted history. No private email fixture was added to the repository; no live-vault files were changed.
- The final non-thinking `qwen3:4b` run had six failing fixture/mode checks: invented time in both deadline modes, malformed/invented date in a quoted-history task, false confirmed progress in the enquiry comment, and copied access code in both modes. One additional comment narration warning remains. The evaluation exits unsuccessfully.
- The false-progress comment took 1.33 seconds and incorrectly said: “Alex confirmed sensor devices are progressing ok with no immediate need for assistance.” The source only asked whether progress was okay. This is not an acceptable result despite valid formatting.
- A separate reasoning-enabled probe (`think:true`, output budget 4096) of that fictional enquiry timed out at the existing 120-second limit. Reasoning mode was not enabled in the application.

Conclusion: the requested skill mapping and deterministic formatting are ready for further testing, but the original semantic bug is not fixed. Do not treat passing application tests as model acceptance. A stronger model or another independently validated generation approach needs evaluation before deployment; remove secrets before pasting and review every factual claim.
