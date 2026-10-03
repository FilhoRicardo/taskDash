# Task draft prompt refinement — 3 October 2026

Historical report: later integration and verification are recorded in [the completion report](email-assistant-completion-2026-10-03.md). Its runtime and handoff statements describe the state at the time of this experiment.

Scope: local prompt experiment only. No tasks, live-vault writes, installed-plugin replacement, application runtime changes or GitHub push.

The user's clarified goal is a short title, a three-sentence memory recap of the whole thread, and an action only when clearly supported. The full email-to-taskdash skill was retained as reference, with this clarified output contract explicitly overriding its five-bullet contract. Task-owner identity was supplied as test context, not added to production settings.

## Refinement

The earlier experiment missed the task owner's own future commitment in both repeats. The refined instruction distinguishes sending an email about work from doing the promised work. It resolves first-person language against each message's From header, treats an owner's future promise as pending, and lets later completion or cancellation supersede that promise. Another person's promise does not assign the task owner an action. A generic proposal-review example explains the distinction without supplying the checklist fixture's answer.

The exact added instruction was:

> Commitment interpretation: first identify who says "I" using that message's From header. A future-tense promise by the task owner is unfinished work, even if nobody asked for it. Sending the email that promises the work does not complete that work. For example, the task owner's "I'll review the proposal" gives the action "Review the proposal", whereas "I have reviewed the proposal" gives no remaining action. Include the promised deliverable and any stated deadline in the action. A promise by somebody else does not assign work to the task owner. A later completion, cancellation or explicit withdrawal supersedes an earlier promise. Apply these rules before choosing whether action is empty.

## Evidence

Gemma4:12b, thinking disabled, context 8192, output allowance 512, temperature 1, top_p 0.95, top_k 64. Ten cases were run with seeds 11 and 29, reversing case order in the second round. These are bounded repeated evaluations, not a statistical reliability estimate.

- The supplied private thread retained a neutral title and recap, with action omitted, in both trials. Its source and identifying model drafts are not copied into this report or repository fixtures.
- Clear incoming requests and the owner's future checklist promise produced explicit actions, preserving the supplied deadline.
- Informational updates, completed/superseded requests, unassigned discussions, fulfilled promises, cancelled promises and other people's promises produced no new action.
- Unknown shipment status stayed unknown, not asserted as non-shipment.
- 19 of 20 initial attempts passed the bounded checks. One shipment-status trial timed out at 120 seconds; the unchanged prompt/case/seed passed an isolated retry in 23.66 seconds. All 20 case/seed combinations therefore have a passing result, but the initial timeout remains a reliability failure and the full round was not uninterrupted/all-green.

Most fictional drafts took roughly 10–18 seconds. The private thread took 38–53 seconds. One other fictional trial took 75 seconds. The larger model still has variable latency on this Mac; no performance guarantee is claimed.

Manual review found a minor unsupported detail: one unassigned-discussion recap called it a meeting although the input did not specify that medium. Its action remained correctly empty. Automated checks covered structure and selected action/uncertainty cases, not all factual claims. Human review remains necessary; neither automatic creation nor general factual accuracy is approved.

The prototype harness remains outside the repository at /tmp/taskdash-task-draft-test.XHRfxC/test.mjs. Global skills and the installed TaskDash configuration were left unchanged. Integration into the plugin remains separate work.
