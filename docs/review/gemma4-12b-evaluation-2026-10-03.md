# Gemma 4 12B evaluation — 3 October 2026

Historical report: later integration and verification are recorded in [the completion report](email-assistant-completion-2026-10-03.md). Its runtime and handoff statements describe the state at the time of this experiment.

Verdict: installed and runnable locally; not approved as the TaskDash replacement. The reported email still fails awaiting-response acceptance. No application runtime, installed plugin, live vault or remote repository was changed during this evaluation.

## Installation and privacy

- Only gemma4:12b is installed. Manifest 6114515d63c1; 11.9B parameters, GGUF Q4_K_M, approximately 8.0GB on disk. The rejected Qwen models remain removed.
- Ollama 0.34.2 listens on 127.0.0.1:11434. disable_ollama_cloud is true. All email inference requests used loopback and the local model tag, not a cloud tag. Model downloading used the registry but contained no work email.
- Inference completed on the M4/16GB Mac. Memory headroom was tight: system free-memory percentage was 11% during testing, and system-wide swap use increased from about 9.9GB to 14.9GB. These are whole-system measurements, not isolated model memory accounting. The model was unloaded after testing; it remains installed. Final free disk space was approximately 19GiB.

## Private email acceptance

The complete supplied thread and complete email-context-action skill were used. Private source and identifying drafts are not stored in this repository. No expected draft was inserted into the prompt.

- Four trials with the existing two-system-message transport: temperature 0/seed 11, then temperature 1/seeds 11, 29, 47. Zero awaiting-response acceptances. Context described the latest check-in and references retained the earlier guide, but Action incorrectly said No action needed.
- Four trials with the full skill retained verbatim inside one system message plus separately marked transport instructions: zero acceptances. The same next-action error persisted; one trial omitted References.
- Four one-system trials additionally identifying the task owner: perspective improved, but all four still said No action needed. One omitted References. First-person/implicit-owner context is semantically acceptable even though the bounded name matcher flagged it; the action failure independently rejects every trial.
- One reasoning-enabled trial used the full skill, joined transport, explicit thinking control, temperature 1/seed 11, context 8192 and output allowance 4096. It completed in 199.39 seconds with 1655 generated tokens, but assigned a status-update action to the recipient instead of awaiting a response from the task owner's perspective. A second reasoning trial was cancelled before completion; it is not counted as a failed result.

Cold or changed-prompt trials took 39–51 seconds. Repeated non-reasoning trials took roughly 4–7 seconds. These are observed end-to-end times for this email, not throughput promises.

## Fictional regression evaluation

The expanded harness ran 19 fixture/mode checks, including two pre-inference hostile-input refusals. It used the full default skills, context 8192, thinking disabled and temperature 1 with top_p 0.95/top_k 64. Sampling settings follow the [published model guidance](https://ollama.com/library/gemma4:12b).

The first run recorded four flags:

1. A task draft reformatted a supplied numeric deadline into equivalent month-name text, which the application's exact-source date guard rejected. This is an output-contract failure, not evidence that the calendar date itself was invented.
2. A matcher rejected not yet been booked, which correctly preserved the source's uncertainty. The matcher was corrected to accept that wording while still rejecting positive booking claims.
3. The unanswered outbound check-in incorrectly said No action needed. This is a genuine semantic failure reproducing the reported problem.
4. A matcher rejected finished as a synonym for complete. The matcher was corrected.

Both matcher corrections were separately checked with positive and negative examples. The complete model suite was not rerun after those corrections, so no all-green suite is claimed. Manual inspection also found an unsupported closure inference in an informational task summary; automated checks are not a factuality guarantee.

184 application tests passed; the evaluator's syntax and diff checks passed. Application tests do not establish model accuracy. Native Obsidian testing and production integration of Gemma were not performed.

## Handoff

The larger local model reads the current thread more faithfully than the earlier rejected outputs, but model replacement alone does not satisfy the requested next-action behavior. Awaiting a reply must be represented clearly as a TaskDash workflow state, distinguished from an informational/closed message. A facts-first pipeline with independently validated sender, recipient and pending-response state remains a proposed solution, not an implemented or verified fix.

TaskDash still references the removed Qwen model; local drafting remains unavailable until an acceptable replacement/configuration is integrated. Do not reinstall a rejected model or promote Gemma merely because it runs.
