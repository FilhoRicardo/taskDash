// ObsidianVaultAdapter — implements the VaultAdapter handle contract (see
// types.ts) on top of Obsidian's Vault API.
//
// Deliberately imports nothing from 'obsidian' at runtime (type-only imports,
// duck-typed TFile/TFolder checks), so it can be unit-tested with fakes.
//
// Write policy: string writes to existing files go through vault.process()
// so each write is an atomic replace of the freshest on-disk content.
// Deletions go through fileManager.trashFile() (respects the user's trash
// preference). Reads are served as real File objects, cached by path+mtime.

import type { App, EventRef, TAbstractFile, TFile, TFolder } from 'obsidian';
import type { VaultAdapter, VaultDirectoryHandle, VaultFileHandle, VaultWritable } from './types';

class VaultOpError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

const notFound = (path: string) => new VaultOpError(`Entry not found: ${path}`, 'NotFoundError');
const typeMismatch = (path: string) => new VaultOpError(`Entry has a different kind: ${path}`, 'TypeMismatchError');
const staleWrite = (path: string) => new VaultOpError(`The note changed before TaskDash could save it: ${path}`, 'StaleWriteError');

const isFolder = (f: TAbstractFile | null | undefined): f is TFolder => !!f && 'children' in f;
const isFile = (f: TAbstractFile | null | undefined): f is TFile => !!f && 'stat' in f;

const MIME: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

const mimeFor = (name: string): string => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';

const BINARY_RX = /\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i;

const joinPath = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name);

interface AdapterConfigIO {
  /** Current folder config, keyed like the app's FOLDER_DEFS ('tasks', 'done', …). */
  getConfig(): Record<string, string>;
  /** Persist a folder path for a key (null clears it). */
  setConfig(key: string, path: string | null): Promise<void>;
  /** Open folder-picking UI; resolve with the chosen vault path or null if cancelled. */
  pickFolderPath(key: string): Promise<string | null>;
}

interface FileCacheEntry {
  mtime: number;
  size: number;
  file: File;
}

export class ObsidianVaultAdapter implements VaultAdapter {
  private fileCache = new Map<string, FileCacheEntry>();
  private listeners = new Set<() => void>();
  private eventRefs: EventRef[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private obsidian: App,
    private io: AdapterConfigIO
  ) {}

  // ── VaultAdapter ──

  async getDirectories(): Promise<Record<string, VaultDirectoryHandle>> {
    const config = this.io.getConfig();
    const out: Record<string, VaultDirectoryHandle> = {};
    for (const [key, path] of Object.entries(config)) {
      if (!path) continue;
      // Handles resolve lazily: a missing folder still yields a handle whose
      // entries() throws NotFoundError, which the app reports as unavailable.
      out[key] = this.directoryHandle(path);
    }
    return out;
  }

  async pickDirectory(key: string): Promise<VaultDirectoryHandle | null> {
    const path = await this.io.pickFolderPath(key);
    if (!path) return null;
    await this.io.setConfig(key, path);
    return this.directoryHandle(path);
  }

  async clearDirectory(key: string): Promise<void> {
    await this.io.setConfig(key, null);
  }

  async clearAll(): Promise<void> {
    for (const key of Object.keys(this.io.getConfig())) {
      await this.io.setConfig(key, null);
    }
  }

