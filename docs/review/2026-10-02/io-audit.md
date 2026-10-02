# TaskDash IO audit — initial bounded findings

## Scope and applicability

Audited `/tmp/taskdash-source-review.RtoY4j`, verified HEAD `f8a5074e87ebb1cef6e48216af470546c90baad5`. Source line references below refer to that checkout. Its tracked files remained clean after the audit. No real vault modifications, shared-checkout edits, or chats were created. Audit artifacts are confined to `/tmp`.

Shipped artifact: `/Users/ricardofilho/Documents/Projects/active/taskdash-2-2/main.js`. The parent supplied a byte-for-byte parity result: building f8a5074 with only the two `onClick={closeTask}` handlers replaced by `onClick={()=>closeTask(task.id)}` matches shipped main.js; CSS and manifest match too. Accordingly, the five other-path findings below apply to the shipped implementation, conditional on that supplied parity evidence. This auditor did not independently rebuild or execute the shipped bundle. **The Close click-event defect is already fixed in the shipped bundle and is excluded from open findings.** The parent restored matching source in the shared project; this audit continued against the original temporary checkout.

Used the requested Matt `diagnosing-bugs` and `codebase-design` skills. Graph discovery used project `tmp-taskdash-source-review.RtoY4j` (`search_graph`, `get_code_snippet`, inbound `trace_path` for `writeFile`). No GLOSSARY or ADR files were found in the inspected source/docs inventory. The skills informed use of the actual write interface and adapter seam for synthetic checks, and narrow fix scopes rather than a proposed architecture rewrite.

## Verification and evidence limits

- `npm test`, in the temporary source checkout: **11 files, 89 tests passed**, exit 0, 1.36 seconds.
- `node /tmp/taskdash-io-repro.cjs`, from `/tmp`: **9 deterministic characterization checks passed**, exit 0. These assert reproduced faulty states or verified controls, rather than asserting all production behavior is correct.
- Harness: [taskdash-io-repro.cjs](/tmp/taskdash-io-repro.cjs). It bundles the real exported `writeFile`, formatter/parser functions, and `ObsidianVaultAdapter` in memory. App callbacks are extracted unchanged from source and executed with supplied state/setters and an in-memory fake Obsidian vault. No plugin source is patched and no on-disk fake vault is required.
- Synthetic checks do not mount React or exercise native Obsidian. Controlled interleavings and failure injection demonstrate the implementation's behavior; they do not establish live frequency, operating-system failure behavior, or sync-client timing.
- IndexedDB is intentionally unavailable in the harness; backup capture logs `backup capture failed` and proceeds, as the real helper permits. Thus automatic backup persistence/recovery was not tested. Do not interpret that warning as an additional finding. Creation with `backup:false` bypasses backup capture regardless.
- A further meeting/ad-hoc extension encountered a callback-extraction error before yielding usable evidence and was removed from the final harness. Those cases are not findings. The final bounded harness was rerun successfully.

## Findings

Each ID represents one independent fix scope. Variants under an ID should not become duplicate tickets.

### IO-1 — P1: task creation can overwrite an existing note or the time log

**Code:** [App.jsx:2456](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2456), lines 2456–2465; [parser.js:246](/tmp/taskdash-source-review.RtoY4j/src/app/utils/parser.js:246), especially line 251; [obsidian.ts:161](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:161), lines 161–169; [obsidian.ts:247](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:247), lines 253–259.

**Steps:** Load the task list with an existing `Tasks/timetracker.md`, then create a task titled `timetracker`. Alternatively, create `Tasks/New.md` externally after the last task load and create a task titled `New` before refresh.

**Expected:** Preserve the existing file; allocate a distinct task filename or reject the reserved name. **Actual:** Filename collision detection checks only `taskHandles`. The parser always excludes `timetracker.md`, so the reserved log is never represented there. `getFileHandle({create:true})` returns an existing file, and `writeFile(...,{backup:false})` supplies no expected-content guard. The existing log/note is replaced with the new task Markdown. Both variants were reproduced with the actual creation callback and adapter.

**Impact:** Loss of task content or accumulated tracking history. The reserved-log variant requires no concurrency and loses the app's normal pre-write backup too.

**Fix scope:** `createTask` plus the adapter's creation seam. Reserve `timetracker.md`; use live collision detection and a create-only/atomic claim so a file appearing between allocation and commit is never overwritten. Do not alter general `getFileHandle({create:true})` semantics silently: other callers rely on opening existing files.

**Acceptance:** Through the real create callback/adapter, seed a time log and create `timetracker`; assert the log is byte-for-byte unchanged and the result is rejected or separately named. Repeat with an externally added same-title task and a controlled creation race; assert both pre-existing content and the newly created task are retained. One issue covers both variants.

### IO-2 — P1: timer Stop can lose a concurrent tracker edit

**Code:** [App.jsx:2304](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2304), lines 2304–2317; [App.jsx:90](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:90), lines 90–102; [obsidian.ts:256](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:256), lines 256–259.

