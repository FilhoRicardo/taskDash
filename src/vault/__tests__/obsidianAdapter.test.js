import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsidianVaultAdapter } from '../obsidian.ts';
import { readMdFiles } from '../../app/utils/parser.js';

// Minimal fake of the Obsidian App surface the adapter touches.
// Folders are duck-typed by `children`, files by `stat`.
function makeFakeObsidian() {
  const files = new Map(); // path -> { content: string | ArrayBuffer, mtime: number }
  const folders = new Set(['Tasks']);
  const handlers = {}; // event -> [fn]
  const base = p => p.split('/').pop();
  const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  const fileObj = path => ({
    path,
    name: base(path),
    stat: {
      mtime: files.get(path).mtime,
      size: typeof files.get(path).content === 'string' ? files.get(path).content.length : files.get(path).content.byteLength,
    },
  });

  const folderObj = path => ({
    path,
    name: base(path),
    get children() {
      const kids = [];
      for (const f of folders) if (parentOf(f) === path) kids.push(folderObj(f));
      for (const p of files.keys()) if (parentOf(p) === path) kids.push(fileObj(p));
      return kids;
    },
  });

  const vault = {
    getAbstractFileByPath(path) {
      if (folders.has(path)) return folderObj(path);
      if (files.has(path)) return fileObj(path);
      return null;
    },
    async create(path, content) {
      files.set(path, { content, mtime: Date.now() });
      return fileObj(path);
    },
    async createFolder(path) {
      folders.add(path);
      return folderObj(path);
    },
    async cachedRead(tfile) {
      const entry = files.get(tfile.path);
      return String(entry.content);
    },
    async readBinary(tfile) {
      const entry = files.get(tfile.path);
      if (typeof entry.content === 'string') return new TextEncoder().encode(entry.content).buffer;
      return entry.content;
    },
    async process(tfile, fn) {
      const entry = files.get(tfile.path);
      const next = fn(String(entry.content));
      files.set(tfile.path, { content: next, mtime: entry.mtime + 1 });
      return next;
    },
    async modifyBinary(tfile, data) {
      files.set(tfile.path, { content: data, mtime: files.get(tfile.path).mtime + 1 });
    },
    async createBinary(path, data) {
      files.set(path, { content: data, mtime: Date.now() });
    },
    async trash(target) {
      files.delete(target.path);
      folders.delete(target.path);
    },
    on(event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
      return { event, fn };
    },
    offref() {},
  };

  const opened = [];
  return {
    app: { vault, fileManager: {}, workspace:{ getLeaf:() => ({ openFile:async file => opened.push(file.path) }) } },
    files,
    folders,
    emit: (event, ...args) => (handlers[event] || []).forEach(fn => fn(...args)),
    processSpy: vi.spyOn(vault, 'process'),
    opened,
  };
}

function makeAdapter(fake, config = { tasks: 'Tasks' }) {
  const store = { ...config };
  return new ObsidianVaultAdapter(fake.app, {
    getConfig: () => ({ ...store }),
    setConfig: async (key, path) => {
      store[key] = path ?? '';
    },
    pickFolderPath: async () => 'Tasks',
  });
}