  onExternalChange(callback: () => void): () => void {
    this.listeners.add(callback);
    this.ensureVaultEvents();
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Link-preserving move via fileManager.renameFile. */
  async moveFile(
    sourceDir: { path?: string },
    relativePath: string,
    targetDir: { path?: string },
    targetName: string
  ): Promise<void> {
    if (sourceDir.path === undefined || targetDir.path === undefined) {
      throw new VaultOpError('moveFile requires path-aware handles', 'NotSupportedError');
    }
    const sourcePath = joinPath(sourceDir.path, relativePath);
    const tfile = this.resolveFile(sourcePath);
    const targetPath = joinPath(targetDir.path, targetName);
    await this.obsidian.fileManager.renameFile(tfile, targetPath);
    this.fileCache.delete(sourcePath);
  }

  async openFile(file: VaultFileHandle): Promise<void> {
    if (!file.path) throw new VaultOpError('openFile requires a path-aware handle', 'NotSupportedError');
    const tfile = this.resolveFile(file.path);
    await this.obsidian.workspace.getLeaf(false).openFile(tfile);
  }

  dispose(): void {
    for (const ref of this.eventRefs) this.obsidian.vault.offref(ref);
    this.eventRefs = [];
    this.listeners.clear();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.fileCache.clear();
  }

  // ── Handles ──

  directoryHandle(path: string): VaultDirectoryHandle {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this;
    const name = path.split('/').pop() ?? path;
    return {
      kind: 'directory',
      name,
      path,
      async *entries() {
        const folder = adapter.resolveFolder(path);
        for (const child of [...folder.children]) {
          if (isFolder(child)) yield [child.name, adapter.directoryHandle(child.path)] as [string, VaultDirectoryHandle];
          else if (isFile(child)) yield [child.name, adapter.fileHandle(child.path)] as [string, VaultFileHandle];
        }
      },
      async getFileHandle(childName: string, options?: { create?: boolean }) {
        const childPath = joinPath(path, childName);
        const existing = adapter.obsidian.vault.getAbstractFileByPath(childPath);
        if (isFile(existing)) return adapter.fileHandle(childPath);
        if (isFolder(existing)) throw typeMismatch(childPath);
        if (!options?.create) throw notFound(childPath);
        adapter.resolveFolder(path); // parent must exist
        await adapter.obsidian.vault.create(childPath, '');
        return adapter.fileHandle(childPath);
      },
      async getDirectoryHandle(childName: string, options?: { create?: boolean }) {
        const childPath = joinPath(path, childName);
        const existing = adapter.obsidian.vault.getAbstractFileByPath(childPath);
        if (isFolder(existing)) return adapter.directoryHandle(childPath);
        if (isFile(existing)) throw typeMismatch(childPath);
        if (!options?.create) throw notFound(childPath);
        await adapter.obsidian.vault.createFolder(childPath);
        return adapter.directoryHandle(childPath);
      },
      async removeEntry(childName: string) {
        const childPath = joinPath(path, childName);
        const existing = adapter.obsidian.vault.getAbstractFileByPath(childPath);
        if (!existing) throw notFound(childPath);
        await adapter.trash(existing);
        adapter.fileCache.delete(childPath);
      },
      async queryPermission() {
        return 'granted' as const;
      },
      async requestPermission() {
        return 'granted' as const;
      },
    };
  }

  fileHandle(path: string): VaultFileHandle {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this;
    const name = path.split('/').pop() ?? path;
    return {
      kind: 'file',
      name,
      path,
      async getFile() {
        const tfile = adapter.resolveFile(path);
        const cached = adapter.fileCache.get(path);
        if (cached && cached.mtime === tfile.stat.mtime && cached.size === tfile.stat.size) return cached.file;
        // Text files go through cachedRead — Obsidian's fast path for bulk
        // reads (serves from its content cache instead of hitting disk).
        const vault = adapter.obsidian.vault as { cachedRead?: (f: TFile) => Promise<string> };
        const data: ArrayBuffer | string =
          !BINARY_RX.test(name) && typeof vault.cachedRead === 'function'
            ? await vault.cachedRead(tfile)
            : await adapter.obsidian.vault.readBinary(tfile);
        const file = new File([data], name, { type: mimeFor(name), lastModified: tfile.stat.mtime });
        adapter.fileCache.set(path, { mtime: tfile.stat.mtime, size: tfile.stat.size, file });
        return file;
      },
      async createWritable(options?: { keepExistingData?: boolean; expectedContent?: string }): Promise<VaultWritable> {
        const chunks: (string | ArrayBuffer | Blob)[] = [];
        return {
          async write(chunk) {
            chunks.push(chunk);
          },
          async close() {
            await adapter.commitWrite(path, chunks, options?.expectedContent);
          },
        };
      },
    };
  }

  // ── Internals ──

  private resolveFolder(path: string): TFolder {
    const af = this.obsidian.vault.getAbstractFileByPath(path);
    if (!isFolder(af)) throw notFound(path);
    return af;
  }

  private resolveFile(path: string): TFile {
    const af = this.obsidian.vault.getAbstractFileByPath(path);
    if (!isFile(af)) throw notFound(path);
    return af;
  }

  private async commitWrite(path: string, chunks: (string | ArrayBuffer | Blob)[], expectedContent?: string): Promise<void> {
    const isText = chunks.every(c => typeof c === 'string');
    const existing = this.obsidian.vault.getAbstractFileByPath(path);
    if (isFolder(existing)) throw typeMismatch(path);
    this.fileCache.delete(path);

    if (isText) {
      const content = (chunks as string[]).join('');
      if (isFile(existing)) {
        await this.obsidian.vault.process(existing, current => {
          if (expectedContent !== undefined && current !== expectedContent && current !== content) throw staleWrite(path);
          return content;
        });
      } else {
        await this.obsidian.vault.create(path, content);
      }
      return;
    }

    const buffer = await toArrayBuffer(chunks);
    if (isFile(existing)) await this.obsidian.vault.modifyBinary(existing, buffer);
    else await this.obsidian.vault.createBinary(path, buffer);
  }

  private async trash(target: TAbstractFile): Promise<void> {
    const fileManager = this.obsidian.fileManager as { trashFile?: (f: TAbstractFile) => Promise<void> };
    if (typeof fileManager.trashFile === 'function') await fileManager.trashFile(target);
    else await this.obsidian.vault.trash(target, true);
  }

  private ensureVaultEvents(): void {
    if (this.eventRefs.length) return;
    const notify = (file: TAbstractFile | string) => {
      const path = typeof file === 'string' ? file : file.path;
      if (typeof file !== 'string' && file.path) this.fileCache.delete(file.path);
      if (!this.isUnderConfiguredFolder(path)) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        for (const cb of [...this.listeners]) cb();
      }, 800);
    };
    const vault = this.obsidian.vault;
    this.eventRefs.push(
      vault.on('create', f => notify(f)),
      vault.on('modify', f => notify(f)),
      vault.on('delete', f => notify(f)),
      vault.on('rename', (f, oldPath) => {
        this.fileCache.delete(oldPath);
        notify(f);
        notify(oldPath);
      })
    );
  }

  private isUnderConfiguredFolder(path: string): boolean {
    for (const folder of Object.values(this.io.getConfig())) {
      if (!folder) continue;
      if (path === folder || path.startsWith(`${folder}/`)) return true;
    }
    return false;
  }
}

async function toArrayBuffer(chunks: (string | ArrayBuffer | Blob)[]): Promise<ArrayBuffer> {
  if (chunks.length === 1) {
    const c = chunks[0];
    if (c instanceof ArrayBuffer) return c;
    if (typeof c !== 'string' && ArrayBuffer.isView(c as unknown as ArrayBufferView)) {
      const view = c as unknown as ArrayBufferView;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    }
    if (c instanceof Blob) return await c.arrayBuffer();
  }
  const blob = new Blob(chunks as BlobPart[]);
  return await blob.arrayBuffer();
}
