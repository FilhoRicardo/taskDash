# TaskDash initial UI/accessibility/layout audit

Date: 2026-10-02. Read-only review of `/tmp/taskdash-source-review.RtoY4j`, baseline `f8a5074`. All source references below are relative to that checkout; line numbers also apply to the restored project source except for the explicitly corrected Close handlers.

## Scope and evidence

- Parent verified byte-for-byte shipped `main.js` parity after replacing only the two `onClick={closeTask}` handlers with explicit task-ID callbacks. CSS and manifest also match. The Close event bug is **fixed in shipped code, not an open finding**.
- Parent reports the existing suite passes **89/89**. This audit did not rerun that suite.
- Used indexed graph `tmp-taskdash-source-review.RtoY4j` for discovery, then read source and existing tests. Read the requested `.agents/skills/codebase-design/SKILL.md`, `.agents/skills/tdd/SKILL.md`, and TDD test/mocking references. No glossary was found in the bounded file inventory.
- Temporary public-interface checks mount the real `App` with the existing `MemoryVaultAdapter`, real React, existing happy-dom/Vitest, and the existing Obsidian runtime stub. User authorization explicitly covers this rendered-DOM seam. No private exports or shared tests were modified.
- Harness: `/tmp/taskdash-ui-audit.test.jsx`; config: `/tmp/taskdash-ui-audit.config.mjs`.
- Reproduce from the source checkout: `node_modules/.bin/vitest run --config /tmp/taskdash-ui-audit.config.mjs`. Final result: **1 file, 8/8 observations passed**, 1.26 s. These assertions verify defective current behavior; they are not green acceptance tests for the desired fixes.
- Widths are synthetic ResizeObserver values: 500, 1200 and 1800 px. Only in-memory files and synthetic localStorage were touched; mounting App creates its tracker in that in-memory adapter. No browser, actual vault, implementation, or chat changes were made. Temporary config permits Vite reads under `/tmp` and `/private/tmp` to handle macOS path resolution.

## Confirmed actionable findings

Seven issue groups below are independent. Keep each as one work item; do not split a shared cause into duplicate keyboard/accessibility tickets. P1 means unsaved user input can be lost; P2 means a reproducible interaction/accessibility failure. Proposed acceptance tests should assert expected behavior, reversing the relevant observation assertions.

### UI-01 — P1: Quick Track start silently drops an unsaved task-metadata draft

**Locations:** `src/app/App.jsx:2342-2346` (`start`), `3182-3183` (dirty predicate), `3212-3215` (guarded navigation), `3245-3247` (draft reset), `3536` (Email Quick Track). Proof: `/tmp/taskdash-ui-audit.test.jsx:58-67`.

**Reproduce:** Mount at 1800 px, edit the selected task's Contexts field to `unsaved audit`, expand Quick Track and start Email, then reselect Alpha task.

**Expected:** Starting an unrelated timer retains the selected task/draft, or invokes the same Stay/Discard/Save protection used by task navigation before changing selection.

**Actual:** `start('__email__')` calls `setSel('__email__')` directly. The inspector disappears without an unsaved-changes dialog; reselecting the task shows its original Contexts. The draft is lost. The proof starts a timer only; it does not stop/save it or write a real tracker.

**Recommendation:** Do not assign non-task timer IDs to task selection. If task timer starts need to change selection, route that selection through the existing navigation guard. Preserve the current behavior for same-task timer starts.

**Acceptance coverage:** Through App, edit metadata, start Email, verify the original task and draft remain (or test the chosen guard behavior). Add Meeting/ad-hoc variants where they share this selection path. Existing metadata/navigation integration tests at `src/__tests__/pluginIntegration.test.jsx:332` and `408` do not exercise Quick Track.

### UI-02 — P1: Escape closes both an open metadata picker and its dialog, discarding edits

**Locations:** `src/app/App.jsx:181-185` (unconditional window Escape), `1385-1391` (ComboInput Escape), `3189-3193` (dialog cancel resets draft). Proof: `/tmp/taskdash-ui-audit.test.jsx:40-49`.

