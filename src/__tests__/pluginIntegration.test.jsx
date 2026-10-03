// @vitest-environment happy-dom
//
// End-to-end integration: boots the real plugin class (main.ts), opens the
// real view (view.tsx), which mounts the real React app (App.jsx) wired to
// the real ObsidianVaultAdapter (vault/obsidian.ts) against a fake vault.
// Asserts the dashboard actually renders vault data and honors the startup
// rule (zero vault reads before the view opens).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDashPlugin from '../main.ts';
import { TASKDASH_VIEW_TYPE } from '../view.tsx';

// ── Fake vault (duck-typed TFile/TFolder like the adapter expects) ──
function makeFakeApp() {
  const files = new Map();
  const folders = new Set();
  const failures = { read:0, process:[] };
  const base = p => p.split('/').pop();
  const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  let reads = 0;

  const fileObj = path => ({
    path,
    name: base(path),
    stat: { mtime: files.get(path).mtime, size: String(files.get(path).content).length },
  });
  const folderObj = path => ({
    path,
    name: base(path),
    get children() {
      const kids = [];
      for (const f of folders) if (f && parentOf(f) === path) kids.push(folderObj(f));
      for (const p of files.keys()) if (parentOf(p) === path) kids.push(fileObj(p));
      return kids;
    },
  });

  const vault = {
    getName() {
      return 'test-vault';
    },
    getAbstractFileByPath(path) {
      if (folders.has(path)) return folderObj(path);
      if (files.has(path)) return fileObj(path);
      return null;
    },
    async create(path, content) {
      if (app.__failTrackerOpen && path.endsWith('/timetracker.md')) throw new Error('tracker unavailable');
      files.set(path, { content, mtime: Date.now() });
      return fileObj(path);
    },
    async createFolder(path) {
      folders.add(path);
    },
    async readBinary(tfile) {
      reads += 1;
      if (failures.read) {
        failures.read -= 1;
        throw new Error('injected read failure');
      }
      return new TextEncoder().encode(String(files.get(tfile.path).content)).buffer;
    },
    async process(tfile, fn) {
      if (failures.process.length) {
        throw new Error(failures.process.shift());
      }
      const entry = files.get(tfile.path);
      const next = fn(String(entry.content));
      files.set(tfile.path, { content: next, mtime: entry.mtime + 1 });
      return next;
    },
    async modifyBinary() {},
    async createBinary() {},
    async trash(target) {
      files.delete(target.path);
      folders.delete(target.path);
    },
    on() {
      return {};
    },
    offref() {},
  };

  const openedFiles = [];
  const app = {
    vault,
    fileManager: {
      async renameFile(file, path) {
        if (app.__failRename) {
          app.__failRename = false;
          throw new Error('Injected rename failure');
        }
        const entry = files.get(file.path);
        files.delete(file.path);
        files.set(path, { ...entry, mtime: entry.mtime + 1 });
      },
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {}, openFile:async file => openedFiles.push(file.path) }),
      revealLeaf: async () => {},
    },
    __viewFactories: {},
    __commands: [],
    __ribbon: [],
    __files: files,
    __folders: folders,
    __failNextRead: () => { failures.read += 1; },
    __failNextProcess: message => { failures.process.push(message); },
    __bumpFileMtime: path => { files.get(path).mtime += 1; },
    __failTrackerOpen: false,
    readCount: () => reads,
    __openedFiles: openedFiles,
  };
  return app;
}

const TASK_MD = `---
title: Ship the integration test
status: in-progress
priority: high
due: 2026-07-06
tags:
  - work
---
# Ship the integration test

- [ ] render in the dashboard
`;

const EDITABLE_TASK_MD = `---
title: Edit a native task log
status: none
priority: normal
due: 2026-07-10
tags:
  - task
---
# Edit a native task log

### [[2026-06-03]]
Log: [08:03] Original log text

---
`;

const SECOND_TASK_MD = `---
title: Review the release
status: none
priority: normal
due: 2026-07-11
tags:
  - task
---
# Review the release
`;

const BRAIN_DUMP_TASK_MD = `---
title: BD - Explore a rough idea
status: none
priority: normal
---
# BD - Explore a rough idea
`;

const WAITING_TASK_MD = `---
title: Follow up with Jane
status: none
priority: normal
waitingfor:
  - Jane Doe
---
# Follow up with Jane
`;

const today = new Date();
const TODAY_DATE = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const DAILY_NOTE_MD = `# Daily note\n\n## Time Clock\n\n| Time | Event |\n| --- | --- |\n| 08:30 | Clock in |\n| 17:00 | Clock out |\n\n### Explanation\n\nKeep this paragraph inside Time Clock.\n\n---\n\n## Notes\n\n- Existing note\n`;

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return predicate();
}

