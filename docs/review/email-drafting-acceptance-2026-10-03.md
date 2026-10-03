# Email drafting acceptance — 3 October 2026

Superseded: this report describes the earlier adapted-prompt, filtered-history candidate. The user subsequently requested the complete skills and full thread context. That candidate does not pass model-quality acceptance; see [the current evaluation](full-email-skills-2026-10-03.md). The evidence below is historical, not acceptance of the current build.

Verdict: suitable for a human-reviewed preview of the reported workflow, not a guarantee of arbitrary email accuracy. Built locally; no GitHub push, installed-plugin replacement or live-vault writes.

## Fix and feedback loop

The user's explicitly supplied private email was the acceptance case. Local inference previously revived an older gateway request and misattributed the enquiry. A CLI assertion against that exact source failed before the fix. A reduced latest-message-plus-subject probe separated thread-priority errors from recipient attribution; explicit role/question rules corrected the latter. Greedy decoding was left unchanged; the earlier reasoning timeouts do not establish its cause.

The runtime candidate now uses `qwen3.5:9b` at 8,192-token context. Source preparation recognizes common headers, reply boundaries, standalone greetings and signature markers, preserves the thread subject, and distinguishes recipients named in greetings from senders. Quoted material is retained when the latest message explicitly refers below, forwards a request, references a thread or approves proceeding. Clearly labelled credentials are replaced before inference; a detected-value echo guard rejects copied values of at least four characters. This is limited protection, not a comprehensive redactor or email parser.

The comment prompt records questions as enquiries rather than answers. A separate synthetic task regression exposed an unsupported negative shipment claim; the task prompt now requires uncertainty in every section, including the distinction between unknown and false. Default task output remains five bullets plus a title; comments remain Context, Action and optional References. Human approval and normal save controls remain unchanged.

## Verification

- Original private email: same appropriate comment on three consecutive runs, then the same output again on the final built candidate. It captured the latest check-in and request for support without asserting confirmed progress, attributing the enquiry to its recipient, quoting greetings/headers, or reviving the older gateway action. Timing: 15.14, 3.81 and 3.76 seconds; final overlapping-run sample 13.11 seconds. Source and identifying draft content are not copied into this repository.
- Regression tests went red for source separation and pre-inference credential redaction before implementation, then passed. Additional service tests cover CRLF/standard headers, inline greeting requests, explicitly referenced quoted requests, quoted-only refusal and detected-credential output refusal.
- All 183 application tests passed in Europe/Dublin and UTC.
- Final `node --experimental-strip-types scripts/evaluate-local-email.mjs`: all 17 bounded fixture/mode checks passed, zero recorded failures or narration warnings. Two checks are pre-inference hostile-input refusals. Equivalent uncertainty wording was accepted; semantic checks for false confirmation, recipient attribution, invented times, credential copying and unknown shipment status remain active.
- Lint, TypeScript/production build, release validation and diff checks passed. Production dependency audit reported zero vulnerabilities.

## Remaining boundaries

Unrecognized email layouts and implied references to history may require manual cleanup. Pattern-based credential protection cannot cover all secrets. The finite model evaluation is not comprehensive factual validation, and short task summaries can still be repetitive. The new bundle has not yet been tested through native Obsidian UI or installed in a vault. Review generated facts and next actions before saving; the preview does not autonomously perform any action.

Earlier reports preserve the rejected-model/prompt evidence before these fixes; this report records the current candidate's acceptance result.