**Reproduce:** At 1200 px, open Properties, change Contexts, focus Waiting for with Jane Doe available, then press Escape while its listbox is open. Reopen Properties.

**Expected:** First Escape dismisses the inner picker and leaves the metadata dialog and draft intact. A subsequent Escape with no inner popup open can invoke dialog cancel.

**Actual:** ComboInput prevents default but does not stop propagation. The window listener also cancels the dialog, and reopening shows the draft was discarded.

**Recommendation:** Have the dialog respect already-consumed Escape events, and have open inner popups consume Escape consistently. Do not consume Escape when there is no popup to close. Apply the policy to SelectInput, ChipMulti and mentions rather than adding separate ad-hoc listeners. Mention propagation is source-supported but was not separately reproduced in a metadata dialog.

**Acceptance coverage:** Properties → edit draft → open Waiting for → Escape → assert picker closed, dialog open and field unchanged; second Escape → assert cancel. Existing 1200 px dialog test at `src/__tests__/pluginIntegration.test.jsx:376-406` only checks opening.

### UI-03 — P2: Metadata modal does not acquire, contain or restore focus

**Locations:** `src/app/App.jsx:179-215` (MetadataDialog). ConfirmDialog at `130-151` has the same missing focus lifecycle; UnsavedChangesDialog at `153-177` focuses Stay but has no containment/restoration. Runtime confirmation is limited to MetadataDialog. Proof: `/tmp/taskdash-ui-audit.test.jsx:31-39`.

**Reproduce:** Focus Properties and open it. Focus a modal input, then focus the background Properties trigger. Focus the modal input again and click Cancel.

**Expected:** Opening moves focus into the dialog; background controls cannot receive focus while modal; closing returns focus to the invoking trigger.

**Actual:** Opening leaves `document.activeElement` on Properties outside the dialog. Background focus succeeds. Cancelling after focusing an input does not restore the trigger. `aria-modal="true"` supplies none of these behaviors.

**Recommendation:** Put the focus lifecycle at the existing dialog interface: capture opener, focus a safe control on open, contain keyboard focus and make background inert while active, restore opener on dismissal. A single local dialog implementation can serve the three existing callers; do not duplicate focus logic per editor.

**Acceptance coverage:** App integration checks for initial and restored activeElement, then real-browser Tab/Shift+Tab containment and background inertness. The synthetic programmatic-focus proof is **not** a browser Tab-traversal proof. Extend `src/__tests__/pluginIntegration.test.jsx:376` and `408`.

### UI-04 — P2: Space on a Review batch checkbox triggers task navigation

**Locations:** `src/app/App.jsx:3636` (row key handler), `3638-3640` (nested checkbox only stops click propagation). Proof: `/tmp/taskdash-ui-audit.test.jsx:50-57`.

**Reproduce:** Open Review with two tasks. Focus the batch checkbox in the unselected row and dispatch Space.

**Expected:** Toggle that batch checkbox without selecting/navigating the row or dismissing a narrow list.

**Actual:** The event bubbles to the row's key handler, is default-prevented, and selects the other task. The synthetic checkbox stays unchecked. Native checkbox default behavior is suppressed by this prevention; happy-dom itself does not emulate the browser's Space default toggle.

**Recommendation:** Activate row keyboard navigation only when `event.target === event.currentTarget`, or make row navigation and checkbox sibling controls. Preserve Enter/Space navigation when focus is on the row itself. Do not rely solely on checkbox click propagation suppression.

**Acceptance coverage:** Review integration check for checkbox Space without row navigation plus separate Enter/Space on row navigation; browser assertion for actual checkbox checked state. Existing queue test at `src/__tests__/pluginIntegration.test.jsx:222-258` does not test batch keyboard activation.

### UI-05 — P2: Narrow Tasks navigation immediately closes the list it requests

**Locations:** `src/app/IconRail.jsx:100` (set view and open list), `src/app/App.jsx:3241-3243` (view-change effect closes list), `3496` (open-list callback). Proof: `/tmp/taskdash-ui-audit.test.jsx:73-79`.

