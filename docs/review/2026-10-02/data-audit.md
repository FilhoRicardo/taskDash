# TaskDash data-handling and test-quality audit

Read-only audit, 2026-10-02. Source: `/tmp/taskdash-source-review.RtoY4j`, HEAD `f8a5074e87ebb1cef6e48216af470546c90baad5`. All source references below are relative to that checkout; line numbers also apply to the restored current source per the main agent's update.

The main agent reports byte-for-byte shipped parity after changing ONLY the two Close handlers to `onClick={()=>closeTask(task.id)}`; CSS and manifest match too. This audit accepts that independently reported parity result. Close is already fixed in the shipped bundle and is NOT an open finding. The original baseline still lacks a Close regression test.

## Verification and scope

- MCP `search_graph`, `get_code_snippet`, and `trace_path` used first for code discovery and caller confirmation, indexed project `tmp-taskdash-source-review.RtoY4j`.
- Read the local diagnosing-bugs and TDD skills and TDD's test/mocking references. Applied synthetic reproduction and literal expected results at public interfaces. No implementation or repository tests added; fix/green phases are outside authorization.
- `npm test` in the original checkout: **11 files, 89 tests passed**, exit 0. Installed runner reports Vitest 4.1.10. Passing tests do not disprove the failures below.
- `node /tmp/taskdash-review-2026-10-02.cjs`: actual shipped bundle, **8 failed checks, 2 passing controls**. Its internal minified function extraction is evidence for shipped behavior, not the proposed regression-test seam.
- `TZ=Europe/Dublin node /tmp/taskdash-data-audit-repro.mjs`: source exports, **20 failed assertions, 7 passing controls**, intentional exit 1.
- `TZ=UTC node /tmp/taskdash-data-audit-repro.mjs`: **18 failed assertions, 9 passing controls**. Both DST assertions become green; other defects remain. Assertions are grouped into ten root-cause findings below, not twenty reports.
- Repro harness imports real `parseTask`, formatter exports, `buildTaskCalendarOccurrences`, and `workStats`. All Markdown exists in memory. Timestamp output in history examples is redacted as `<runtime>` for readability; verdicts do not depend on the current time.
- No real vault writes, no shared source edits. Original checkout `git status --short` remained empty. Only this report and the separate synthetic harness were created under `/tmp`.

## Prior-finding disposition

All four previous groups are independently confirmed through public source interfaces: CRLF metadata, partial recurrence evaluation, false future-overdue flags, and deletion of custom Time Clock content. Monthly completion also reproduces the same evaluator defect. UNTIL/COUNT/YEARLY results are confirmed silent misinterpretations; supporting the entire recurrence standard is a product choice, but silently treating those rules as an unlimited daily/weekly series is observable incorrect behavior. They are grouped with the evaluator finding rather than reported as separate defects.

## Findings

Severity: High/P1 = destructive content/history mutation or materially wrong task schedule/state; Medium/P2 = incorrect displayed data or narrower scheduling/text behavior. Confidence concerns the reproduced behavior; no live Obsidian UI run was performed here.

### 1. High / P1 — LF-only matching hides CRLF metadata and makes date edits silently ineffective

Source: `src/app/utils/parser.js:2`, task mapping `:86–98`; `src/app/utils/formatter.js:628–629,648`. Other frontmatter helpers use the same LF-only delimiter pattern, including completion at `:829–830`.

Literal note, passed to `parseTask('example.md', raw)`:

```js
raw = '---\r\ntitle: Example\r\nstatus: done\r\ndue: 2026-10-02\r\nRecurrent: true\r\n---\r\n# Example'
```

Expected `[status,due,recurrent]`: `['done','2026-10-02',true]`. Actual: `['none',null,false]`. Identical LF input passes. `updateTaskDates(raw,{due:'2026-10-03'})` should change the due value; actual output is the unchanged CRLF note, still containing `due: 2026-10-02`. A completed recurring task can appear open and unscheduled, while attempted edits do nothing.