describe('ObsidianVaultAdapter', () => {
  let fake;
  beforeEach(() => {
    fake = makeFakeObsidian();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists configured directories and walks entries via readMdFiles', async () => {
    fake.files.set('Tasks/a.md', { content: '---\ntitle: A\n---\n', mtime: 1 });
    fake.folders.add('Tasks/sub');
    fake.files.set('Tasks/sub/b.md', { content: '---\ntitle: B\n---\n', mtime: 2 });
    fake.files.set('Elsewhere.md', { content: 'not configured', mtime: 3 });

    const adapter = makeAdapter(fake);
    const dirs = await adapter.getDirectories();
    expect(Object.keys(dirs)).toEqual(['tasks']);

    const found = await readMdFiles(dirs.tasks);
    expect(found.map(f => f.name).sort()).toEqual(['a.md', 'sub/b.md']);
  });

  it('writes strings through vault.process for existing files (atomic replace)', async () => {
    fake.files.set('Tasks/a.md', { content: 'old', mtime: 1 });
    const adapter = makeAdapter(fake);
    const dir = adapter.directoryHandle('Tasks');
    const handle = await dir.getFileHandle('a.md');
    const w = await handle.createWritable();
    await w.write('new content');
    await w.close();
    expect(fake.processSpy).toHaveBeenCalledTimes(1);
    expect(fake.files.get('Tasks/a.md').content).toBe('new content');
  });

  it('rejects a stale text write when the note changed after it was read', async () => {
    fake.files.set('Tasks/a.md', { content: 'original', mtime: 1 });
    const adapter = makeAdapter(fake);
    const handle = adapter.fileHandle('Tasks/a.md');
    const w = await handle.createWritable({ expectedContent:'original' });
    await w.write('taskdash update');

    fake.files.set('Tasks/a.md', { content: 'external edit', mtime: 2 });

    await expect(w.close()).rejects.toMatchObject({ name:'StaleWriteError' });
    expect(fake.files.get('Tasks/a.md').content).toBe('external edit');
  });

  it('creates missing files on getFileHandle({create:true}) and throws NotFoundError otherwise', async () => {
    const adapter = makeAdapter(fake);
    const dir = adapter.directoryHandle('Tasks');
    await expect(dir.getFileHandle('missing.md')).rejects.toMatchObject({ name: 'NotFoundError' });
    const handle = await dir.getFileHandle('missing.md', { create: true });
    expect(handle.kind).toBe('file');
    expect(fake.files.has('Tasks/missing.md')).toBe(true);
  });

  it('serves getFile() from cache until mtime changes', async () => {
    fake.files.set('Tasks/a.md', { content: 'v1', mtime: 1 });
    const adapter = makeAdapter(fake);
    const handle = adapter.fileHandle('Tasks/a.md');
    const readSpy = vi.spyOn(fake.app.vault, 'cachedRead');

    const f1 = await handle.getFile();
    const f2 = await handle.getFile();
    expect(await f2.text()).toBe('v1');
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(f1).toBe(f2);

    fake.files.set('Tasks/a.md', { content: 'v2', mtime: 5 });
    const f3 = await handle.getFile();
    expect(await f3.text()).toBe('v2');
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('debounces external-change notifications and filters to configured folders', async () => {
    vi.useFakeTimers();
    const adapter = makeAdapter(fake);
    let calls = 0;
    adapter.onExternalChange(() => {
      calls += 1;
    });

    fake.emit('modify', { path: 'Unrelated/x.md' });
    vi.advanceTimersByTime(2000);
    expect(calls).toBe(0);

    fake.emit('modify', { path: 'Tasks/a.md' });
    fake.emit('create', { path: 'Tasks/b.md' });
    vi.advanceTimersByTime(2000);
    expect(calls).toBe(1);
  });

  it('moveFile renames through fileManager.renameFile (link-preserving)', async () => {
    fake.files.set('Tasks/a.md', { content: 'done content', mtime: 1 });
    fake.folders.add('Done');
    const renames = [];
    fake.app.fileManager.renameFile = async (tfile, newPath) => {
      renames.push([tfile.path, newPath]);
      fake.files.set(newPath, fake.files.get(tfile.path));
      fake.files.delete(tfile.path);
    };
    const adapter = makeAdapter(fake, { tasks: 'Tasks', done: 'Done' });
    const dirs = await adapter.getDirectories();
    await adapter.moveFile(dirs.tasks, 'a.md', dirs.done, 'a.md');
    expect(renames).toEqual([['Tasks/a.md', 'Done/a.md']]);
    expect(fake.files.has('Done/a.md')).toBe(true);
    expect(fake.files.has('Tasks/a.md')).toBe(false);
  });

  it('binary writes go through createBinary/modifyBinary', async () => {
    const adapter = makeAdapter(fake);
    const dir = adapter.directoryHandle('Tasks');
    const handle = await dir.getFileHandle('img.png', { create: true });
    const w = await handle.createWritable();
    await w.write(new Uint8Array([1, 2, 3]).buffer);
    await w.close();
    const stored = fake.files.get('Tasks/img.png').content;
    expect(stored.byteLength).toBe(3);
  });

  it('opens a Markdown note through the Obsidian workspace', async () => {
    fake.files.set('Tasks/a.md', { content:'note', mtime:1 });
    const adapter = makeAdapter(fake);
    await adapter.openFile(adapter.fileHandle('Tasks/a.md'));
    expect(fake.opened).toEqual(['Tasks/a.md']);
  });
});
