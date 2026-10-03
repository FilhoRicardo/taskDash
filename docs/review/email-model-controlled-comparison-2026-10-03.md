# Email model controlled comparison — 3 October 2026

## Conclusion

The installed Qwen3.5:9b non-reasoning configuration is not reliable for the supplied outbound-check-in acceptance case. Providing full skills, cleaning signatures, shortening instructions, removing structured-output transport, and identifying the task owner did not make it pass. This is not merely missing skill text or signature clutter. These tests do not establish an intrinsic parameter-size limit, prove that all prompt designs fail, or show that a larger model succeeds.

## Method

All inference was through loopback Ollama. The supplied private thread was read in memory; its source and identifying drafts are not copied into this report or repository fixtures. No application code, installed plugin, vault or remote repository was changed by the comparison. The diagnostic harness lives outside the repository in a temporary directory.

Fixed baseline: qwen3.5:9b, temperature 0, thinking disabled, context 8192 and output allowance 512. Each condition was run twice, with condition order reversed in the second round. Repeats were deterministic stability checks, not independent statistical samples. Some conditions overlapped in the local inference queue; wall times must not be interpreted as a speed benchmark.

The original full-skill application request was captured from createEmailAssistant. Cleaned-thread conditions removed signatures and cosmetic lines but retained all message bodies and From/Sent/To/Subject headers. Concise-instruction conditions replaced only the full skill; the application transport contract stayed constant. Native-Markdown conditions retained the full skill and source but removed both the transport instruction and JSON schema. Latest-only ablations deliberately removed history to test interference, not as an acceptable production solution. The reference ablation retained an actual attachment sentence, not a fabricated summary. Owner conditions identified the current user as task owner without supplying the expected answer.

Acceptance required correct latest check-in context, waiting for its recipient's response rather than reviving or resending old requests, a supported historical guide reference when available, and no invented facts or documents. Outputs were inspected manually as well as with bounded assertions.

## Completed non-reasoning trials

| Condition | Completed | Accepted |
| --- | ---: | ---: |
| Full skill, original thread, application transport | 2 | 0 |
| Full skill, cleaned thread, application transport | 2 | 0 |
| Concise instructions, original thread, application transport | 2 | 0 |
| Concise instructions, cleaned thread, application transport | 2 | 0 |
| Full skill, original thread, native Markdown | 2 | 0 |
| Full skill, cleaned thread, native Markdown | 2 | 0 |
| Full skill, latest email only | 2 | 0 |
| Full skill, latest email plus attachment sentence | 2 | 0 |
| Explicit task owner, original thread | 2 | 0 |
| Explicit task owner, cleaned thread | 2 | 0 |
| Explicit task owner, latest email plus attachment sentence | 2 | 0 |
| Total | 22 | 0 |

Full-thread conditions repeatedly revived historical gateway/scheduling actions and sometimes invented completion or supporting documents. Latest-only conditions correctly identified the current sender and enquiry, but still prescribed the recipient's reply or another confirmation rather than the task owner's awaiting-response state. Explicit ownership recovered the guide in the minimal reference case, but did not correct the next action.

Reported input lengths were 801–3200 tokens, below configured context. Completed trials did not report output-limit termination. Context exhaustion and JSON transport alone therefore do not explain the observed failures in these trials.

## Unresolved comparisons

One reasoning-enabled trial, with the full skill and cleaned thread and output allowance increased to 4096, timed out after 240 seconds. Its second trial was explicitly cancelled without a result. This does not show that reasoning mode cannot solve the task; reasoning quality remains unverified.

No larger model was installed or tested, and no private input was sent to a cloud model. Larger-model quality, alternative inference implementations and general email accuracy remain unknown. A model replacement should be judged against this acceptance case and fictional regression cases before deployment; larger size alone is not evidence of success.
