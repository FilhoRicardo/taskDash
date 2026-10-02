# TaskDash review and fix dispatch — 2026-10-02

## Verified baseline

Source restored in commit `4420d20322fd049948fd180e861bbfd214d42957`. Production build equals the originally shipped `main.js`, manifest and CSS byte-for-byte. Existing suite: 11 files, 89 tests passing. Five independent review subagents evaluated the complete 37-skill inventory, data/test quality, IO/timers, rendered UI, and tooling.

The skills contain workflow instructions, not 37 executable plugin tests. See [skill coverage](skills-coverage.md) for the disposition of every skill. Reviews used synthetic data and mounted DOM observations; actual Obsidian host and real-browser visual/accessibility validation remain explicitly limited.

## Evidence

- [Data audit](data-audit.md): 10 issue groups. Public-interface repro: 20 failed assertions/7 controls passed in Europe/Dublin; 18 failed/9 controls passed in UTC. Differences isolate DST defects.
- [IO audit](io-audit.md): 5 issue groups. Nine characterization checks reproduced faulty states and passing safety controls.
- [UI audit](ui-audit.md): 7 issue groups. Eight rendered-DOM characterization observations pass by proving the current defects, not expected corrected behaviour.
- [Tooling audit](tooling-audit.md): 5 issue groups. Full test/build/typecheck pass; eight development-only affected packages; production audit zero. Includes missing CI, Close regression coverage, absent JSX correctness checks and ignored transform config.

Reports separate confirmed issues from unverified concerns and architecture/performance recommendations. Close event-handler implementation is already corrected; its new chat adds regression coverage only.

## Fix chats

All 27 chats were created in project `5848ceb4-233b-4842-b8d1-1e14a2ae76a2` (TaskDash - obisidanPlugin), using `gpt-6-luna`, reasoning `medium`. Each prompt includes exact baseline, findings/report, narrow file scope, literal acceptance examples, failing-before/passing-after tests, full-suite/build checks, isolated worktree instructions and required final commit evidence. Source/tests/config commits exclude regenerated bundles; rebuild after integration. No live vault installation or release is requested.

| Issue | Chat | Thread ID |
| --- | --- | --- |
| 1 | Fix TaskDash CRLF metadata and date edits | 01a0fd6a-3dde-7e02-861e-8dfde0e15b25 |
| 2 | Fix TaskDash recurrence rule semantics | 01a0fd6a-4544-7b70-869a-fde200b5c0f2 |
| 3 | Fix future recurring tasks marked overdue | 01a0fd6a-4afb-71a1-ab79-ff53b8c81393 |
| 4 | Preserve Time Clock prose when editing hours | 01a0fd6a-5121-7310-b6f0-9f5be03d03bf |
| 5 | Preserve recurring task completion history | 01a0fd6a-5a05-7b62-9dbf-bbbd4cc1d550 |
| 6 | Normalize recurrence rules during completion | 01a0fd6a-6065-7b13-b3e0-7610511efd00 |
| 7 | Skip excluded dates when advancing recurrence | 01a0fd6a-66ec-7861-b475-1e0ec50e3a1a |
| 8 | Fix recurrence intervals across daylight saving | 01a0fd6a-6dbe-7f51-84aa-d576065252d6 |
| 9 | Decode quoted YAML task text correctly | 01a0fd6a-74a2-7a73-bac3-3a2d707d1fd2 |
| 10 | Count separate work sessions accurately | 01a0fd6a-7b58-7951-b527-f3a4bd625c20 |
| 11 | Prevent task creation overwriting existing notes | 01a0fd6c-c84e-7cf0-ba87-c46010373baa |
| 12 | Protect timer logs from concurrent edits | 01a0fd6c-ce4b-7642-8d20-82b1a7074c3d |
| 13 | Retain timer sessions when logging fails | 01a0fd6c-d5b3-7840-aef7-d30a0e842b85 |
| 14 | Refresh dashboard with current folder settings | 01a0fd6c-dd2b-7463-ac33-b4bcd19bd7c9 |
| 15 | Recover cleanly from failed task archive | 01a0fd6c-e5b7-7c62-91c2-264f36c2c34f |
| 16 | Preserve task drafts when starting Quick Track | 01a0fd6c-f0e1-7db3-861f-78d320645fcb |
| 17 | Make Escape dismiss the innermost picker | 01a0fd6c-f79a-7a10-abae-a2e7c53ea239 |
| 18 | Manage modal focus and keyboard containment | 01a0fd6c-ff7b-7f73-9473-3a0153982a64 |
| 19 | Keep Review checkbox keyboard events local | 01a0fd6d-076b-7ab1-879f-dfe2863fbfaf |
| 20 | Open narrow task list on the first click | 01a0fd6d-0fd1-7e23-b010-52b1554e4fa7 |
| 21 | Enable keyboard activation of picker options | 01a0fd6d-179a-75d3-a2b3-1559dec0b7c9 |
| 22 | Associate metadata labels with their controls | 01a0fd6d-22fb-7440-ba7f-7f71d4b2baf4 |
| 23 | Update vulnerable development dependencies | 01a0fd6d-2a39-73e2-8a7e-adab88b1e4bb |
| 24 | Restore CI and gate TaskDash releases | 01a0fd6d-3662-76e0-8e2a-454077e4e3b4 |
| 25 | Add regression tests for TaskDash Close actions | 01a0fd6d-3f06-7d32-994f-f62ab054597f |
| 26 | Add a minimal JSX correctness check | 01a0fd6d-4c34-7f63-86a6-2c3593fe4f02 |
| 27 | Remove ignored Vitest transform configuration | 01a0fd6d-59db-72d1-9b63-5f321b3c225a |

## Status

Review and dispatch complete. Fix chats have been launched; their implementation results and final integration have not yet been verified. Do not equate successful dispatch or passing baseline tests with fixed issues.
## Dispatch verification

All 27 chat IDs were polled individually after creation: each returned a live or completed turn, with no missing-thread errors. At this snapshot, 6 fix chats had reported completed commits; the remaining 21 were working. Their reports are not yet an independent verification of the fixes, and no fix commits have been merged into main. All 27 isolated worktrees are registered in this repository.
