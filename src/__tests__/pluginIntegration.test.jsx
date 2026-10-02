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
    expect(await waitFor(() => view.contentEl.querySelector('.td-task-inspector-file')?.textContent.includes('review'))).toBe(true);
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
    expect(await waitFor(() => view.contentEl.querySelector('.td-task-inspector-save')?.textContent === 'Saved')).toBe(true);
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

  it('edits task metadata in the persistent native inspector', async () => {
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

    const inspectorReady = await waitFor(() => view.contentEl.querySelector('.td-task-inspector'));
    expect(inspectorReady).toBe(true);
    const inspector = view.contentEl.querySelector('.td-task-inspector');
    expect(inspector.textContent).toContain('Properties');
    expect(inspector.textContent).toContain('ship-it');
    expect(view.contentEl.querySelector('.td-metadata-dialog')).toBeNull();

    const contexts = inspector.querySelector('input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'work, phone');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...inspector.querySelectorAll('button')]
      .find(button => button.textContent === 'Save')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    const saved = await waitFor(() => app.__files.get('Tasks/ship-it.md').content.includes('  - "phone"'));
    expect(saved).toBe(true);
    expect(view.contentEl.querySelector('.td-task-inspector')).toBeTruthy();

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
    expect(await waitFor(() => view.contentEl.querySelector('.td-task-inspector'))).toBeTruthy();

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

  it('asks before discarding unsaved inspector metadata when selecting another task', async () => {
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

    const inspectorReady = await waitFor(() => view.contentEl.querySelector('.td-task-inspector'));
    expect(inspectorReady).toBe(true);
    const contexts = view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'work, unsaved-audit');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...view.contentEl.querySelectorAll('.td-task-list-row')]
      .find(row => row.textContent.includes('Review the release'))
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const dialogReady = await waitFor(() => view.contentEl.querySelector('.td-unsaved-dialog'));
    expect(dialogReady).toBe(true);
    expect(view.contentEl.querySelector('.td-unsaved-dialog').contains(document.activeElement)).toBe(true);
    expect(view.contentEl.querySelector('.td-task-inspector-file').textContent).toContain('ship-it');
    expect(view.contentEl.querySelector('.td-unsaved-dialog').textContent).toContain('Unsaved property changes');

    [...view.contentEl.querySelectorAll('.td-unsaved-dialog button')]
      .find(button => button.textContent === 'Discard')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));

    const switched = await waitFor(() => view.contentEl.querySelector('.td-task-inspector-file')?.textContent.includes('review'));
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

    expect(await waitFor(() => view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]'))).toBe(true);
    const contexts = view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(contexts, 'unsaved audit');
    contexts.dispatchEvent(new Event('input', { bubbles:true }));

    [...view.contentEl.querySelectorAll('button')]
      .find(button => button.textContent === 'Start')
      .dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    expect(await waitFor(() => [...view.contentEl.querySelectorAll('button')]
      .some(button => button.textContent === 'Stop'), 1000)).toBe(true);
    expect(view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]').value).toBe('unsaved audit');
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
    expect(view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]')?.value).toBe('unsaved audit');

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
    expect(view.contentEl.querySelector('.td-task-inspector input[placeholder="work, phone"]').value).toBe('unsaved audit');

    await view.onClose();
  }, 15000);
});