**Steps:** Stop a running timer. Between `stop` reading the tracker and `writeFile` reading it again for backup, append a row from another writer. The harness inserts `EXTERNAL-CONCURRENT-ROW` exactly at the second read.

**Expected:** Retain the external row and append the timer row, or reject the stale update without discarding the timer. **Actual:** `stop` computes the full replacement from its first read but does not pass that content as `expectedContent`. `writeFile` treats the second, newer read as the expected content. The adapter therefore accepts the stale replacement and removes the external row. The harness asserts two reads and absence of the inserted row afterward.

**Cause discrimination:** This is missing original-content propagation, not a broken `vault.process` guard: a control with explicit original `expectedContent` rejects the changed note with `StaleWriteError` and preserves it. The injected second read returned the newer data, so cached-read staleness is not necessary for this reproduction.

**Impact:** Lost tracking rows under overlapping TaskDash/editor/sync writes.

**Fix scope:** Carry the first read into `writeFile` as `expectedContent`, or append inside the adapter's atomic transform. Combine with IO-3's failure behavior so a conflict is retryable. Inspect similar call sites before broadening a fix; only the timer path is independently reproduced here.

**Acceptance:** Gate two writers between read and commit, assert both rows survive or the losing operation returns a conflict while retaining its pending session. Include the explicit-original-content rejection control. A test of the adapter alone is insufficient: exercise the `stop` → `writeFile` chain.

### IO-3 — P1: a failed tracker operation discards the running session

**Code:** [App.jsx:2304](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2304), lines 2304–2321, especially catch at 2318 and unconditional clearing at 2320.

**Steps:** Run a timer, make its tracker unavailable, then Stop. The deterministic test injects a tracker `getFile` failure and records calls to `setTimer`/`lsDel`.

**Expected:** Preserve an unsaved session for retry and show the user that logging failed. **Actual:** The error is only logged to the console; `stop` resolves normally, sets the timer to null, and deletes `activeTimer`. No session row was saved. The same unconditional clearing follows the entire tracker-operation catch and also occurs when no tracker handle exists.

**Impact:** Loss of elapsed time and restart recovery after tracker IO failure. Completion/start flows awaiting `stop` receive no failure signal.

**Fix scope:** Timer stop/session persistence only. Retain a pending session and surface failure; clear it only after successful logging. Freeze the intended end time for retries and prevent duplicate logging. Avoid changing duration calculation or unrelated timer UI.

**Acceptance:** Inject tracker read failure, process failure and stale-write rejection; assert no deletion of the pending session and a visible failure state. Retry successfully, assert exactly one row with the original end time, then clear persisted state. The current reproduction independently demonstrates read failure; process-failure/retry/reload acceptance tests remain to be implemented.

### IO-4 — P2: folder settings changes do not update an already-open dashboard

**Code:** [settings.ts:78](/tmp/taskdash-source-review.RtoY4j/src/settings.ts:78), lines 78–85; [main.ts:155](/tmp/taskdash-source-review.RtoY4j/src/main.ts:155), lines 155–157; [view.tsx:55](/tmp/taskdash-source-review.RtoY4j/src/view.tsx:55), lines 55–58; [App.jsx:1624](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:1624), boot effect through 1651; [App.jsx:2136](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2136), Refresh through 2160.

**Steps:** Open the dashboard with tasks folder `Tasks`; change the native setting to existing folder `Other`; return and press Refresh. The harness captures directories, updates the adapter config, and executes the real Refresh callback.

**Expected:** Refresh adopts current folder settings and subsequent creates use `Other`. **Actual:** Refresh passes its captured `dirs` to `loadAll`; it never fetches current directories. The harness observes `Tasks` there even though a fresh adapter `getDirectories()` returns `Other`. Settings save only persists plugin data, with no change notification to replace React directory handles. Creation uses those same captured handles.

**Impact:** Reads remain in the old folder; newly created notes can go to a destination different from the saved setting. Reopening the view performs a fresh lookup. Initial setup from an already-open unconfigured dashboard has the same missing propagation seam, but was not separately reproduced.

**Fix scope:** Propagate folder configuration changes to the mounted app, or make Refresh reacquire directories and update dependent state/handles. Ensure clearing a configured folder clears its loaded data. Avoid remounting on every settings keystroke.

**Acceptance:** Mount the real view, change settings through the native setting callback, Refresh, and assert only new-folder task data appears and a new task is written there. Repeat clearing a folder. The synthetic check establishes captured-handle behavior; native UI propagation remains to be tested.

### IO-5 — P2: archive rename failure leaves a task completed despite failure reporting

**Code:** [App.jsx:2493](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2493), lines 2493–2519; [obsidian.ts:114](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:114), lines 114–127.

**Steps:** Complete a task with a configured Done folder; inject a failure in `moveFile`/rename after the source write. The harness executes `closeTask('a.md')` and its confirmation callback, supplying the explicit ID used by the shipped fixed handler.

**Expected:** Failure leaves an actionable consistent state, or explicitly reports and exposes the partial result for archive retry. **Actual:** Completion/Archived metadata is committed before rename. Rename fails, the catch reports `Failed to close task`, but `Tasks/a.md` already contains `status: done` and no `Done/a.md` exists. No refresh/reconciliation runs in this catch; the in-memory task remains old until a later load.