describe('TaskDash plugin end-to-end', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    localStorage.clear();
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect:{ width:1800 } }]); }
      disconnect() {}
    };
  });

  it('associates shared creation form labels with distinct controls', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('People');
    app.__pluginData = { folders:{ tasks:'Tasks', people:'People' } };
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('button[aria-label="People"]'))).toBe(true);
    view.contentEl.querySelector('button[aria-label="People"]').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button => button.textContent === '+ New Person'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button => button.textContent === '+ New Person').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('form'))).toBe(true);
    const labels = [...view.contentEl.querySelectorAll('form label')];
    for (const text of ['Person name', 'Company / client', 'Role', 'Email', 'Phone', 'Tags (comma-separated)', 'Initial notes']) {
      const label = labels.find(item => item.textContent === text);
      expect(label?.htmlFor, `${text}: ${label?.outerHTML}`).toBeTruthy();
      expect([...view.contentEl.querySelectorAll('input, textarea, select')].some(control => control.id === label.htmlFor)).toBe(true);
    }
    expect(new Set(labels.map(label => label.htmlFor)).size).toBe(labels.length);
    await view.onClose();
  });

  it('keeps global open-task calendar totals when changing weeks and warns on weekend due dates', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    const fixtures = [
      ['old','due: 2020-01-01'], ['future','due: 2030-01-05\nRecurrent: true\nrecurrence: FREQ=DAILY'],
      ['undated',''], ['scheduled','scheduled: 2030-01-05'], ['closed','status: done'], ['BD - idea',''],
    ];
    for (const [name, metadata] of fixtures) app.__files.set(`Tasks/${name}.md`, { content:`---\ntitle: ${name}\n${metadata}\n---\nBody\n`, mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks' } };
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('button[aria-label="Calendar"]'))).toBe(true);
    view.contentEl.querySelector('button[aria-label="Calendar"]').click();
    const totals = () => [...view.contentEl.querySelectorAll('.td-calendar-stat')].map(el=>el.textContent);
    expect(await waitFor(() => totals().length === 3)).toBe(true);
    expect(totals()).toEqual(['Total4','Overdue1','On track3']);
    const initialWeek = view.contentEl.querySelector('.td-calendar-header h2').textContent;
    view.contentEl.querySelector('button[aria-label="Next week"]').click();
    expect(await waitFor(() => view.contentEl.querySelector('.td-calendar-header h2').textContent !== initialWeek)).toBe(true);
    expect(totals()).toEqual(['Total4','Overdue1','On track3']);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === '+ New task').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('form'))).toBe(true);
    const label = [...view.contentEl.querySelectorAll('form label')].find(el=>el.textContent === 'Due');
    const input = [...view.contentEl.querySelectorAll('input')].find(el=>el.id === label.htmlFor);
    const setDate = value => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    setDate('2030-01-05');
    expect(await waitFor(() => !!view.contentEl.querySelector('[role="status"].td-weekend-warning'))).toBe(true);
    expect(view.contentEl.querySelector('.td-weekend-warning').textContent).toContain('Saturday');
    setDate('2030-01-06');
    expect(await waitFor(() => view.contentEl.querySelector('.td-weekend-warning')?.textContent.includes('Sunday'))).toBe(true);
    setDate('2030-01-07');
    expect(await waitFor(() => !view.contentEl.querySelector('.td-weekend-warning'))).toBe(true);
    await view.onClose();
  });

  it('keeps a failed timer stop pending across reload and retries the frozen session once', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-detail-body'))).toBe(true);

    const timerButton = () => [...view.contentEl.querySelector('.td-task-detail-body').parentElement
      .querySelectorAll('button')].find(button => ['Start','Stop'].includes(button.textContent));
    timerButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => timerButton()?.textContent === 'Stop')).toBe(true);
    const startedAt = JSON.parse(Object.values(localStorage).find(value => value.includes('"taskId"'))).start;

    const started = startedAt + 5 * 60 * 1000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(started);
    app.__bumpFileMtime('Tasks/timetracker.md');
    app.__failNextRead();
    timerButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.textContent.includes('Time logging failed'))).toBe(true);
    const pending = JSON.parse(Object.values(localStorage).find(value => value.includes('"taskId"')));
    expect(pending.stopEnd).toBe(started);
    expect(timerButton().textContent).toBe('Stop');

    await view.onClose();
    const recoveredView = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    recoveredView.app = app;
    await recoveredView.onOpen();
    expect(await waitFor(() => !!recoveredView.contentEl.querySelector('.td-task-detail-body'))).toBe(true);
    const retryButton = () => [...recoveredView.contentEl.querySelector('.td-task-detail-body').parentElement
      .querySelectorAll('button')].find(button => ['Start','Stop'].includes(button.textContent));
    expect(await waitFor(() => retryButton()?.textContent === 'Stop')).toBe(true);
    app.__failNextProcess('injected write failure');
    retryButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(retryButton().textContent).toBe('Stop');
    expect(JSON.parse(Object.values(localStorage).find(value => value.includes('"taskId"'))).stopEnd).toBe(started);

    app.__failNextProcess('injected stale-write conflict');
    retryButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(retryButton().textContent).toBe('Stop');
    expect(JSON.parse(Object.values(localStorage).find(value => value.includes('"taskId"'))).stopEnd).toBe(started);

    dateNow.mockReturnValue(started + 30000);
    retryButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => retryButton()?.textContent === 'Start')).toBe(true);
    const tracker = app.__files.get('Tasks/timetracker.md').content;
    expect(tracker.match(/\| .*ship-it.* \| 5 \|/g)).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    await recoveredView.onClose();
  }, 20000);

  it('retains a timer when no tracker handle is available', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('Tasks/review.md', { content:SECOND_TASK_MD, mtime:2 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };
    app.__failTrackerOpen = true;

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-detail-body'))).toBe(true);
    const timerButton = () => [...view.contentEl.querySelector('.td-task-detail-body').parentElement
      .querySelectorAll('button')].find(button => ['Start','Stop'].includes(button.textContent));
    timerButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => timerButton()?.textContent === 'Stop')).toBe(true);
    timerButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.textContent.includes('Time logging failed'))).toBe(true);
    expect(timerButton().textContent).toBe('Stop');
    expect(Object.values(localStorage).some(value => value.includes('"taskId"'))).toBe(true);

    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Review the release'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.querySelector('h2')?.textContent === 'Review the release')).toBe(true);
    timerButton().dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(JSON.parse(Object.values(localStorage).find(value => value.includes('"taskId"'))).taskId).toBe('ship-it.md');

    await view.onClose();
  });

  it('boots, registers surfaces without touching the vault, and renders vault data when the view opens', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('Done');
    app.__folders.add('People');
    app.__files.set('Tasks/ship-it.md', { content: TASK_MD, mtime: 1 });
    app.__files.set('People/Jane Doe.md', { content: '---\nperson: Jane Doe\n---\n', mtime: 1 });
    // A reference folder must be configured or the app shows its one-time
    // folder-setup screen instead of the dashboard.
    app.__pluginData = {
      folders: { tasks: 'Tasks', done: 'Done', people: 'People' },
      enableStatusBarTimer: true,
    };

    const plugin = new TaskDashPlugin(app, { id: 'taskdash', version: '0.1.0' });
    await plugin.onload();

    // Surfaces registered…
    expect(Object.keys(app.__viewFactories)).toEqual([TASKDASH_VIEW_TYPE]);
    expect(app.__commands.map(c => c.id).sort()).toEqual([
      'create-task',
      'open',
      'open-review',
      'open-waiting',
      'refresh',
      'toggle-timer',
      'triage-brain-dump',
    ]);
    expect(app.__ribbon).toHaveLength(1);
    expect(app.__settingTab).toBeTruthy();
    // …and the startup rule holds: zero vault reads before the view opens.
    expect(app.readCount()).toBe(0);

    // Open the view like Obsidian would.
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    const rendered = await waitFor(() => view.contentEl.textContent.includes('Ship the integration test'));
    expect(rendered).toBe(true);
    expect(app.readCount()).toBeGreaterThan(0);
    expect(view.contentEl.querySelector('.taskdash-root')).toBeTruthy();
    expect(view.contentEl.querySelector('.shell')).toBeTruthy();
    expect(view.contentEl.querySelector('.td-task-list-group')?.textContent).toContain('Overdue');

    // Clean unmount.
    await view.onClose();
    expect(view.contentEl.textContent).toBe('');
  });

  it('saves Hours edits through the fake vault without losing daily note prose', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('Daily');
    app.__files.set(`Daily/${TODAY_DATE}.md`, { content:DAILY_NOTE_MD, mtime:1 });
    app.__pluginData = {
      folders: { tasks:'Tasks', daily:'Daily' },
      enableStatusBarTimer: true,
    };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => view.contentEl.querySelector('.shell'))).toBe(true);

    view.contentEl.querySelector('button[aria-label="Hours"]')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Save hours'))).toBe(true);

    const clockOut = [...view.contentEl.querySelectorAll('input[type="time"]')]
      .find(input => input.value === '17:00');
    const timeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    timeSetter.call(clockOut, '17:15');
    clockOut.dispatchEvent(new Event('input', { bubbles:true }));
    clockOut.dispatchEvent(new Event('change', { bubbles:true }));

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Save hours')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const readBack = await waitFor(() => app.__files.get(`Daily/${TODAY_DATE}.md`).content.includes('| 17:15 | Clock out |'));
    expect(readBack).toBe(true);
    const savedNote = app.__files.get(`Daily/${TODAY_DATE}.md`).content;
    expect(savedNote).toContain('### Explanation\n\nKeep this paragraph inside Time Clock.');
    expect(savedNote).toContain('## Notes\n\n- Existing note');

    await view.onClose();
  });

  it('keeps Brain Dump out of work and exposes Review and Waiting as separate native queues', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('Tasks/BD - rough-idea.md', { content:BRAIN_DUMP_TASK_MD, mtime:2 });
    app.__files.set('Tasks/follow-up.md', { content:WAITING_TASK_MD, mtime:3 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    const workReady = await waitFor(() => view.contentEl.querySelectorAll('.td-task-list-row').length === 2);
    expect(workReady).toBe(true);
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-properties-trigger'))).toBe(true);
    expect([...view.contentEl.querySelectorAll('.td-task-list-row')].some(row => row.textContent.includes('Explore a rough idea'))).toBe(false);

    view.contentEl.querySelector('button[aria-label="BD tasks"]')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .some(row => row.textContent.includes('Explore a rough idea')))).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));

    view.contentEl.querySelector('button[aria-label="Review"]')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-workflow-layout'))).toBe(true);
    expect(view.contentEl.querySelector('.td-workflow-layout').textContent).not.toContain('Explore a rough idea');
    await new Promise(resolve => setTimeout(resolve, 50));

    view.contentEl.querySelector('button[aria-label="Waiting"]')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.querySelector('.td-page-host')?.textContent.includes('Follow up with Jane'))).toBe(true);

    await view.onClose();
  });

  it('keeps Review checkbox Space from navigating while row Enter and Space still navigate', async () => {
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect:{ width:500 } }]); }
      disconnect() {}
    };

    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('Tasks/review-release.md', { content:SECOND_TASK_MD.replace('status: none', 'status: in-progress'), mtime:2 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    expect(await waitFor(() => view.contentEl.querySelectorAll('.td-task-list-row').length === 2)).toBe(true);
    window.dispatchEvent(new CustomEvent('taskdash-2-2-command', { detail:{ action:'open-review' } }));
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-workflow-layout'))).toBe(true);
    expect(await waitFor(() => view.contentEl.querySelectorAll('.td-task-list-row input[type="checkbox"]').length === 2)).toBe(true);

    const taskRows = [...view.contentEl.querySelectorAll('.td-task-list-row')];
    const checkboxRow = taskRows.find(row => !row.classList.contains('is-selected'));
    const checkbox = checkboxRow.querySelector('input[type="checkbox"]');
    checkbox.focus();
    const listOpenBeforeSpace = view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open');
    // happy-dom verifies propagation and navigation; it does not emulate a browser's native Space toggle.
    const checkboxSpace = new KeyboardEvent('keydown', { key:' ', bubbles:true, cancelable:true });
    checkbox.dispatchEvent(checkboxSpace);

    expect(checkboxSpace.defaultPrevented).toBe(false);
    expect(checkboxRow.classList.contains('is-selected')).toBe(false);
    expect(view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open')).toBe(listOpenBeforeSpace);

    const rowSpace = new KeyboardEvent('keydown', { key:' ', bubbles:true, cancelable:true });
    checkboxRow.dispatchEvent(rowSpace);
    expect(rowSpace.defaultPrevented).toBe(true);
    expect(await waitFor(() => checkboxRow.classList.contains('is-selected'))).toBe(true);
    expect(await waitFor(() => !view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open'))).toBe(true);

    view.contentEl.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    const enterRow = [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => !row.classList.contains('is-selected'));
    const rowEnter = new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true });
    enterRow.dispatchEvent(rowEnter);
    expect(rowEnter.defaultPrevented).toBe(true);
    expect(await waitFor(() => enterRow.classList.contains('is-selected'))).toBe(true);

    await view.onClose();
  });

  it('saves an edited task-log comment through the native view', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/editable-task.md', { content: EDITABLE_TASK_MD, mtime: 1 });
    app.__pluginData = {
      folders: { tasks: 'Tasks' },
      enableStatusBarTimer: true,
    };

    const plugin = new TaskDashPlugin(app, { id: 'taskdash', version: '0.1.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    const taskRowReady = await waitFor(() => [...view.contentEl.querySelectorAll('[role="button"]')]
      .some(row => row.textContent.includes('Edit a native task log')));
    expect(taskRowReady).toBe(true);

    const taskRow = [...view.contentEl.querySelectorAll('[role="button"]')]
      .find(row => row.textContent.includes('Edit a native task log'));
    taskRow.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const editButtonReady = await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Edit'));
    expect(editButtonReady).toBe(true);
    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Edit')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const textareaReady = await waitFor(() => [...view.contentEl.querySelectorAll('textarea')]
      .some(textarea => textarea.value === 'Original log text'));
    expect(textareaReady).toBe(true);
    let textarea = [...view.contentEl.querySelectorAll('textarea')]
      .find(element => element.value === 'Original log text');

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Save')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const editorClosedWithoutChange = await waitFor(() => [...view.contentEl.querySelectorAll('textarea')]
      .every(element => element.value !== 'Original log text'));
    expect(editorClosedWithoutChange).toBe(true);
    expect(app.__files.get('Tasks/editable-task.md').content).toContain('Log: [08:03] Original log text');

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Edit')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    const reopenedEditor = await waitFor(() => [...view.contentEl.querySelectorAll('textarea')]
      .some(element => element.value === 'Original log text'));
    expect(reopenedEditor).toBe(true);
    textarea = [...view.contentEl.querySelectorAll('textarea')]
      .find(element => element.value === 'Original log text');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    valueSetter.call(textarea, 'Updated log text');
    textarea.dispatchEvent(new Event('input', { bubbles:true }));

    const saveButtonReady = await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Save'));
    expect(saveButtonReady).toBe(true);
    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Save')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const saved = await waitFor(() => app.__files.get('Tasks/editable-task.md').content.includes('Log: [08:03] Updated log text'));
    expect(saved).toBe(true);
    expect(view.contentEl.textContent).toContain('Updated log text');
    expect(view.contentEl.textContent).not.toContain('Original log text');

    await view.onClose();
  });

  it('keeps the wide task document free of a sidebar and edits metadata on demand', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content: TASK_MD, mtime: 1 });
    app.__pluginData = {
      folders: { tasks: 'Tasks' },
      enableStatusBarTimer: true,
    };

    const plugin = new TaskDashPlugin(app, { id: 'taskdash', version: '0.1.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    const taskRowReady = await waitFor(() => [...view.contentEl.querySelectorAll('[role="button"]')]
      .some(row => row.textContent.includes('Ship the integration test')));
    expect(taskRowReady).toBe(true);
    [...view.contentEl.querySelectorAll('[role="button"]')]
      .find(row => row.textContent.includes('Ship the integration test'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(view.contentEl.querySelector('.td-task-inspector')).toBeNull();
    const openNote = [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Open Markdown note');
    expect(openNote).toBeTruthy();
    openNote.click();
    expect(await waitFor(() => app.__openedFiles.includes('Tasks/ship-it.md'))).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeNull();
    view.contentEl.querySelector('.td-task-properties-trigger').click();
    expect(await waitFor(() => view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    const inspector = view.contentEl.querySelector('.td-metadata-dialog');
    expect(inspector.textContent).toContain('ship-it');

    const contexts = inspector.querySelector('input[placeholder="work, phone"]');
    const timeEstimate = inspector.querySelector('input[type="number"][min="0"]');
    const contextsLabel = [...inspector.querySelectorAll('label')].find(label => label.textContent.trim() === 'Contexts (comma-separated)');
    const timeEstimateLabel = [...inspector.querySelectorAll('label')].find(label => label.textContent.trim() === 'Time estimate (minutes)');
    const waitingForLabel = [...inspector.querySelectorAll('label')].find(label => label.textContent.trim().startsWith('Waiting for'));
    const waitingFor = waitingForLabel.control;
    expect(contexts.labels).toContain(contextsLabel);
    expect(timeEstimate.labels).toContain(timeEstimateLabel);
    expect(waitingFor.labels).toContain(waitingForLabel);
    for (const name of ['Priority', 'Status', 'Client', 'Building', 'Projects', 'Extra tags']) {
      const label = [...inspector.querySelectorAll('label')].find(element => element.textContent.startsWith(name));
      expect(label.control, `${name} has a labelled control`).toBeTruthy();
      expect(label.control.labels).toContain(label);
    }
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'work, phone');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...inspector.querySelectorAll('button')]
      .find(button => button.textContent === 'Save metadata')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    const saved = await waitFor(() => app.__files.get('Tasks/ship-it.md').content.includes('  - "phone"'));
    expect(saved).toBe(true);
    expect(await waitFor(() => !view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    expect(view.contentEl.querySelector('.td-task-inspector')).toBeNull();

    await view.onClose();
  });

  it('reconciles a completed task after archive failure and retries without losing intervening edits', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('Done');
    app.__files.set('Tasks/a.md', { content: TASK_MD, mtime: 1 });
    app.__files.set('Done/a.md', { content: 'Existing archived note', mtime: 2 });
    app.__pluginData = { folders: { tasks: 'Tasks', done: 'Done' }, enableStatusBarTimer: true };

    const plugin = new TaskDashPlugin(app, { id: 'taskdash-2-2', version: '2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .some(row => row.textContent.includes('Ship the integration test')))).toBe(true);

    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Ship the integration test'))
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-properties-trigger'))).toBe(true);

    app.__failRename = true;
    view.contentEl.querySelector('button[title="Mark done & archived"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(await waitFor(() => view.contentEl.querySelector('.td-dialog-confirm')?.textContent === 'Complete task')).toBe(true);
    view.contentEl.querySelector('.td-dialog-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(await waitFor(() => view.contentEl.querySelector('.td-dialog-confirm')?.textContent === 'Retry archive')).toBe(true);
    expect(app.__files.get('Tasks/a.md').content).toContain('status: done');
    expect(app.__files.get('Tasks/a.md').content).toContain('  - archived');
    expect(view.contentEl.querySelector('.td-dialog').textContent).toContain('completed');
    expect(app.__files.has('Done/a-2.md')).toBe(false);

    app.__files.get('Tasks/a.md').content += '\nExternal edit retained\n';
    view.contentEl.querySelector('.td-dialog-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(await waitFor(() => app.__files.has('Done/a-2.md'))).toBe(true);
    expect(app.__files.has('Tasks/a.md')).toBe(false);
    expect(app.__files.get('Done/a.md').content).toBe('Existing archived note');
    expect(app.__files.get('Done/a-2.md').content).toContain('External edit retained');
    expect([...view.contentEl.querySelectorAll('.td-dialog-confirm')].some(button => button.textContent === 'Retry archive')).toBe(false);
    await view.onClose();
  });

  it('uses a spacious task-properties dialog at normal pane widths', async () => {
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect:{ width:1200 } }]); }
      disconnect() {}
    };

    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Properties'))).toBe(true);
    expect(view.contentEl.querySelector('.td-task-inspector')).toBeNull();

    const propertiesButton = [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Properties');
    propertiesButton.focus();
    propertiesButton.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => !!view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog').textContent).toContain('Ship the integration test');
    expect(view.contentEl.querySelector('.td-metadata-dialog').contains(document.activeElement)).toBe(true);
    const metadataDialog = view.contentEl.querySelector('.td-metadata-dialog');
    const metadataControls = metadataDialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    const tabForward = new KeyboardEvent('keydown', { key:'Tab', bubbles:true, cancelable:true });
    metadataControls[metadataControls.length - 1].focus();
    metadataDialog.dispatchEvent(tabForward);
    expect(tabForward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(metadataControls[0]);
    propertiesButton.focus();
    expect(metadataDialog.contains(document.activeElement)).toBe(true);
    expect([...metadataDialog.parentElement.parentElement.children]
      .filter(element => element !== metadataDialog.parentElement)
      .every(element => element.hasAttribute('inert'))).toBe(true);

    view.contentEl.querySelector('.td-metadata-dialog .td-dialog-cancel').click();
    await waitFor(() => !view.contentEl.querySelector('.td-metadata-dialog'));
    expect(document.activeElement).toBe(propertiesButton);

    propertiesButton.click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    view.contentEl.querySelector('.td-metadata-dialog-save').click();
    await waitFor(() => !view.contentEl.querySelector('.td-metadata-dialog'));
    expect(document.activeElement).toBe(propertiesButton);

    await view.onClose();
  });

  it.each([
    ['Waiting for', 'Jane Doe'],
    ['Priority', 'Low'],
  ])('keeps %s options focused when keyboard focus leaves the picker input', async (field, optionName) => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('People');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('People/Jane Doe.md', { content:'---\nperson: Jane Doe\n---\n', mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks', people:'People' }, enableStatusBarTimer:true };
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    document.body.append(view.contentEl);
    await view.onOpen();
    expect(await waitFor(() => view.contentEl.querySelector('.td-task-properties-trigger'))).toBeTruthy();
    view.contentEl.querySelector('.td-task-properties-trigger').click();
    expect(await waitFor(() => view.contentEl.querySelector('.td-metadata-dialog'))).toBeTruthy();
    const dialog = view.contentEl.querySelector('.td-metadata-dialog');
    const picker = [...dialog.querySelectorAll('label')].find(label => label.textContent.startsWith(field)).control;
    picker.focus();
    if (picker.tagName === 'BUTTON') picker.click();
    expect(await waitFor(() => [...dialog.querySelectorAll('[role="option"]')].some(option => option.textContent.trim() === optionName))).toBe(true);
    const option = [...dialog.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === optionName);
    // Native Tab's focus transition; a real-browser check covers Tab dispatch itself.
    option.focus();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(option.isConnected).toBe(true);
    expect(document.activeElement).toBe(option);
    option.click();
    expect(await waitFor(() => picker.value === optionName || picker.textContent.includes(optionName))).toBe(true);
    expect(document.activeElement).toBe(picker);
    picker.focus();
    if (picker.tagName === 'BUTTON') picker.click();
    dialog.querySelector('.td-dialog-cancel').focus();
    expect(await waitFor(() => !dialog.querySelector('[role="option"]'))).toBe(true);
    await view.onClose();
    view.contentEl.remove();
  });

  it('closes an open metadata picker before cancelling the Properties dialog with Escape', async () => {
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect:{ width:1200 } }]); }
      disconnect() {}
    };

    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__folders.add('People');
    app.__folders.add('Projects');
    app.__folders.add('Projects/Alpha');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('People/Jane Doe.md', { content:'---\nperson: Jane Doe\n---\n', mtime:1 });
    app.__files.set('Projects/Alpha/Cover_Alpha.md', { content:'---\nproject: Alpha\n---\n', mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks', people:'People', projects:'Projects' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    document.body.append(view.contentEl);
    await view.onOpen();

    expect(await waitFor(() => [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .some(row => row.textContent.includes('Ship the integration test')))).toBe(true);
    const taskRow = [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Ship the integration test'));
    taskRow.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Properties')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const dialogReady = await waitFor(() => view.contentEl.querySelector('.td-metadata-dialog'));
    expect(dialogReady).toBeTruthy();
    const dialog = view.contentEl.querySelector('.td-metadata-dialog');
    const priority = dialog.querySelector('button[role="combobox"]');
    priority.click();
    expect(await waitFor(() => dialog.querySelector('[role="listbox"]'), 500)).toBe(true);
    priority.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    expect(await waitFor(() => !dialog.querySelector('[role="listbox"]'), 500)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeTruthy();

    const projectInput = dialog.querySelector('input[placeholder="Type project name + Enter..."]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(projectInput, 'Alpha');
    projectInput.dispatchEvent(new Event('input', { bubbles:true }));
    expect(dialog.querySelector('[role="listbox"]')?.textContent).toContain('Alpha');
    projectInput.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    expect(await waitFor(() => !dialog.querySelector('[role="listbox"]'), 500)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeTruthy();

    const contexts = dialog.querySelector('input[placeholder="work, phone"]');
    valueSetter.call(contexts, 'unsaved audit');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    const waitingFor = [...dialog.querySelectorAll('input[role="combobox"]')]
      .find(input => input.parentElement?.parentElement?.textContent.includes('Waiting for'));
    valueSetter.call(waitingFor, 'Jane');
    waitingFor.focus();
    waitingFor.dispatchEvent(new Event('input', { bubbles:true }));
    expect(dialog.querySelector('[role="listbox"]')?.textContent).toContain('Jane Doe');

    waitingFor.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    expect(await waitFor(() => !dialog.querySelector('[role="listbox"]'), 500)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeTruthy();
    expect(dialog.querySelector('input[placeholder="work, phone"]').value).toBe('unsaved audit');
    expect(dialog.querySelector('[role="listbox"]')).toBeNull();

    const secondEscape = new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true });
    contexts.dispatchEvent(secondEscape);
    expect(secondEscape.defaultPrevented).toBe(true);
    expect(await waitFor(() => !view.contentEl.querySelector('.td-metadata-dialog'), 500)).toBe(true);

    const note = view.contentEl.querySelector('textarea[placeholder^="Add a note"]');
    const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    textareaSetter.call(note, '@Jane');
    note.dispatchEvent(new Event('input', { bubbles:true }));
    expect(await waitFor(() => document.querySelector('.taskdash-mention-menu'), 500)).toBe(true);
    note.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    expect(await waitFor(() => !document.querySelector('.taskdash-mention-menu'), 500)).toBe(true);

    await view.onClose();
  });

  it('opens the mobile task list with Tasks navigation and keeps cancelled navigation in place', async () => {
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect:{ width:500 } }]); }
      disconnect() {}
    };

    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('Tasks/review.md', { content:SECOND_TASK_MD, mtime:2 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    expect(await waitFor(() => view.contentEl.querySelectorAll('.td-task-list-row').length === 2)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    const clickButton = label => {
      view.contentEl.querySelector(`.rail-mobile-tabs button[aria-label="${label}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    };

    clickButton('Today');
    expect(await waitFor(() => view.contentEl.querySelector('.rail-mobile-tabs button[aria-label="Today"]')?.classList.contains('on'))).toBe(true);
    clickButton('Tasks');
    expect(await waitFor(() => view.contentEl.querySelector('.td-pane-list')?.classList.contains('mobile-list-open'), 300)).toBe(true);

    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Ship the integration test'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open'))).toBe(true);

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Properties')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    const contexts = view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'work, mobile-draft');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));
    clickButton('Today');
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-unsaved-dialog'))).toBe(true);
    [...view.contentEl.querySelectorAll('.td-unsaved-dialog button')]
      .find(button => button.textContent === 'Stay')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !view.contentEl.querySelector('.td-unsaved-dialog'))).toBe(true);
    expect(view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open')).toBe(false);
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeTruthy();

    [...view.contentEl.querySelectorAll('.td-metadata-dialog button')]
      .find(button => button.textContent === 'Cancel')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    clickButton('Tasks');
    expect(await waitFor(() => view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open'))).toBe(true);
    clickButton('Today');
    expect(await waitFor(() => !view.contentEl.querySelector('.td-pane-list').classList.contains('mobile-list-open'))).toBe(true);

    await view.onClose();
  });

  it('asks before discarding unsaved dialog metadata when selecting another task', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content: TASK_MD, mtime: 1 });
    app.__files.set('Tasks/review.md', { content: SECOND_TASK_MD, mtime: 2 });
    app.__pluginData = { folders: { tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash', version:'0.1.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    const rowsReady = await waitFor(() => [...view.contentEl.querySelectorAll('.td-task-list-row')].length === 2);
    expect(rowsReady).toBe(true);
    const firstRow = [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Ship the integration test'));
    firstRow.focus();
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-properties-trigger'))).toBe(true);
    view.contentEl.querySelector('.td-task-properties-trigger').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    const contexts = view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'work, unsaved-audit');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Review the release'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const dialogReady = await waitFor(() => view.contentEl.querySelector('.td-unsaved-dialog'));
    expect(dialogReady).toBe(true);
    expect(view.contentEl.querySelector('.td-unsaved-dialog').contains(document.activeElement)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog').textContent).toContain('ship-it');
    expect(view.contentEl.querySelector('.td-unsaved-dialog').textContent).toContain('Unsaved property changes');

    [...view.contentEl.querySelectorAll('.td-unsaved-dialog button')]
      .find(button => button.textContent === 'Discard')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const switched = await waitFor(() => view.contentEl.querySelector('h2')?.textContent === 'Review the release');
    expect(switched).toBe(true);
    expect(document.activeElement).toBe(firstRow);
    expect(app.__files.get('Tasks/ship-it.md').content).not.toContain('unsaved-audit');

    expect(await waitFor(() => !!view.contentEl.querySelector('button[title="Mark done & archived"]'))).toBe(true);
    const closeTaskButton = view.contentEl.querySelector('button[title="Mark done & archived"]');
    closeTaskButton.focus();
    closeTaskButton.click();
    expect(await waitFor(() => !!view.contentEl.querySelector('[role="dialog"]'))).toBe(true);
    const confirmDialog = view.contentEl.querySelector('[role="dialog"]');
    expect(confirmDialog.contains(document.activeElement)).toBe(true);
    confirmDialog.querySelector('.td-dialog-cancel').click();
    await waitFor(() => !view.contentEl.querySelector('[role="dialog"]'));
    expect(document.activeElement).toBe(closeTaskButton);

    await view.onClose();
  });

  it('keeps an unsaved task draft selected while starting Quick Track timers', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/ship-it.md', { content:TASK_MD, mtime:1 });
    app.__files.set('Tasks/review.md', { content:SECOND_TASK_MD, mtime:2 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, enableStatusBarTimer:true };

    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();

    expect(await waitFor(() => view.contentEl.querySelectorAll('.td-task-list-row').length === 2)).toBe(true);
    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Ship the integration test'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-properties-trigger'))).toBe(true);
    view.contentEl.querySelector('.td-task-properties-trigger').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-metadata-dialog'))).toBe(true);
    const contexts = view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'unsaved audit');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Start')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Stop'), 1000)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]').value).toBe('unsaved audit');
    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Stop')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Start'), 1000)).toBe(true);

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent.includes('Quick Track'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.textContent.includes('Email'))).toBe(true);
    const email = [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Start' && button.parentElement.textContent.includes('Email'));
    expect(email).toBeTruthy();
    email.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => view.contentEl.textContent.includes('Email') && view.contentEl.textContent.includes('LIVE'), 1000)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]')?.value).toBe('unsaved audit');

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Stop' && button.parentElement.parentElement.textContent.includes('Email'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => !view.contentEl.textContent.includes('LIVE'), 1000)).toBe(true);
    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent.includes('+ Ad-hoc task'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => view.contentEl.querySelector('input[placeholder="e.g. Proposal draft…"]'))).toBe(true);
    const adHocInput = view.contentEl.querySelector('input[placeholder="e.g. Proposal draft…"]');
    valueSetter.call(adHocInput, 'Audit follow-up');
    adHocInput.dispatchEvent(new Event('input', { bubbles:true }));
    adHocInput.parentElement.querySelector('button')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    expect(await waitFor(() => view.contentEl.textContent.includes('Audit follow-up') && view.contentEl.textContent.includes('LIVE'), 1000)).toBe(true);
    expect(view.contentEl.querySelector('.td-metadata-dialog input[placeholder="work, phone"]').value).toBe('unsaved audit');

    await view.onClose();
  }, 15000);
  const setControlValue = (element, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles:true }));
  };
  const ollamaResponse = content => ({ ok:true, status:200, json:async()=>({ done:true, message:{ content:JSON.stringify(content) } }) });

  it('drafts an editable task from email only on request and saves once through Create Task', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__pluginData = { folders:{ tasks:'Tasks' }, emailAssistant:{ enabled:true, taskSkill:'Use the custom task skill.', commentSkill:'Comment skill.' } };
    const requests = [];
    globalThis.fetch = vi.fn(async (url, options) => {
      requests.push({ url, body:JSON.parse(options.body) });
      return requests.length === 1
        ? { ok:true, status:200, json:async()=>({ done:true, message:{ content:'{' } }) }
        : requests.length === 2
          ? Promise.reject(new Error('offline'))
        : ollamaResponse({ title:'Review the meter order', description:'Confirm the date with the contractor.' });
    });
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    expect(requests).toHaveLength(0);
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('.taskdash-root'))).toBe(true);
    expect(requests).toHaveLength(0);
    expect(await waitFor(() => !!view.contentEl.querySelector('button[aria-label="Calendar"]'))).toBe(true);
    view.contentEl.querySelector('button[aria-label="Calendar"]').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === '+ New task'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === '+ New task').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent.includes('Draft task from email')))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent.includes('Draft task from email')).click();
    const filesBeforeDraft = [...app.__files.entries()].map(([path, file])=>[path, file.content]);
    const email = view.contentEl.querySelector('.td-email-draft-panel textarea');
    setControlValue(email, 'Please confirm the meter installation date.');
    expect(requests).toHaveLength(0);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Generate draft').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('[role="alert"]'))).toBe(true);
    expect([...app.__files.entries()].map(([path, file])=>[path, file.content])).toEqual(filesBeforeDraft);
    expect(requests[0].body.messages.map(message=>message.content).join('\n')).toContain('Use the custom task skill.');
    plugin.settings.emailAssistant.taskSkill = 'Updated skill for the next request.';
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Generate draft').click();
    expect(await waitFor(() => view.contentEl.querySelector('[role="alert"]')?.textContent.includes('Could not reach Ollama'))).toBe(true);
    expect([...app.__files.entries()].map(([path, file])=>[path, file.content])).toEqual(filesBeforeDraft);
    expect(requests[1].body.messages.map(message=>message.content).join('\n')).toContain('Updated skill for the next request.');
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Generate draft').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === 'Use task draft'))).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests[2].body.messages.map(message=>message.content).join('\n')).toContain('Updated skill for the next request.');
    const title = [...view.contentEl.querySelectorAll('input')].find(input=>input.value === 'Review the meter order');
    const description = [...view.contentEl.querySelectorAll('textarea')].find(textarea=>textarea.value.includes('Confirm the date'));
    setControlValue(title, 'Confirm meter delivery date');
    setControlValue(description, 'Ask the contractor to confirm the delivery date.');
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Use task draft').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('input')].some(input=>input.value === 'Confirm meter delivery date'))).toBe(true);
    expect(view.contentEl.textContent).not.toContain('Other - Confirm meter delivery date');
    expect([...app.__files.entries()].map(([path, file])=>[path, file.content])).toEqual(filesBeforeDraft);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Create Task').click();
    expect(await waitFor(() => [...app.__files.entries()].some(([path, file])=>path.includes('Confirm meter delivery date') && file.content.includes('Ask the contractor to confirm the delivery date.')))).toBe(true);
    const createdPath = [...app.__files.keys()].find(path=>path.includes('Confirm meter delivery date'));
    const created = app.__files.get(createdPath).content;
    expect(created).toContain('title: Confirm meter delivery date');
    expect(created).toContain('Ask the contractor to confirm the delivery date.');
    expect([...app.__files.keys()].filter(path=>path.includes('Confirm meter delivery date'))).toHaveLength(1);
    await view.onClose();
  }, 15000);

  it('transfers an edited comment without writing, then preserves CRLF through Add', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__files.set('Tasks/editable-task.md', { content:EDITABLE_TASK_MD, mtime:1 });
    app.__pluginData = { folders:{ tasks:'Tasks' }, emailAssistant:{ enabled:true, taskSkill:'Task skill.', commentSkill:'Comment skill.' } };
    globalThis.fetch = vi.fn(async () => ollamaResponse({ comment:'Contractor will confirm the date.' }));
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('[role="button"]')].some(row=>row.textContent.includes('Edit a native task log')))).toBe(true);
    [...view.contentEl.querySelectorAll('[role="button"]')].find(row=>row.textContent.includes('Edit a native task log')).click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-task-activity'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent.includes('Draft comment from email')).click();
    const email = view.contentEl.querySelector('.td-email-draft-panel textarea');
    setControlValue(email, 'We will confirm the date with the contractor.');
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Generate draft').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === 'Use comment draft'))).toBe(true);
    const preview = [...view.contentEl.querySelectorAll('textarea')].find(textarea=>textarea.value === 'Contractor will confirm the date.');
    setControlValue(preview, 'Contractor update:\r\n\r\nThe installation date is still unconfirmed.');
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Use comment draft').click();
    const composer = view.contentEl.querySelector('.td-task-note-composer textarea');
    expect(await waitFor(() => composer.value.includes('Contractor update:'))).toBe(true);
    expect(composer.value).toBe('Contractor update:\r\n\r\nThe installation date is still unconfirmed.');
    expect(app.__files.get('Tasks/editable-task.md').content).toBe(EDITABLE_TASK_MD);
    const alert = vi.fn();
    const originalAlert = globalThis.alert;
    globalThis.alert = alert;
    app.__failNextProcess('injected comment write failure');
    const addButton = view.contentEl.querySelector('.td-task-note-composer button');
    addButton.click();
    addButton.click();
    expect(await waitFor(() => alert.mock.calls.length === 1)).toBe(true);
    expect(composer.value).toBe('Contractor update:\r\n\r\nThe installation date is still unconfirmed.');
    view.contentEl.querySelector('.td-task-note-composer button').click();
    expect(await waitFor(() => app.__files.get('Tasks/editable-task.md').content.includes('Contractor update:'))).toBe(true);
    const updated = app.__files.get('Tasks/editable-task.md').content;
    expect(updated).toContain('Contractor update:\r\n\r\nThe installation date is still unconfirmed.');
    expect(updated.split('Contractor update:').length - 1).toBe(1);
    expect(updated).toContain('### [[2026-06-03]]');
    expect(updated).toContain('Log: [08:03] Original log text');
    await view.onClose();
    globalThis.alert = originalAlert;
  });

  it('sizes the new-task form to its pane inside a wide desktop shell', async () => {
    const observers = [];
    globalThis.ResizeObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) {
        this.target = target;
        const width = target.classList?.contains('shell') ? 1200 : target.querySelector?.('.td-new-task-form') ? 440 : 1200;
        this.callback([{ target, contentRect:{ width } }]);
      }
      disconnect() {}
    };

    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__pluginData = { folders:{ tasks:'Tasks' } };
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('.shell .td-pane-list'))).toBe(true);
    expect(view.contentEl.querySelector('.shell')).toBeTruthy();
    expect(view.contentEl.querySelector('button[aria-label="Calendar"]')).toBeTruthy();

    view.contentEl.querySelector('button[aria-label="Calendar"]').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === '+ New task'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === '+ New task').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-new-task-form'))).toBe(true);
    const form = view.contentEl.querySelector('.td-new-task-form');
    expect(form.style.gridTemplateColumns).toContain('minmax(0,1fr)');
    const detailsToggle = [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent.includes('Add more details'));
    expect(detailsToggle).toBeTruthy();
    const details = view.contentEl.querySelector('.td-new-task-secondary-fields');
    expect(details.style.display).toBe('none');
    detailsToggle.click();
    expect(await waitFor(() => details.style.display !== 'none')).toBe(true);

    const panelObserver = observers.find(observer=>!observer.target?.classList?.contains('shell') && observer.target?.querySelector?.('.td-new-task-form'));
    expect(panelObserver).toBeTruthy();
    panelObserver.callback([{ target:panelObserver.target, contentRect:{ width:1000 } }]);
    expect(await waitFor(() => form.style.gridTemplateColumns.includes('minmax(360px,0.9fr)'))).toBe(true);
    expect(view.contentEl.querySelector('.td-new-task-secondary-toggle')).toBeNull();
    expect(details.style.display).not.toBe('none');
    await view.onClose();
  }, 15000);

  it('cancels a pending local draft without applying a late response or writing', async () => {
    const app = makeFakeApp();
    app.__folders.add('Tasks');
    app.__pluginData = { folders:{ tasks:'Tasks' }, emailAssistant:{ enabled:true, taskSkill:'Task skill.', commentSkill:'Comment skill.' } };
    let finishRequest;
    globalThis.fetch = vi.fn(() => new Promise(resolve => {
      finishRequest = () => resolve(ollamaResponse({ title:'Late task', description:'Late response.' }));
    }));
    const plugin = new TaskDashPlugin(app, { id:'taskdash-2-2', version:'2.2.0' });
    await plugin.onload();
    const view = app.__viewFactories[TASKDASH_VIEW_TYPE]({});
    view.app = app;
    await view.onOpen();
    expect(await waitFor(() => !!view.contentEl.querySelector('button[aria-label="Calendar"]'))).toBe(true);
    view.contentEl.querySelector('button[aria-label="Calendar"]').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === '+ New task'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === '+ New task').click();
    expect(await waitFor(() => !!view.contentEl.querySelector('.td-email-draft-panel'))).toBe(true);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent.includes('Draft task from email')).click();
    const email = view.contentEl.querySelector('.td-email-draft-panel textarea');
    setControlValue(email, 'Please confirm the invoice date.');
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Generate draft').click();
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')].some(button=>button.textContent === 'Cancel drafting'))).toBe(true);
    expect(typeof finishRequest).toBe('function');
    const filesBeforeCancel = [...app.__files.entries()].map(([path, file])=>[path, file.content]);
    [...view.contentEl.querySelectorAll('button')].find(button=>button.textContent === 'Cancel drafting').click();
    finishRequest();
    await new Promise(resolve=>setTimeout(resolve, 30));
    expect(view.contentEl.querySelector('input[value="Late task"]')).toBeNull();
    expect([...app.__files.entries()].map(([path, file])=>[path, file.content])).toEqual(filesBeforeCancel);
    await view.onClose();
  }, 15000);
});
