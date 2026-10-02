import { describe, expect, it } from 'vitest';
import { MemoryVaultAdapter } from '../memory.js';
import { readMdFiles, readDirNames, parseTask } from '../../app/utils/parser.js';
import { writeFile } from '../../app/App.jsx';

const TASK_MD = `---
title: Ship adapter
status: in-progress
due: 2026-07-10
---
- [ ] write tests
`;

describe('MemoryVaultAdapter handle contract', () => {
  it('exposes configured directories like the app expects', async () => {
    const adapter = new MemoryVaultAdapter();
    adapter.createDirectory('tasks').setFile('ship-adapter.md', TASK_MD);
    const dirs = await adapter.getDirectories();
    expect(Object.keys(dirs)).toEqual(['tasks']);
    expect(dirs.tasks.kind).toBe('directory');
  });

  it('readMdFiles walks directories recursively and skips non-md files', async () => {
    const adapter = new MemoryVaultAdapter();
    const tasks = adapter.createDirectory('tasks');
    tasks.setFile('a.md', TASK_MD);
    tasks.setFile('image.png', 'binary');
    tasks.setFile('timetracker.md', '| Time | Event |');
    tasks.makeDir('nested').setFile('b.md', TASK_MD);

    const files = await readMdFiles(tasks);
    expect(files.map(f => f.name).sort()).toEqual(['a.md', 'nested/b.md']);
    const task = parseTask(files[0].name, files[0].text);
    expect(task.title).toBe('Ship adapter');
    expect(task.status).toBe('in-progress');
  });

  it('supports the app writeFile flow end to end', async () => {
    const adapter = new MemoryVaultAdapter();
    const tasks = adapter.createDirectory('tasks');
    const handle = await tasks.getFileHandle('new-task.md', { create: true });
    await writeFile(handle, TASK_MD, { backup: false });
    const text = await (await handle.getFile()).text();
    expect(text).toBe(TASK_MD);
  });

  it('throws NotFoundError for missing entries (unique-name probing relies on it)', async () => {
    const adapter = new MemoryVaultAdapter();
    const tasks = adapter.createDirectory('tasks');
    await expect(tasks.getFileHandle('missing.md')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(tasks.getDirectoryHandle('missing')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(tasks.removeEntry('missing.md')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('readDirNames returns basenames for autocomplete', async () => {
    const adapter = new MemoryVaultAdapter();
    const people = adapter.createDirectory('people');
    people.setFile('Jane Doe.md', '# Jane');
    people.setFile('index.md', 'ignored');
    expect(await readDirNames(people)).toEqual(['Jane Doe']);
  });

  it('notifies external-change listeners on writes', async () => {
    const adapter = new MemoryVaultAdapter();
    const tasks = adapter.createDirectory('tasks');
    let calls = 0;
    const unsubscribe = adapter.onExternalChange(() => { calls += 1; });
    await tasks.getFileHandle('x.md', { create: true });
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
  });
});