**Reproduce:** At 500 px go to Today, then click the mobile Tasks button once. Click it a second time.

**Expected:** The first Tasks click changes view and opens the task list.

**Actual:** First click changes view but `.td-pane-list` lacks `mobile-list-open`; second click opens it because the view no longer changes. CSS at `src/plugin.css:70-84` hides the list without that class.

**Recommendation:** Make Tasks-and-open-list one navigation intent, applying list state with the view transition. Remove or refine the blanket post-navigation effect that overwrites the requested state. Keep normal task selection's explicit `closeList` behavior.

**Acceptance coverage:** App at width 500: Today → Tasks once → open class present; row selection → list closes. Include dirty-draft navigation so cancelling a transition does not open the list for a view that never activated. Existing integration width coverage is 1200 and 1800, not below 768.

### UI-06 — P2: Focused picker options ignore click activation from keyboard/assistive technology

**Locations:** `src/app/App.jsx:1396` (ComboInput), `1435` (SelectInput), `1490` (ChipMulti). Options are focusable buttons with selection implemented only on `onMouseDown`. Proof for ComboInput: `/tmp/taskdash-ui-audit.test.jsx:80-85`.

**Reproduce:** Properties → Waiting for → open Jane Doe listbox → focus its option → dispatch its click activation without a preceding mousedown.

**Expected:** A focusable option activated by keyboard/assistive click selects Jane Doe, just as pointer activation does.

**Actual:** The click has no selection handler; Waiting for remains empty. This is the activation event native focused buttons produce for keyboard use; the harness dispatches the click directly, not a simulated browser Enter default.

**Recommendation:** Select on click, using mousedown only to preserve input focus if needed; or adopt a coherent combobox pattern that keeps focus on the input and removes options from Tab order. Maintain existing input Arrow/Enter selection. Share the chosen policy across the three pickers. Mention buttons at `src/app/MentionTextarea.jsx:139-145` use the same event pattern but were not separately exercised.

**Acceptance coverage:** App option activation click selects value and closes popup; input Arrow/Enter still works; pointer does not choose twice. Verify Tab-to-option/Enter in a real browser. Existing tests cover mention parsing (`src/app/utils/__tests__/mentions.test.js`), not rendered picker activation.

### UI-07 — P2: Metadata fields' visible labels are not associated with their controls

**Locations:** `src/app/App.jsx:1038-1044` (`Field` renders sibling label without htmlFor), `609-623` (metadata Contexts and Time estimate), `1385` (unnamed ComboInput), `1417` (SelectInput), `1475` (ChipMulti). Proof: `/tmp/taskdash-ui-audit.test.jsx:86-92`.

**Reproduce:** Open Properties and inspect Contexts: `input.labels.length === 0`, no aria-label, no aria-labelledby. Focus a metadata combobox: it also lacks aria-activedescendant.

**Expected:** The visible field name is programmatically associated with the input; picker active option is exposed when focus remains on the combobox.

**Actual:** The visible label contributes no name association to Contexts. Placeholder `work, phone` may provide fallback accessible text in some browsers, but is not the field's visible name. The same Field pattern is reused broadly. The missing active-descendant is recorded as supporting picker markup debt, not a separate ticket duplicating UI-06.

**Recommendation:** Give fields stable IDs and htmlFor, or use aria-labelledby for custom controls. Explicitly label multiple controls in composite fields. As part of UI-06's chosen picker interaction pattern, supply stable option IDs and aria-activedescendant while focus stays on the combobox. Do not assume surrounding visual proximity is an accessible name.

**Acceptance coverage:** Assert association to the visible Contexts/Time estimate/Waiting for labels through rendered App. Add accessible-name and active-option checks with a proper accessibility query library or browser accessibility tree; happy-dom attribute checks alone do not prove screen-reader output. Keep picker activation work under UI-06 and field labeling under UI-07.

## Bounded observations and explicit limitations — not additional confirmed tickets