Missing regression: parameterize `parseTask` and `updateTaskDates` round trips over LF/CRLF; assert metadata and the changed value, and preservation of untouched bytes. Narrow fix: tolerate CRLF at line boundaries in the parser and relevant mutation helpers, preserve original line endings during replacement. Confidence: high; source and shipped parser reproduced.

### 2. High / P1 — Recurrence evaluators silently ignore rule semantics

Source: `src/app/utils/taskCalendar.js:71–93`; `src/app/utils/formatter.js:763–797`, completion caller `:836`. Ordinal weekday tokens are reduced to weekday numbers, but monthly matching checks only the anchor day of month; termination fields are unused and unsupported frequencies fall back to seven days.

Public calendar input:

```js
task = {id:'r.md',status:'none',recurrent:true,due:'2026-09-28',
        recurrence:'DTSTART:20260928;FREQ=MONTHLY;BYDAY=-1MO'}
dates = ['2026-10-26','2026-10-28']
buildTaskCalendarOccurrences([task],dates,'2026-10-02').map(o=>o.date)
```

Expected: `['2026-10-26']`; actual: `['2026-10-28']`. For `finishRecurrentTaskInstance` with literal Markdown `'---\nRecurrent: true\ndue: 2026-09-28\nrecurrence: DTSTART:20260928;FREQ=MONTHLY;BYDAY=-1MO\n---\n# R'` and current due `'2026-09-28'`, expected next due is `2026-10-26`; actual reparsed due is `2026-10-28`.

Additional literal calendar cases use `{id:'r.md',status:'none',recurrent:true,due:'2026-10-01',recurrence:rule}`:

| Rule | Requested dates | Expected dates | Actual dates |
| --- | --- | --- | --- |
| `FREQ=DAILY;UNTIL=20261002` | `['2026-10-03']` | `[]` | `['2026-10-03']` |
| `FREQ=DAILY;COUNT=2` | `['2026-10-03']` | `[]` | `['2026-10-03']` |
| `FREQ=YEARLY` | `['2026-10-08']` | `[]` | `['2026-10-08']` |

Missing regression: calendar AND completion cases for last Monday, second Monday, finite rules, and unsupported frequencies; compare literal dates, not results of the other evaluator. Narrow fix: correctly evaluate supported ordinal/termination rules in both paths; explicitly reject unsupported forms instead of the weekly fallback. Confidence: high for all outputs; the intended supported rule subset needs a product decision. This is one shared evaluator limitation, not separate monthly/calendar/completion reports.

### 3. Medium / P2 — Future recurrence inherits overdue state from the series anchor

Source: `src/app/utils/taskCalendar.js:96–99,135`.

Literal input:

```js
buildTaskCalendarOccurrences([{id:'r.md',status:'none',recurrent:true,
  due:'2026-09-28',recurrence:'FREQ=WEEKLY;BYDAY=MO'}],
  ['2026-10-05'],'2026-10-02')[0].isOverdue
```

Expected `false`; actual `true`. The recurrence exists on October 5, but overdue compares September 28 with today. Missing regression: assert flags for past/today/future occurrences of the same recurring task; retain ordinary-task due semantics. Narrow fix: use occurrence date for recurring overdue evaluation, with the recurrence flag available at the caller. Confidence: high; independently confirmed in shipped bundle and source.

### 4. High / P1 — Saving hours replaces the entire Time Clock section and deletes user prose

Source: `src/app/utils/formatter.js:299–304`; app save path `src/app/App.jsx:3159`. Related same-root branch: `formatter.js:322–323` rebuilds an existing section without the expected table header.

Literal input:

```js
raw = '## Time Clock\n\n| Time | Event |\n| --- | --- |\n| 09:00 | Clock in |\n\n### Explanation\nKeep this paragraph\n\n---\n\n## Notes\nKeep notes'
replaceDailyTimeClockRows(raw,[{time:'09:15',event:'Clock in'}])
```