**Impact:** Disk/UI disagreement after a failed combined action; after refresh the task is completed in its old folder. No note deletion or collision overwrite was demonstrated here. This is a confirmed partial-operation/recovery defect, not a claim that rename itself is faulty.

**Fix scope:** Completion/archive orchestration. Reconcile committed state and expose an explicit retry of the move, or implement a carefully guarded compensating action. Do not blindly restore old content over edits made after completion.

**Acceptance:** Inject rename failure after successful completion write; assert truthful partial-result UI, current task state, and an available move retry. Retry and assert one note in Done, none in Tasks, with unrelated edits preserved. Preserve existing archive-collision behavior.

## Existing tests and assessed controls

- [appWriteFile.test.jsx:5](/tmp/taskdash-source-review.RtoY4j/src/app/__tests__/appWriteFile.test.jsx:5) verifies new-file `backup:false` avoids a preliminary read. It does not prove the file is actually new or protect an existing filename.
- [obsidianAdapter.test.js:137](/tmp/taskdash-source-review.RtoY4j/src/vault/__tests__/obsidianAdapter.test.js:137) tests stale text writes **with explicit expectedContent**. The final synthetic harness repeats this control; it does not cover callers that reconstruct the expectation from a later read.
- [obsidianAdapter.test.js:150](/tmp/taskdash-source-review.RtoY4j/src/vault/__tests__/obsidianAdapter.test.js:150) covers missing-file creation; it does not test create-only collision semantics.
- [obsidianAdapter.test.js:159](/tmp/taskdash-source-review.RtoY4j/src/vault/__tests__/obsidianAdapter.test.js:159) covers cache invalidation when mtime changes; equal-size/equal-mtime external changes were not investigated to a finding.
- [obsidianAdapter.test.js:177](/tmp/taskdash-source-review.RtoY4j/src/vault/__tests__/obsidianAdapter.test.js:177) covers debounced notifications and configured-folder filtering. [obsidian.ts:293](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:293) invalidates the old rename path and notifies both old/new locations; no rename-notification defect was established.
- [obsidianAdapter.test.js:195](/tmp/taskdash-source-review.RtoY4j/src/vault/__tests__/obsidianAdapter.test.js:195) covers link-preserving move dispatch. The synthetic harness independently preserves `Done/a.md`, writes completed content to `Done/a-2.md`, and removes `Tasks/a.md`: ordinary archive collision handling passes. A collision arriving after filename selection was not independently reproduced and is not an issue here.
- [pluginIntegration.test.jsx:260](/tmp/taskdash-source-review.RtoY4j/src/__tests__/pluginIntegration.test.jsx:260), [:332](/tmp/taskdash-source-review.RtoY4j/src/__tests__/pluginIntegration.test.jsx:332), [:376](/tmp/taskdash-source-review.RtoY4j/src/__tests__/pluginIntegration.test.jsx:376), and [:408](/tmp/taskdash-source-review.RtoY4j/src/__tests__/pluginIntegration.test.jsx:408) cover task-log editing, metadata editing, responsive properties and unsaved navigation. The 89-test baseline lacks the later Close click/confirmation regression despite shipped behavior being fixed.
- Task comments, metadata, dates and recurring completion carry original content to guarded writes: [App.jsx:2380](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2380), [:2524](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2524), [:2549](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2549), [:2652](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:2652). No independently reproduced stale-write defect is asserted for these paths.
- [view.tsx:80](/tmp/taskdash-source-review.RtoY4j/src/view.tsx:80) unmounts React and disposes the adapter; [obsidian.ts:136](/tmp/taskdash-source-review.RtoY4j/src/vault/obsidian.ts:136) removes vault refs, clears listeners/debounce/cache. Synthetic disposal removes all four registered vault handlers. [main.ts:89](/tmp/taskdash-source-review.RtoY4j/src/main.ts:89) registers bridge listener cleanup; `onunload` clears its interval. A native lifecycle/unload test was not performed; no listener-leak finding is claimed.

## Explicit limits and handoff

Five independently bounded findings above; IO-1's two scenarios are one issue. IO-2 and IO-3 are distinct: successful stale replacement vs failed-operation session disposal. Exclude the shipped-fixed Close bug from new work. No other cases should be converted into issue chats from this report.

Timer restoration was inspected at [App.jsx:1626](/tmp/taskdash-source-review.RtoY4j/src/app/App.jsx:1626)–1630 (restore younger-than-24-hour active timer; discard older state), alongside persistence at 2342–2345. No full reload/resume, cross-midnight, long-session, meeting-draft or multi-vault recovery reproduction completed. These are coverage limits, not confirmed defects.

Daily/property/reference-note save paths were inspected, but their suspected stale-write or draft-refresh cases were not independently reproduced; do not extend IO-2 automatically to them. Root/backslash/path-normalization behavior, overlapping configured folders, archive races, simultaneous refresh ordering and native event timing remain unverified. No speculative tickets or broad redesign is recommended from this initial audit.