- **More menu:** `/tmp/taskdash-ui-audit.test.jsx:68-72` confirms opening keeps trigger focus and Escape leaves the menu open. `src/app/IconRail.jsx:109-120` declares menu/menuitem without menu keyboard handling. Before creating another ticket, combine this with the narrow menu reachability investigation below; choose a disclosure pattern or implement full menu focus/keyboard behavior. No browser traversal or screen-reader test was performed.
- **Likely narrow More-menu clipping, unverified visually:** `src/plugin.css:42-55` sets rail overflow hidden; `96-111` positions the menu absolutely above a relative tabs container with `bottom:64px`. It remains a descendant of that clipping rail (`src/app/IconRail.jsx:96-123`). High z-index does not bypass ancestor overflow. Check actual bounding boxes/hit-testing at 500 px in a browser before labeling the menu unreachable. Happy-dom has no reliable layout engine. Consider a portal or moving clipping to the scrolling bar if confirmed.
- **Responsive metadata dialog styling is present:** source narrow rules at `src/plugin.css:169-174` descend from `.shell.td-narrow`, and this task dialog is rendered inside the shell. No finding claims those selectors fail to match. Visual header wrapping, short-pane reachability, horizontal overflow and editor scrolling remain unverified.
- **Pane versus viewport breakpoint risk:** container hook drives 768/1700 decisions (`src/app/App.jsx:1503-1510`, `src/app/useContainerWidth.js:9-27`), while secondary CSS uses viewport media queries (`src/app/glass.css:580-587`). Test an 800–1080 px split pane in a wide window, a 1200 px pane, a short pane, and 1700 threshold crossings in a browser. No clipping defect inferred solely from widths or aesthetics.
- **Scroll/selection:** task lists, task documents and metadata bodies have explicit overflow handling (`src/app/App.jsx:3620`, `4228`; `src/app/index.css:395`). No scroll loss or selected-row visibility defect was reproduced. There is no demonstrated browser scroll-position regression in this report.
- **Performance hotspots, no confirmed slowdown:** timer ticks rerender App each second (`src/app/App.jsx:1653-1657`); filters/sorts at `3256-3293`, time-note summary scans at `3348-3353` and calendar construction at `3366-3370` run during render even when their pages are inactive. Mention caret measurement creates a mirror and reads layout on matching input (`src/app/MentionTextarea.jsx:33-60`, `78-94`). Profile representative task/time-note counts before optimizing. `getTime` at `src/app/App.jsx:2300-2302` is constant time, not a tracker-row scan; group counts at `3635` scan once per bounded group, not once per row. No blanket quadratic-render finding is made.
- **Rejected candidate:** search-driven selection in Review did not demonstrate metadata draft loss because Review uses WorkflowFocusPanel (`src/app/App.jsx:3945-3961`), not the metadata inspector. Do not create a ticket for that speculative path. UI-01 provides a separately reproduced loss path.
- **Cancellation during async save:** MetadataDialog disables Cancel while saving (`src/app/App.jsx:208-209`), but window Escape and backdrop cancellation remain active (`181-185`, `199`). No deferred-save race was exercised; record this for a focused save/cancel test, not a confirmed persistence bug.

## Existing integration gaps and shipped Close correction

`src/__tests__/pluginIntegration.test.jsx` has six tests: boot/render/startup-read rule (`172`), queue separation (`222`), comment write (`260`), persistent metadata save (`332`), 1200 px dialog opening (`376`), and dirty-inspector Discard navigation (`408`). None covers the seven confirmed flows above. Passing the existing suite therefore does not contradict these observations.

Add a **regression test only**, not another Close fix: baseline callbacks at `src/app/App.jsx:4178` and `4184` are corrected in the restored/shipped implementation per parent's parity proof. Test clicking normal Close and recurring Archive series through the real view, completing confirmation where applicable, and asserting the fake-vault Markdown status/archive result and displayed task state. The old baseline `pluginIntegration.test.jsx` lacks this coverage even though shipped behavior is fixed. Do not run those acceptance tests against the uncorrected temp baseline and mistake the resulting failure for a shipped defect.

No implementation was attempted. Recommendations use the existing App/dialog/picker interfaces; no new architecture is required. The initial audit is intentionally bounded to the evidence above.