Expected output retains `### Explanation\nKeep this paragraph`, changes only the table row, and retains Notes. Actual full output:

```js
'## Time Clock\n\n| Time | Event |\n| --- | --- |\n| 09:15 | Clock in |\n\n---\n\n## Notes\nKeep notes'
```

Missing regression: prose before/after the table, H3 content, and section separators survive hours saving. Existing formatter test checks only the following H2, which passes while data is deleted. Narrow fix: bound replacement to the actual table; preserve non-table section content. Confidence: high; shipped and source repro agree.

### 5. High / P1 — Completing recurrence emits duplicate history keys and loses the new completion on reparse

Source: `src/app/utils/formatter.js:810–825,834–838`. Parser supports inline and unindented lists, but writer recognizes only indented history blocks.

Literal input and call:

```js
raw = '---\nRecurrent: true\ndue: 2026-09-28\nrecurrence: FREQ=WEEKLY;BYDAY=MO\ncomplete_instances: [2026-09-21]\n---\n# R'
finishRecurrentTaskInstance(raw,'2026-09-28',null)
```

Expected: one `complete_instances` key representing `['2026-09-21','2026-09-28']`, next due `2026-10-05`. Actual full output, excluding runtime timestamp:

```js
'---\nRecurrent: true\ndue: 2026-10-05\nrecurrence: FREQ=WEEKLY;BYDAY=MO\ncomplete_instances:\n  - 2026-09-28\n\ncomplete_instances: [2026-09-21]\ndateModified: <runtime>\n---\n# R'
```

Actual `parseTask(...).completeInstances`: `['2026-09-21']`; the old later key overwrites the newly inserted completion. Replacing the input history with literal `'complete_instances:\n- 2026-09-21\n'` gives the same duplicate-key/new-completion-loss behavior. The indented `'complete_instances:\n  - 2026-09-21\n'` control passes.

Missing regression: parse → complete → reparse for inline, indented, unindented, and quoted date-list forms; assert preservation and exactly one key. Narrow fix: read every supported list representation and replace the existing key/block rather than insert a second key. Confidence: high; output directly reproduced. Do not describe this as every history item being deleted: the concrete observed loss is the new completion, plus invalid duplicate keys.

### 6. Medium / P2 — Completion parses recurrence differently from the calendar

Source: `src/app/utils/formatter.js:753–758,832`; contrast normalized calendar parser at `src/app/utils/taskCalendar.js:37–43` and YAML quote stripping at `parser.js:15`.

Literal inputs:

```js
raw1 = '---\nRecurrent: true\ndue: 2026-10-01\nrecurrence: RRULE:FREQ=DAILY\n---\n# R'
raw2 = '---\nRecurrent: true\ndue: 2026-10-01\nrecurrence: "FREQ=DAILY"\n---\n# R'
```

For each, `finishRecurrentTaskInstance(raw,'2026-10-01',null)` should produce next due `2026-10-02`; actual reparsed due is `2026-10-08`. Calendar expansion of each `parseTask('r.md',raw)` correctly includes `2026-10-02`. This distinguishes normalization disagreement from the unsupported-rule finding: DAILY itself is supported.

Missing regression: public completion round trip for raw, quoted, and RRULE-prefixed equivalent DAILY rules, with independent literal due dates. Narrow fix: decode the scalar and strip RRULE prefix consistently before completion rule parsing. Confidence: high.

### 7. Medium / P2 — Completion advances onto an already skipped occurrence

Source: `src/app/utils/formatter.js:834–836,779`; calendar exclusion at `src/app/utils/taskCalendar.js:141,145`.

Literal input:

```js
raw = '---\nRecurrent: true\ndue: 2026-09-28\nrecurrence: FREQ=WEEKLY;BYDAY=MO\nskipped_instances:\n  - 2026-10-05\n---\n# R'
finishRecurrentTaskInstance(raw,'2026-09-28',null)
```

