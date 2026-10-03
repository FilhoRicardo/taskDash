# Qwen3.5 9B local evaluation — 3 October 2026

Installed with the user's approval through existing native Ollama 0.34.2. TaskDash's runtime model remains unchanged; no plugin installation, vault edits or GitHub push were performed.

## Installation and resources

- Model: `qwen3.5:9b`, manifest ID `6488c96fa5fa`, Q4_K_M, 9.7B parameters according to the local model metadata.
- Download completed and Ollama verified the SHA-256 digest; installed size 6.6 GB.
- Mac mini: Apple M4, 16 GB unified memory. Roughly 11 GiB disk space remains after download.
- Evaluation used 8,192-token context, temperature 0, non-thinking mode and output budget 512. Ollama reported 100% GPU execution and 5.5 GB loaded model size. Cloud features remain disabled.
- Previous `qwen3:4b` was unloaded from memory, not deleted. Both models remain installed.

## Results

Command: `node --experimental-strip-types scripts/evaluate-local-email.mjs qwen3.5:9b 8192`

The harness now accepts optional candidate model/context arguments, without changing the plugin's production configuration. Two overly narrow uncertainty assertions were expanded to accept equivalent valid wording. Independent manual review exposed two missing semantic checks, which were added rather than counting their faulty outputs as passes.

Final run: 17 fixture/mode checks, four failures, no narration warnings. This includes two pre-inference hostile-input refusals; passing checks are bounded assertions, not comprehensive factual validation.

Failures:

1. A task changed unknown shipment status into confirmed non-shipment.
2. A comment attributed the latest check-in to its recipient, rather than its sender.
3. The task copied a fictional access code despite redaction instructions.
4. The comment copied the same fictional access code.

The previously invented deadline times did not reproduce. Date/quoted-history and conflict checks passed. One deadline task still included its source date in the title despite the default prompt asking for no dates there; this is an additional style deviation, not an invented date.

Timing samples: first task including loading 18.60 seconds; subsequent task samples roughly 9–15 seconds and comments roughly 5–8 seconds. These are individual observations, not latency guarantees; one run included queued private-source probes.

## Private source probes

The user's original pasted email was processed only through local loopback inference, with no source text or identifying draft content added to this report or the repository. The full thread took 20.88 seconds and focused on an older request rather than the latest check-in. A latest-message-only excerpt took 8.39 seconds but still treated the progress question as a confirmation. Removing history alone therefore did not fix the semantic bug.

A separate reasoning-enabled probe of the two-line latest message used 8,192-token context and a 2,048-token output budget. It timed out at the application's 120-second limit without returning an accepted draft. Reasoning mode was not enabled in TaskDash.

Conclusion: stronger local inference is feasible on this machine and improves several synthetic cases, but non-thinking Qwen3.5 9B does not meet acceptance for the reported bug. It was not selected for TaskDash. Human review and removing secrets before input remain necessary.