Expected next actionable due `2026-10-12`; actual reparsed due `2026-10-05`, with skipped history retained. Calendar excludes that date, so the newly due instance is absent from the calendar. Only completed history is passed to next-date selection.

Missing regression: complete a series whose immediate successor is skipped, assert next non-skipped due and calendar agreement. Narrow fix: include skipped dates in the exclusion set used for advancing, while recording completion only in completion history. Confidence: high for the inconsistency; recommendation assumes skip means do not schedule that instance, matching existing calendar behavior.

### 8. High / P1 — Recurrence day arithmetic changes interval phase across DST

Source: `src/app/utils/taskCalendar.js:12–23,68,81`; `src/app/utils/formatter.js:740–745,781–783`. Both compute day count by flooring elapsed local-noon milliseconds divided by 24 hours.

Under `TZ=Europe/Dublin`, literal calendar input:

```js
task = {id:'r.md',status:'none',recurrent:true,due:'2026-03-28',
        recurrence:'DTSTART:20260328;FREQ=DAILY;INTERVAL=2'}
buildTaskCalendarOccurrences([task],['2026-03-30','2026-03-31'],'2026-03-28').map(o=>o.date)
```

Expected `['2026-03-30']`; actual `['2026-03-31']`. Completion input `'---\nRecurrent: true\ndue: 2026-03-28\nrecurrence: DTSTART:20260328;FREQ=DAILY;INTERVAL=2\n---\n# R'`, completed at `'2026-03-28'`, should produce due `2026-03-30`; actual due `2026-03-29`. The one-day local-noon interval over the spring clock change is 23 hours, floored to zero and accepted as an even interval. Both exact cases pass under UTC, isolating the cause.

Missing regression: run interval calendar and completion cases in Europe/Dublin across both spring/fall boundaries, plus UTC controls. Narrow fix: calculate calendar-day difference from UTC representations of year/month/day components, not local elapsed time. Confidence: high; controlled timezone differential.

### 9. Medium / P2 — Formatter/parser round trips retain YAML escape characters in user text

Source: `src/app/utils/parser.js:7,14–15`; valid writer escaping `src/app/utils/formatter.js:479–480`, thread subject writer `:708–727`.

Literal input:

```js
subject = 'Say "hello" at C:\\temp'
out = updateTaskThreadSubject('---\ntitle: R\n---\n',subject)
parseTask('r.md',out).threadSubject
```

Expected decoded text, JSON-serialized: `"Say \"hello\" at C:\\temp"`. Actual decoded text, JSON-serialized: `"Say \\\"hello\\\" at C:\\\\temp"`. Actual contains extra backslashes before both quotes and a doubled path backslash. Writer correctly emits escaped YAML, but parser removes only outer quotes and never decodes escapes. Plain `'hello'` round trip passes. The same parser is used for quoted contexts/link metadata, so correction belongs in scalar decoding, not disabling valid writer escaping.

Missing regression: write → parse → write text containing quotes and backslashes; assert literal equality and no growth of escapes. Narrow fix: decode YAML quoted scalars consistently, including list entries; preserve untouched document content during writes. Confidence: high.

### 10. Medium / P2 — Multiple work sessions count the clocked-out gap as work

Source: `src/app/utils/timeClock.js:42–43,56–57`. Repeated punch buttons are available at `src/app/App.jsx:4930–4937`; event appending is a public formatter path, not an unreachable synthetic state.

Literal public input:

```js
workStats({timeClock:[
  {time:'09:00',event:'Clock in'}, {time:'12:00',event:'Clock out'},
  {time:'13:00',event:'Clock in'}, {time:'17:00',event:'Clock out'}
]}).totalMinutes
```

Expected `420` (180 + 240); actual `480` (first in → last out). The noon-to-13:00 gap is credited although explicitly clocked out. Single 09:00–12:00 session returns `180`, a passing control.

Missing regression: two paired sessions, breaks within a session, and incomplete trailing session through `workStats`; include a synthetic daily-note parse → stats check. Narrow fix: sum paired work intervals and subtract breaks within active sessions. Confidence: high for current behavior; if product policy intends exactly one session, enforce that policy at punch entry instead of accepting and miscounting repeated sessions.

## Existing test quality

All eleven test files were inspected. The suite has useful seams: parser/formatter exports, calendar occurrences, workStats/dashboardStats, workflow and mention helpers, adapter handles, and real plugin/view/app wiring against a fake Obsidian vault. Filesystem/Obsidian and clock fakes are system-boundary mocks; most utility expectations are independent literal values. The stale-write adapter test checks both rejection and preservation of external content, a meaningful safety regression. The plugin integration test exercises real React state and persistence rather than mocking internal formatter calls.

Specific gaps and assertion weaknesses:

- `src/app/utils/__tests__/parser.test.js` tests LF fixtures only. It covers unindented lists, making the completion writer's narrower list support particularly significant.
- `src/app/utils/__tests__/formatter.test.js` has no recurring-completion test. Its Time Clock preservation case checks only the next H2; it cannot catch finding 4. Thread-subject tests check simple serialization/clearing, not reparsed equality.
- `src/app/utils/__tests__/taskCalendar.test.js:42–58` checks dates/recurrent flags for a weekly recurrence but not each overdue flag. There are no monthly, termination, yearly, completion-consistency, or DST cases. Literal dates should be checked independently in both read and write paths.
- `src/app/utils/__tests__/timeClock.test.js:5–21` has one work interval and one leave status. The leave expectation equals the imported implementation constant; this checks use of the constant, but does not independently lock down the promised 435-minute credit. Add literal expectations where the product value is the contract. No paired-session or interval-validation behavior is locked down.
- `src/app/utils/__tests__/roundtrip.test.js:41–44,52–55` examines only output lines not found as substrings anywhere in the input. Removed lines are invisible to this check. It could pass after deleting an unchecked body line. Test exact untouched body equality and exact preserved unknown fields, with only allowed mutable fields/timestamp differences excluded.
- `roundtrip.test.js:59` passes `'2026-07-06'` as a third argument to `appendNoteToMd`; the export at `formatter.js:73–74` ignores it and uses today. The assertions do not check the insertion date. Pin the clock and assert date placement, including existing/future date sections.
- Plugin integration fakes exercise real app code and are valuable, but none cover recurring completion or saving hours with custom section content. Persistence assertions inspect fake-vault backing storage, so pair them with reloaded/rendered behavior for fields exposed to the user. Current log-save test already checks updated DOM text as well as saved Markdown.
- Adapter cache tests assert call counts/identity, appropriate when caching itself is the explicit contract, but do not prove document semantic preservation. Keep those distinct from formatter safety claims.
- The baseline has no Close-action regression. Given the main agent's proven shipped handler fix, add a public UI test for clicking Close and observing the intended task's archive/completion. Do not reopen the fixed event-handler defect based on the untouched baseline.

No coverage percentage or mutation-testing claim is made: neither was measured. No broad refactor or new abstraction is recommended. The exported interfaces already provide suitable seams for the concrete regressions in this report.

## Limits and exclusions

Source interface behavior is verified; shipped behavior for the original findings is also directly reproduced. Applicability of additional source findings to shipped code relies on the main agent's parity result, not a fresh build by this auditor. No real vault/UI checks were performed.

An exploratory unknown-status input (`workStatus:'Workday'`) receives 435 minutes, but the current UI offers lowercase enumerated statuses. It is excluded from the findings because the invalid-status product contract is not established. Likewise, unsupported overnight shifts, malformed date handling, and speculative parser complexity are not reported as defects without established expected behavior.

Report and harness are audit artifacts only. No fixes were implemented.
